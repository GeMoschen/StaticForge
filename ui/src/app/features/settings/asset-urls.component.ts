import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ChannelsService } from '../channels/channels.service';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import {
  UrlArea,
  UrlRegistryAssetView,
  UrlRegistryEntryView,
  UrlRegistryService,
  outputLabel,
  overrideErrorMessage,
} from './url-registry.service';

/**
 * The "URLs" section of a page, media file or folder (M32.8): the asset's registered URLs per channel, language, area,
 * variant and page, with override (developers) and reset (project admins). A URL decides where a build writes the
 * output, so an override moves the file with the next build. A folder with an index page has no URL of its own: it
 * shows the page it links instead. "Set URL" assigns one before any build or preview did.
 */
@Component({
  selector: 'sf-asset-urls',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent],
  template: `
    <div class="urls">
      <h3 class="urls__title">URLs</h3>
      @if (loading()) {
        <span class="muted">Loading…</span>
      } @else if (error()) {
        <span class="urls__error" role="alert">{{ error() }}</span>
      }
      @if (!loading() && !error() && view(); as v) {
        @for (index of v.indexPages ?? []; track index.channelKey) {
          <p class="urls__note">
            Uses the URL of its index page <strong>{{ index.pageLabel ?? index.pageUuid }}</strong>
            <span class="muted">({{ index.channelKey }})</span>.
          </p>
        }
        @if (!v.targetType) {
          <span class="muted">This asset has no URL of its own.</span>
        } @else {
          @if ((v.entries ?? []).length === 0) {
            <span class="muted">No URL yet — the next build or preview assigns one.</span>
          } @else {
            <ul class="urls__list">
              @for (entry of v.entries ?? []; track entry.id) {
                <li class="urls__row">
                  <span class="urls__where">
                    {{ entry.area === 'PREVIEW' ? 'Preview' : 'Build' }}{{ entry.channelKey ? ' · ' + entry.channelKey : '' }}{{
                      entry.locale ? ' · ' + entry.locale : ''
                    }}{{ outputText(entry) }}
                  </span>
                  @if (editingId() === entry.id) {
                    <input
                      class="urls__input"
                      type="text"
                      aria-label="URL"
                      [value]="editUrl()"
                      (input)="editUrl.set($any($event.target).value)"
                      (keydown.enter)="save(entry)"
                      (keydown.escape)="cancel()"
                    />
                    <sf-button variant="primary" [disabled]="saving() || !editUrl().trim()" (click)="save(entry)">Save</sf-button>
                    <sf-button variant="ghost" (click)="cancel()">Cancel</sf-button>
                  } @else {
                    <code class="urls__url">{{ entry.url }}</code>
                    @if (entry.overridden) {
                      <span class="urls__badge">manual</span>
                    }
                    <span class="urls__row-actions">
                      @if (canOverride()) {
                        <sf-button variant="ghost" (click)="edit(entry)">Override</sf-button>
                      }
                      @if (canReset()) {
                        <sf-button variant="ghost" (click)="reset(entry)">Reset</sf-button>
                      }
                    </span>
                  }
                </li>
              }
            </ul>
          }
          @if (editError()) {
            <span class="urls__error" role="alert">{{ editError() }}</span>
          }
          <div class="urls__actions">
            @if (canOverride() && !adding()) {
              <sf-button variant="ghost" (click)="startAdd()">Set URL</sf-button>
            }
            @if (canReset() && (v.entries ?? []).length > 0) {
              <sf-button variant="ghost" (click)="resetAll()">Reset all URLs</sf-button>
            }
          </div>
          @if (adding()) {
            <div class="urls__add">
              <select class="urls__select" aria-label="Area" [value]="addArea()" (change)="addArea.set($any($event.target).value)">
                <option value="GENERATED">Build</option>
                <option value="PREVIEW">Preview</option>
              </select>
              @if (v.targetType !== 'MEDIA') {
                <select class="urls__select" aria-label="Channel" [value]="addChannel()" (change)="addChannel.set($any($event.target).value)">
                  @for (key of channels(); track key) {
                    <option [value]="key">{{ key }}</option>
                  }
                </select>
              }
              @if (locales().length > 0) {
                <select class="urls__select" aria-label="Language" [value]="addLocale()" (change)="addLocale.set($any($event.target).value)">
                  @for (locale of locales(); track locale.code) {
                    <option [value]="locale.code">{{ locale.label ?? locale.code }}</option>
                  }
                  @if (v.targetType === 'MEDIA') {
                    <option value="">Not localized</option>
                  }
                </select>
              }
              <input
                class="urls__input"
                type="text"
                aria-label="New URL"
                placeholder="e.g. company/about.html"
                [value]="addUrl()"
                (input)="addUrl.set($any($event.target).value)"
                (keydown.enter)="add()"
              />
              <sf-button variant="primary" [disabled]="saving() || !addUrl().trim()" (click)="add()">Save</sf-button>
              <sf-button variant="ghost" (click)="adding.set(false)">Cancel</sf-button>
            </div>
          }
        }
      }
    </div>
  `,
  styles: [
    `
      .urls {
        display: flex;
        flex-direction: column;
        gap: var(--sf-2);
        font-size: var(--sf-text-sm);
      }
      .urls__title {
        margin: 0;
        font-size: var(--sf-text-sm);
        font-weight: 600;
        color: var(--sf-ink);
      }
      .urls__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--sf-1);
      }
      .urls__row,
      .urls__add,
      .urls__actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--sf-2);
        min-width: 0;
      }
      .urls__row-actions {
        display: inline-flex;
        gap: var(--sf-1);
        margin-left: auto;
        flex-wrap: nowrap;
      }
      .urls__where {
        color: var(--sf-slate);
        min-width: 8rem;
      }
      .urls__url {
        overflow-wrap: anywhere;
        min-width: 0;
      }
      .urls__badge {
        font-size: var(--sf-text-xs);
        padding: 0 var(--sf-1);
        border: 1px solid var(--sf-line);
        border-radius: var(--sf-radius-sm);
      }
      .urls__input {
        flex: 1 1 12rem;
        min-width: 0;
      }
      .urls__note {
        margin: 0;
      }
      .urls__error {
        color: var(--sf-rust);
      }
      .muted {
        color: var(--sf-slate);
      }
    `,
  ],
})
export class SfAssetUrlsComponent {
  readonly projectKey = input.required<string>();
  readonly assetUuid = input.required<string>();
  /** Reloads when it changes (e.g. the asset's revision after a save or a rename). */
  readonly refreshKey = input<unknown>(null);

  private readonly api = inject(UrlRegistryService);
  private readonly channelsApi = inject(ChannelsService);
  private readonly toasts = inject(ToastService);
  private readonly permissions = inject(ProjectPermissionsStore);
  protected readonly locales = inject(LocalesStore).locales;

  protected readonly view = signal<UrlRegistryAssetView | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly editingId = signal<number | null>(null);
  protected readonly editUrl = signal('');
  protected readonly editError = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly adding = signal(false);
  protected readonly addArea = signal<UrlArea>('GENERATED');
  protected readonly addChannel = signal('');
  protected readonly addLocale = signal('');
  protected readonly addUrl = signal('');
  protected readonly channels = signal<string[]>([]);

  /** Overrides are the developers' business, like templates' output paths. */
  protected readonly canOverride = computed(() => this.permissions.canEditTemplates());
  /** Resets are project admins' (the server's role for them). */
  protected readonly canReset = computed(() => this.permissions.canAdminProject());

  constructor() {
    effect(() => {
      const key = this.projectKey();
      const uuid = this.assetUuid();
      this.refreshKey();
      untracked(() => this.load(key, uuid));
    });
  }

  protected outputText(entry: UrlRegistryEntryView): string {
    const output = outputLabel(entry);
    return output ? ' · ' + output : '';
  }

  private load(key: string, uuid: string): void {
    if (!uuid) {
      this.view.set(null);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.api.forAsset(key, uuid).subscribe({
      next: (view) => {
        this.view.set(view);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Could not load the URLs.');
      },
    });
  }

  protected edit(entry: UrlRegistryEntryView): void {
    this.editingId.set(entry.id ?? null);
    this.editUrl.set(entry.url ?? '');
    this.editError.set(null);
  }

  protected cancel(): void {
    this.editingId.set(null);
    this.editError.set(null);
  }

  protected save(entry: UrlRegistryEntryView): void {
    const url = this.editUrl().trim();
    if (entry.id == null || !url || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.api.override(this.projectKey(), entry.id, url).subscribe({
      next: () => {
        this.saving.set(false);
        this.editingId.set(null);
        this.editError.set(null);
        this.toasts.show('URL saved — the next build moves the output there', 'success');
        this.load(this.projectKey(), this.assetUuid());
      },
      error: (err) => {
        this.saving.set(false);
        this.editError.set(overrideErrorMessage(err));
      },
    });
  }

  protected startAdd(): void {
    this.adding.set(true);
    this.addUrl.set('');
    this.editError.set(null);
    this.addLocale.set(this.locales()[0]?.code ?? '');
    this.channelsApi.list(this.projectKey()).subscribe({
      next: (list) => {
        const keys = (list ?? []).map((c) => c.key ?? '').filter(Boolean);
        this.channels.set(keys);
        if (!keys.includes(this.addChannel())) {
          this.addChannel.set(keys[0] ?? '');
        }
      },
      error: () => this.channels.set([]),
    });
  }

  protected add(): void {
    const view = this.view();
    const url = this.addUrl().trim();
    if (!view?.targetType || !url || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.api
      .assign(this.projectKey(), {
        targetType: view.targetType,
        targetUuid: this.assetUuid(),
        channelKey: view.targetType === 'MEDIA' ? undefined : this.addChannel(),
        area: this.addArea(),
        locale: this.addLocale() || undefined,
        url,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.adding.set(false);
          this.editError.set(null);
          this.toasts.show('URL saved — the next build moves the output there', 'success');
          this.load(this.projectKey(), this.assetUuid());
        },
        error: (err) => {
          this.saving.set(false);
          this.editError.set(overrideErrorMessage(err));
        },
      });
  }

  protected reset(entry: UrlRegistryEntryView): void {
    if (entry.id == null) {
      return;
    }
    this.api.reset(this.projectKey(), { entryId: entry.id }).subscribe({
      next: () => {
        this.toasts.show('URL reset — the next build or preview assigns the computed one', 'success');
        this.load(this.projectKey(), this.assetUuid());
      },
      error: () => this.toasts.show('Could not reset the URL — try again in a moment.', 'error'),
    });
  }

  protected resetAll(): void {
    this.api.reset(this.projectKey(), { targetUuid: this.assetUuid() }).subscribe({
      next: () => {
        this.toasts.show('URLs reset — the next build or preview assigns the computed ones', 'success');
        this.load(this.projectKey(), this.assetUuid());
      },
      error: () => this.toasts.show('Could not reset the URLs — try again in a moment.', 'error'),
    });
  }
}
