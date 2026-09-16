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
  viewChild,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ApiClient } from '../../core/api/api.client';
import { previewErrorDocument, previewProblem } from './preview-error';
import { pageNumbers, readPageHeaders, requestedPage } from './preview-pagination.util';

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
 * to outline the matching section. It lives exclusively in the srcdoc, so it
 * cannot touch the host application.
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
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.type !== 'sf-focus-section' || typeof d.instanceId !== 'string') { return; }
    if (focused) { focused.style.outline = ''; focused = null; }
    var el = document.querySelector('[data-sf-instance="' + d.instanceId + '"]');
    if (el) { el.style.outline = '2px solid var(--sf-signal, #ff5d5d)'; focused = el; }
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

  protected readonly viewports = VIEWPORTS;

  protected readonly html = signal('');
  protected readonly viewport = signal<ViewportPreset>('desktop');
  protected readonly shareUrl = signal<string | null>(null);
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
      this.refreshKey();
      this.scheduleDebounced();
    });
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

  /** Focus (outline) a section inside the preview iframe by instance id. */
  focusSection(instanceId: string): void {
    const el = this.frameRef()?.nativeElement;
    const win = el?.contentWindow;
    win?.postMessage({ type: 'sf-focus-section', instanceId }, '*');
  }

  protected refreshManually(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.fetch();
  }

  protected share(): void {
    const key = this.projectKey();
    const uuid = this.pageUuid();
    if (!key || !uuid) {
      return;
    }
    this.api.sharePreviewUrl(key, uuid, undefined, CHANNEL).subscribe({
      next: (link) => this.shareUrl.set(link.url ?? link.token ?? null),
      error: () => this.shareUrl.set(null),
    });
  }

  protected copyShareUrl(): void {
    const url = this.shareUrl();
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
    this.api.previewSavedPageResponse(key, uuid, this.revision() ?? undefined, CHANNEL, this.requestedPage).subscribe({
      next: (response) => {
        const { page, total } = readPageHeaders(response.headers);
        this.page.set(page);
        this.totalPages.set(total);
        this.requestedPage = page;
        this.html.set(response.body ?? '');
      },
      // Show why the page can't render (e.g. 422 SF-TPL-0135 include cycle) instead of a blank frame.
      error: (err: unknown) => this.html.set(previewErrorDocument(previewProblem(err))),
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
