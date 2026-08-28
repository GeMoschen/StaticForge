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
import { ApiClient } from '../../core/api/api.client';

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

  readonly projectKey = input.required<string>();
  readonly pageUuid = input.required<string>();
  /** Pins the preview to a specific revision; omitted/null renders the current one. */
  readonly revision = input<number | null>(null);

  readonly sectionClick = output<string>();

  protected readonly viewports = VIEWPORTS;

  protected readonly html = signal('');
  protected readonly viewport = signal<ViewportPreset>('desktop');
  protected readonly shareUrl = signal<string | null>(null);

  private readonly frameRef = viewChild<ElementRef<HTMLIFrameElement>>('frame');

  private timer: ReturnType<typeof setTimeout> | null = null;

  private readonly onKeydownRef = (event: KeyboardEvent) => this.onKeydown(event);

  protected readonly srcdoc = computed(() => this.wrap(this.html()));

  protected readonly viewportWidth = computed<string>(() => {
    const preset = VIEWPORTS.find((v) => v.key === this.viewport());
    return preset?.width != null ? `${preset.width}px` : '100%';
  });

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', this.onKeydownRef);
    }

    effect(() => {
      this.projectKey();
      this.pageUuid();
      this.revision();
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
    this.api.previewSavedPage(key, uuid, this.revision() ?? undefined, CHANNEL).subscribe({
      next: (html) => this.html.set(html),
      error: () => this.html.set(''),
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
