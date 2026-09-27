import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ApiClient, type PreviewView } from '../../core/api/api.client';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { previewErrorDocument, previewProblem } from './preview-error';
import { pageNumbers, readPageHeaders, requestedPage } from './preview-pagination.util';
import {
  NOT_PUBLISHED_CODE,
  RELEASE_STATUS_HEADER,
  VIEW_HEADER,
  readStoredView,
  releaseStatusLabel,
  storeView,
  viewLabel,
} from './preview-view.util';
import { ReleaseEventsStore } from '../release/release-events.store';

type ViewportPreset = 'mobile' | 'tablet' | 'desktop' | 'full';

const LIVE_DEBOUNCE_MS = 400;
const CHANNEL = 'html';

interface ViewportOption {
  key: ViewportPreset;
  label: string;
  width: number | null;
}

const VIEWPORTS: ViewportOption[] = [
  { key: 'mobile', label: '375', width: 375 },
  { key: 'tablet', label: '768', width: 768 },
  { key: 'desktop', label: '1280', width: 1280 },
  { key: 'full', label: '100%', width: null },
];

/**
 * PREVIEW-ONLY, never shipped to production output: this script is appended to
 * the rendered HTML and injected into the sandboxed `srcdoc` document. It (a)
 * forwards clicks on any element carrying `[data-sf-instance]` to the parent
 * editor window, and (b) reacts to `sf-focus-section` messages from the parent
 * to outline the matching section — or, when the page doesn't mark its sections,
 * the element a quality finding names by selector (M30.3.2) — and scroll it into
 * view. It lives exclusively in the srcdoc, so it cannot touch the host application.
 */
const HIGHLIGHT_SCRIPT = `<script>
(function () {
  function send(id) {
    try { window.parent.postMessage({ type: 'sf-section-click', instanceId: id }, '*'); } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document) {
      if (el.hasAttribute && el.hasAttribute('data-sf-instance')) {
        send(el.getAttribute('data-sf-instance'));
        return;
      }
      el = el.parentElement;
    }
  }, true);
  // A pagination link (M21.3.1) asks the editor for that page instead of navigating the frame away.
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document && el.tagName !== 'A') { el = el.parentElement; }
    if (!el || el === document) { return; }
    var href = el.getAttribute('href') || '';
    // No backslashes here: this script lives in a template literal, which would swallow them.
    var match = (href.indexOf('/preview/share?') >= 0 || href.charAt(0) === '?') ? /[?&]page=([0-9]+)/.exec(href) : null;
    if (!match) { return; }
    e.preventDefault();
    try { window.parent.postMessage({ type: 'sf-preview-page', page: Number(match[1]) }, '*'); } catch (err) {}
  }, true);
  var focused = null;
  function find(d) {
    var el = null;
    try {
      if (typeof d.instanceId === 'string') { el = document.querySelector('[data-sf-instance="' + d.instanceId + '"]'); }
      if (!el && typeof d.selector === 'string') { el = document.querySelector(d.selector); }
    } catch (err) { el = null; }
    return el;
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.type !== 'sf-focus-section') { return; }
    if (focused) { focused.style.outline = ''; focused = null; }
    var el = find(d);
    if (el) {
      el.style.outline = '2px solid var(--sf-signal, #ff5d5d)';
      focused = el;
      if (el.scrollIntoView) { el.scrollIntoView({ block: 'center' }); }
    }
  });
})();
</script>`;

/**
 * Preview frame for the split-view page editor. Renders a sandboxed iframe preview of
 * the page by identity only — {@link pageUuid} and optionally {@link revision} — never
 * by shipping rendered data from the client: the server resolves content/bodies/meta
 * from the database (spec §19.1), so this component's job is purely "which page, which
 * revision, refresh when either changes." Always shows the current stored state (bounded
 * by the editor's own autosave debounce), never an unsaved/in-memory draft. Also offers a
 * viewport switcher, section-click forwarding, and a share-link helper.
 *
 * <p>Draft/Published (M27.2.3, M27.6.3): the draft view (default) renders the page's draft and the drafts of
 * everything it reads; the published view renders what the next build publishes. Links inside the frame keep the view:
 * the server signs it into every rewritten `/preview/share?t=…` link, and a pagination click re-fetches with the
 * current view. A save only re-renders the draft view — the published view doesn't change until a release.
 */
@Component({
  selector: 'sf-preview-frame',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './preview.frame.component.html',
  styleUrl: './preview.frame.component.scss',
})
export class SfPreviewFrameComponent implements OnDestroy {
  private readonly api = inject(ApiClient);
  /** An archived project creates no share links (M26); links made earlier stop working. */
  protected readonly archived = inject(ProjectAccessStore).archived;
  /** The language this preview renders — the one the editor is working in (M24.4.1). */
  protected readonly editingLocale = inject(EditingLocaleStore);
  private readonly locales = inject(LocalesStore);
  private readonly releaseEvents = inject(ReleaseEventsStore);
  private readonly sanitizer = inject(DomSanitizer);

  readonly projectKey = input.required<string>();
  readonly pageUuid = input.required<string>();
  /**
   * Pins the preview to a specific revision (time travel); omitted/null renders the current one.
   * Everything the page reads is taken at this revision — its templates, and the values of other
   * assets such as `CMS_GLOBAL` property sets — so it must never be the page's own concurrency
   * token: that would freeze every template or global change made since the page's last save.
   */
  readonly revision = input<number | null>(null);
  /**
   * Refreshes the preview whenever it changes, without being sent to the server. The page editor
   * passes the page's own revision here so a save re-renders the preview.
   */
  readonly refreshKey = input<unknown>(null);

  readonly sectionClick = output<string>();
  /** The view the preview switched to (Draft or Published); the Issues panel says its checks cover the draft. */
  readonly viewChange = output<PreviewView>();

  protected readonly viewports = VIEWPORTS;

  protected readonly html = signal('');
  protected readonly viewport = signal<ViewportPreset>('desktop');
  /** Draft (default) or Published, remembered per browser. */
  protected readonly view = signal<PreviewView>(readStoredView());
  protected readonly viewOptions: { value: PreviewView; label: string }[] = [
    { value: 'draft', label: 'Draft' },
    { value: 'published', label: 'Published' },
  ];
  /** The draft view's release status from `X-SF-Release-Status`; `null` when the response carries none. */
  private readonly releaseStatus = signal<string | null>(null);
  /** The view the shown document was rendered in (`X-SF-View`), so the status line never describes the other one. */
  private readonly renderedView = signal<PreviewView | null>(null);
  protected readonly statusLine = computed(() => {
    const label = releaseStatusLabel(this.releaseStatus());
    return this.view() === 'draft' && this.renderedView() === 'draft' && label ? `Draft — ${label}` : null;
  });
  /** Set when the published view has nothing to show: the page isn't released in the language. */
  protected readonly notPublished = signal<string | null>(null);

  /** The share popover: open, the chosen view, and the created link with the view it shows. */
  protected readonly shareOpen = signal(false);
  protected readonly shareView = signal<PreviewView>('draft');
  protected readonly shareLink = signal<{ url: string; view: PreviewView } | null>(null);
  protected readonly shareLabel = computed(() => {
    const link = this.shareLink();
    return link ? `${viewLabel(link.view)} link` : '';
  });
  /** The page of a paginated page (M21.3.1): requested, rendered and total. Hidden while there is one page. */
  protected readonly page = signal(1);
  protected readonly totalPages = signal(1);
  protected readonly pages = computed(() => pageNumbers(this.totalPages()));
  private requestedPage = 1;
  private lastPageUuid: string | null = null;

  private readonly frameRef = viewChild<ElementRef<HTMLIFrameElement>>('frame');

  private timer: ReturnType<typeof setTimeout> | null = null;

  private readonly onKeydownRef = (event: KeyboardEvent) => this.onKeydown(event);
  private readonly onMessageRef = (event: MessageEvent) => this.onMessage(event);

  /**
   * The rendered page as the frame's document. Binding a plain string to `[srcdoc]` runs Angular's
   * HTML sanitizer, which strips every `<link>`, `<style>`, `<script>` and `id` — so the preview
   * never loaded a stylesheet (M18: a processed CSS file served by the media share route) and the
   * highlight script never ran. The document is the server's render of the project's own templates,
   * and the frame's sandbox (`allow-scripts` without `allow-same-origin`) gives it an opaque origin:
   * its scripts cannot reach this app, its storage or its in-memory session.
   */
  protected readonly srcdoc = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.wrap(this.html())),
  );

  protected readonly viewportWidth = computed<string>(() => {
    const preset = VIEWPORTS.find((v) => v.key === this.viewport());
    return preset?.width != null ? `${preset.width}px` : '100%';
  });

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', this.onKeydownRef);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.onMessageRef);
    }

    effect(() => {
      this.projectKey();
      const uuid = this.pageUuid();
      if (uuid !== this.lastPageUuid) {
        // Another page starts at its first page; a save of the same page keeps the page being looked at.
        this.lastPageUuid = uuid;
        this.requestedPage = 1;
      }
      this.revision();
      // Switching the editing language re-renders the preview in it (M24.4.1).
      this.editingLocale.locale();
      // A release, unpublish or discard changes what both views show, and the draft's status (M27.6.3).
      this.releaseEvents.version();
      this.scheduleDebounced();
    });

    // A save (autosave) changes only the draft: the published view stays as it is until a release.
    effect(() => {
      this.refreshKey();
      if (untracked(() => this.view()) === 'draft') {
        this.scheduleDebounced();
      }
    });
  }

  /** Switches between the draft and the published view and remembers the choice. */
  protected setView(view: PreviewView): void {
    if (view === this.view()) {
      return;
    }
    this.view.set(view);
    storeView(view);
    this.viewChange.emit(view);
    this.refreshManually();
  }

  /** Arrow keys move between the two views, like a radio group. */
  protected onViewKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next: PreviewView = this.view() === 'draft' ? 'published' : 'draft';
      this.setView(next);
      const group = (event.currentTarget as HTMLElement | null)?.closest('[role="radiogroup"]');
      group?.querySelector<HTMLElement>(`[data-view="${next}"]`)?.focus();
    }
  }

  ngOnDestroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', this.onKeydownRef);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', this.onMessageRef);
    }
  }

  /** Shows page `number` of a paginated page (clamped by the server). */
  goToPage(number: number): void {
    if (number < 1 || number === this.page()) {
      return;
    }
    this.requestedPage = number;
    this.refreshManually();
  }

  protected onPageSelect(event: Event): void {
    this.goToPage(Number((event.target as HTMLSelectElement).value));
  }

  /**
   * Outlines a section inside the preview iframe by instance id and scrolls it into view. `selector` names an element
   * to outline instead when the page doesn't mark its sections with `data-sf-instance` (a quality finding's element,
   * M30.3.2); either may be missing.
   */
  focusSection(instanceId: string | null, selector: string | null = null): void {
    const el = this.frameRef()?.nativeElement;
    const win = el?.contentWindow;
    win?.postMessage({ type: 'sf-focus-section', instanceId, selector }, '*');
  }

  protected refreshManually(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.fetch();
  }

  /** Opens the share choice with the view currently shown preselected. */
  protected toggleShare(): void {
    if (this.shareOpen()) {
      this.shareOpen.set(false);
      return;
    }
    this.shareView.set(this.view());
    this.shareOpen.set(true);
  }

  /** Creates a share link bound to the chosen view (M27.2.3): a published link keeps showing the released state. */
  protected share(): void {
    const key = this.projectKey();
    const uuid = this.pageUuid();
    if (!key || !uuid) {
      return;
    }
    const view = this.shareView();
    this.api
      .sharePreviewUrl(key, uuid, undefined, CHANNEL, this.editingLocale.locale() ?? undefined, view)
      .subscribe({
        next: (link) => {
          const url = link.url ?? link.token ?? null;
          this.shareLink.set(url ? { url, view } : null);
          this.shareOpen.set(false);
        },
        error: () => this.shareLink.set(null),
      });
  }

  protected copyShareUrl(): void {
    const url = this.shareLink()?.url;
    if (!url) {
      return;
    }
    void navigator.clipboard?.writeText(url).catch(() => {
      /* clipboard unavailable; ignore */
    });
  }

  /** A pagination link clicked inside the frame; only messages from this frame's own document count. */
  private onMessage(event: MessageEvent): void {
    const frameWindow = this.frameRef()?.nativeElement.contentWindow;
    if (!frameWindow || event.source !== frameWindow) {
      return;
    }
    const number = requestedPage(event.data);
    if (number !== null) {
      this.goToPage(number);
    }
  }

  private onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'enter') {
      event.preventDefault();
      this.refreshManually();
    }
  }

  private scheduleDebounced(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fetch();
    }, LIVE_DEBOUNCE_MS);
  }

  private fetch(): void {
    const key = this.projectKey();
    const uuid = this.pageUuid();
    if (!key || !uuid) {
      return;
    }
    const view = this.view();
    const locale = this.editingLocale.locale();
    this.api
      .previewSavedPageResponse(
        key,
        uuid,
        this.revision() ?? undefined,
        CHANNEL,
        this.requestedPage,
        // The preview renders the language the editor is working in (M24.4.1).
        locale ?? undefined,
        view,
      )
      .subscribe({
      next: (response) => {
        const { page, total } = readPageHeaders(response.headers);
        this.page.set(page);
        this.totalPages.set(total);
        this.requestedPage = page;
        this.notPublished.set(null);
        const rendered = response.headers.get(VIEW_HEADER);
        this.renderedView.set(rendered === 'published' || rendered === 'draft' ? rendered : view);
        this.releaseStatus.set(response.headers.get(RELEASE_STATUS_HEADER));
        this.html.set(response.body ?? '');
      },
      error: (err: unknown) => {
        const problem = previewProblem(err);
        this.releaseStatus.set(null);
        if (view === 'published' && problem.status === 404 && problem.code === NOT_PUBLISHED_CODE) {
          // Not an error: the page simply isn't live in this language yet.
          this.notPublished.set(
            locale && this.locales.isLocalized() ? `Not published in ${this.locales.labelOf(locale)}` : 'Not published',
          );
          this.html.set('');
          return;
        }
        this.notPublished.set(null);
        // Show why the page can't render (e.g. 422 SF-TPL-0135 include cycle) instead of a blank frame.
        this.html.set(previewErrorDocument(problem));
      },
    });
  }

  private wrap(html: string): string {
    if (!html) {
      return '';
    }
    const idx = html.lastIndexOf('</body>');
    if (idx >= 0) {
      return html.slice(0, idx) + HIGHLIGHT_SCRIPT + html.slice(idx);
    }
    return html + HIGHLIGHT_SCRIPT;
  }
}
