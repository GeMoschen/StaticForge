import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
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
  imports: [SfButtonComponent, TranslocoPipe],
  template: `
    <div class="urls">
      <h3 class="urls__title">{{ 'shared.assetUrls.title' | transloco }}</h3>
      @if (loading()) {
        <span class="muted">{{ 'common.loading' | transloco }}</span>
      } @else if (failed()) {
        <p class="muted urls__unavailable" role="status">
          {{ 'shared.assetUrls.unavailable' | transloco }}
          <sf-button variant="ghost" size="sm" (click)="reload()">{{ 'common.retry' | transloco }}</sf-button>
        </p>
      }
      @if (!loading() && !failed() && view(); as v) {
        @for (index of v.indexPages ?? []; track index.channelKey) {
          <p class="urls__note">
            {{ 'shared.assetUrls.indexPage' | transloco }} <strong>{{ index.pageLabel ?? index.pageUuid }}</strong>
            <span class="muted">({{ index.channelKey }})</span>
          </p>
        }
        @if (!v.targetType) {
          <span class="muted">{{ 'shared.assetUrls.none' | transloco }}</span>
        } @else {
          @if ((v.entries ?? []).length === 0) {
            <span class="muted">{{ 'shared.assetUrls.noneYet' | transloco }}</span>
          } @else {
            <ul class="urls__list">
              @for (entry of v.entries ?? []; track entry.id) {
                <li class="urls__row">
                  <span class="urls__where">
                    {{ (entry.area === 'PREVIEW' ? 'shared.assetUrls.areaPreview' : 'shared.assetUrls.areaBuild') | transloco
                    }}{{ entry.channelKey ? ' · ' + entry.channelKey : '' }}{{ entry.locale ? ' · ' + entry.locale : '' }}{{
                      outputText(entry)
                    }}
                  </span>
                  @if (editingId() === entry.id) {
                    <input
                      class="urls__input"
                      type="text"
                      [attr.aria-label]="'shared.assetUrls.url' | transloco"
                      [value]="editUrl()"
                      (input)="editUrl.set($any($event.target).value)"
                      (keydown.enter)="save(entry)"
                      (keydown.escape)="cancel()"
                    />
                    <sf-button variant="primary" [disabled]="saving() || !editUrl().trim()" (click)="save(entry)">{{
                      'common.save' | transloco
                    }}</sf-button>
                    <sf-button variant="ghost" (click)="cancel()">{{ 'common.cancel' | transloco }}</sf-button>
                  } @else {
                    <code class="urls__url">{{ entry.url }}</code>
                    @if (entry.overridden) {
                      <span class="urls__badge">{{ 'shared.assetUrls.manual' | transloco }}</span>
                    }
                    <span class="urls__row-actions">
                      @if (canOverride()) {
                        <sf-button variant="ghost" (click)="edit(entry)">{{ 'shared.assetUrls.override' | transloco }}</sf-button>
                      }
                      @if (canReset()) {
                        <sf-button variant="ghost" (click)="reset(entry)">{{ 'shared.assetUrls.reset' | transloco }}</sf-button>
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
              <sf-button variant="ghost" (click)="startAdd()">{{ 'shared.assetUrls.setUrl' | transloco }}</sf-button>
            }
            @if (canReset() && (v.entries ?? []).length > 0) {
              <sf-button variant="ghost" (click)="resetAll()">{{ 'shared.assetUrls.resetAll' | transloco }}</sf-button>
            }
          </div>
          @if (adding()) {
            <div class="urls__add">
              <select class="urls__select" [attr.aria-label]="'shared.assetUrls.area' | transloco" [value]="addArea()" (change)="addArea.set($any($event.target).value)">
                <option value="GENERATED">{{ 'shared.assetUrls.areaBuild' | transloco }}</option>
                <option value="PREVIEW">{{ 'shared.assetUrls.areaPreview' | transloco }}</option>
              </select>
              @if (v.targetType !== 'MEDIA') {
                <select class="urls__select" [attr.aria-label]="'shared.assetUrls.channel' | transloco" [value]="addChannel()" (change)="addChannel.set($any($event.target).value)">
                  @for (key of channels(); track key) {
                    <option [value]="key">{{ key }}</option>
                  }
                </select>
              }
              @if (locales().length > 0) {
                <select class="urls__select" [attr.aria-label]="'shared.assetUrls.language' | transloco" [value]="addLocale()" (change)="addLocale.set($any($event.target).value)">
                  @for (locale of locales(); track locale.code) {
                    <option [value]="locale.code">{{ locale.label ?? locale.code }}</option>
                  }
                  @if (v.targetType === 'MEDIA') {
                    <option value="">{{ 'shared.assetUrls.notLocalized' | transloco }}</option>
                  }
                </select>
              }
              <input
                class="urls__input"
                type="text"
                [attr.aria-label]="'shared.assetUrls.newUrl' | transloco"
                [attr.placeholder]="'shared.assetUrls.placeholder' | transloco"
                [value]="addUrl()"
                (input)="addUrl.set($any($event.target).value)"
                (keydown.enter)="add()"
              />
              <sf-button variant="primary" [disabled]="saving() || !addUrl().trim()" (click)="add()">{{ 'common.save' | transloco }}</sf-button>
              <sf-button variant="ghost" (click)="adding.set(false)">{{ 'common.cancel' | transloco }}</sf-button>
            </div>
          }
        }
      }
    </div>
  `,
  styleUrl: './asset-urls.component.scss',
})
export class SfAssetUrlsComponent {
  readonly projectKey = input.required<string>();
  readonly assetUuid = input.required<string>();
  /** Reloads when it changes (e.g. the asset's revision after a save or a rename). */
  readonly refreshKey = input<unknown>(null);

  private readonly api = inject(UrlRegistryService);
  private readonly channelsApi = inject(ChannelsService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly permissions = inject(ProjectPermissionsStore);
  protected readonly locales = inject(LocalesStore).locales;

  protected readonly view = signal<UrlRegistryAssetView | null>(null);
  protected readonly loading = signal(false);
  /** The registry could not be read (a project that never built, an old server): a quiet note with Retry, no toast. */
  protected readonly failed = signal(false);

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
    this.failed.set(false);
    this.api.forAsset(key, uuid).subscribe({
      next: (view) => {
        this.view.set(view);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.view.set(null);
        this.failed.set(true);
      },
    });
  }

  protected reload(): void {
    this.load(this.projectKey(), this.assetUuid());
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
        this.toasts.show(this.transloco.translate('shared.assetUrls.saved'), 'success');
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
          this.toasts.show(this.transloco.translate('shared.assetUrls.saved'), 'success');
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
        this.toasts.show(this.transloco.translate('shared.assetUrls.wasReset'), 'success');
        this.load(this.projectKey(), this.assetUuid());
      },
      error: () => this.toasts.show(this.transloco.translate('shared.assetUrls.resetFailed'), 'error'),
    });
  }

  protected resetAll(): void {
    this.api.reset(this.projectKey(), { targetUuid: this.assetUuid() }).subscribe({
      next: () => {
        this.toasts.show(this.transloco.translate('shared.assetUrls.allWereReset'), 'success');
        this.load(this.projectKey(), this.assetUuid());
      },
      error: () => this.toasts.show(this.transloco.translate('shared.assetUrls.resetAllFailed'), 'error'),
    });
  }
}
