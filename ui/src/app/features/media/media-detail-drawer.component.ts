import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { SfAssetFavoriteComponent } from '../../shared/components/sf-asset-favorite.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfAssetImpactComponent } from '../generation/insight/sf-asset-impact.component';
import { ConflictDrawerComponent } from '../pages/conflict-drawer.component';
import { ReleaseBarComponent } from '../release/release-bar.component';
import type { ReleaseMode } from '../release/release-choice.util';
import { SfAssetUrlsComponent } from '../settings/asset-urls.component';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { MediaDrawerFilesStore } from './drawer/media-drawer-files.store';
import { MediaDrawerLocalizationComponent } from './drawer/media-drawer-localization.component';
import { MediaDrawerMetadataComponent } from './drawer/media-drawer-metadata.component';
import { MediaDrawerMetadataStore } from './drawer/media-drawer-metadata.store';
import { MediaDrawerPreviewComponent } from './drawer/media-drawer-preview.component';
import { MediaDrawerPreviewStore } from './drawer/media-drawer-preview.store';
import { MediaDrawerProcessComponent } from './drawer/media-drawer-process.component';
import { MediaDrawerRenderedComponent } from './drawer/media-drawer-rendered.component';
import { MediaDrawerSourceComponent } from './drawer/media-drawer-source.component';
import { MediaDrawerTextStore } from './drawer/media-drawer-text.store';
import { MediaDrawerUsagesComponent } from './drawer/media-drawer-usages.component';
import { MediaDrawerUsagesStore } from './drawer/media-drawer-usages.store';
import { MediaDrawerVariantsComponent } from './drawer/media-drawer-variants.component';
import { MediaDrawerStore, type MediaView } from './drawer/media-drawer.store';

export type { MediaDrawerTab } from './drawer/media-drawer.store';

/**
 * The detail drawer of one media file: the shell (header, tabs, footer, conflict overlay) around its parts. The
 * parts and the drawer's logic share the feature-scoped stores provided here; the effects that react to the inputs
 * stay in this constructor, in one place, so their order under zoneless change detection is explicit.
 */
@Component({
  selector: 'sf-media-detail-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfAssetFavoriteComponent,
    SfFieldComponent,
    SfButtonComponent,
    ConflictDrawerComponent,
    SfAssetImpactComponent,
    SfAssetUrlsComponent,
    ReleaseBarComponent,
    MediaDrawerPreviewComponent,
    MediaDrawerProcessComponent,
    MediaDrawerSourceComponent,
    MediaDrawerRenderedComponent,
    MediaDrawerLocalizationComponent,
    MediaDrawerMetadataComponent,
    MediaDrawerVariantsComponent,
    MediaDrawerUsagesComponent,
  ],
  providers: [
    MediaDrawerStore,
    MediaDrawerPreviewStore,
    MediaDrawerMetadataStore,
    MediaDrawerTextStore,
    MediaDrawerFilesStore,
    MediaDrawerUsagesStore,
  ],
  templateUrl: './media-detail-drawer.component.html',
  styleUrl: './media-detail-drawer.component.scss',
})
export class MediaDetailDrawerComponent implements OnInit {
  readonly projectKey = input.required<string>();
  readonly media = input.required<MediaView>();

  readonly closed = output<void>();
  readonly updated = output<MediaView>();
  readonly deleted = output<string>();
  /** Discard changes rewrote the draft (M27.6.1): the library reloads the file and reopens the drawer. */
  readonly discarded = output<string>();

  protected readonly store = inject(MediaDrawerStore);
  protected readonly text = inject(MediaDrawerTextStore);
  private readonly metadata = inject(MediaDrawerMetadataStore);
  private readonly preview = inject(MediaDrawerPreviewStore);
  protected readonly files = inject(MediaDrawerFilesStore);
  protected readonly usages = inject(MediaDrawerUsagesStore);
  private readonly timeTravel = inject(TimeTravelStore);
  /** Time travel or an archived project (M26). */
  protected readonly readOnly = this.store.readOnly;
  protected readonly readOnlyLabel = this.store.readOnlyLabel;

  private lastPreviewUuid: string | null = null;
  private lastTextUuid: string | null = null;
  private lastTimeTravelRevision: number | null = null;
  /** The language the alt text and caption fields currently hold; `null` before the first seed. */
  private lastEditingLocale: string | null = null;

  constructor() {
    this.store.connect({
      projectKey: this.projectKey,
      media: this.media,
      updated: (media) => this.updated.emit(media),
      deleted: (uuid) => this.deleted.emit(uuid),
    });
    effect(() => {
      const uuid = this.media()?.uuid;
      const key = this.projectKey();
      // Localized media previews the editing language's file (M27.6.4); a new file of it previews again.
      const locale = this.media()?.localized ? this.store.editingLocale.locale() : null;
      const previewKey = `${uuid}|${locale ?? ''}|${this.media()?.revision ?? ''}`;
      if (!uuid || !key || previewKey === this.lastPreviewUuid) {
        return;
      }
      this.lastPreviewUuid = previewKey;
      untracked(() => this.preview.loadPreview(key, uuid, locale));
    });
    // A drawer opened from a list row has no `localeFiles`: the server resolves them, once per version.
    effect(() => {
      const media = this.media();
      const key = this.projectKey();
      const viewed = this.timeTravel.activeRevision();
      this.store.locales.config();
      untracked(() => this.files.loadLocaleFiles(key, media, viewed));
    });
    // Thumbnails of the languages that have their own image file, re-fetched only when that file changes.
    effect(() => {
      const rows = this.files.fileRows();
      const key = this.projectKey();
      const uuid = this.media()?.uuid;
      untracked(() => {
        if (uuid) {
          this.files.loadLocaleThumbs(key, uuid, rows);
        }
      });
    });
    // Another file: start over on its Details tab; the same file saved: follow its flag.
    effect(() => {
      const media = this.media();
      untracked(() => {
        if (media.uuid !== this.lastTextUuid) {
          this.lastTextUuid = media.uuid ?? null;
          this.store.revision.set(media.revision ?? null);
          // The library reuses this drawer when another file is picked: the form has to follow.
          this.metadata.seedForm(media);
          this.text.resetLocaleChoice();
          this.store.processDiagnostics.set([]);
          this.text.resetText();
          this.store.tab.set('details');
        }
        this.store.processCms.set(media.processCms ?? false);
        this.store.localized.set(media.localized ?? false);
      });
    });
    // Alt text and caption are stored per language, so the two fields have to be re-seeded when
    // the editing language changes — otherwise they keep showing (and would save) the previous
    // language's words under the new one (M24.4.1). An unsaved draft of the language being left
    // behind is dropped: this drawer saves one language explicitly, and it was never going to be
    // written by a save made in another one.
    effect(() => {
      const locale = this.store.editingLocale.locale();
      untracked(() => {
        if (locale === this.lastEditingLocale) {
          return;
        }
        this.lastEditingLocale = locale;
        this.metadata.reseedLanguageFields(this.media());
      });
    });
    // Entering or leaving time travel shows the file at the viewed revision.
    effect(() => {
      const viewed = this.timeTravel.activeRevision();
      untracked(() => {
        if (viewed === this.lastTimeTravelRevision) {
          return;
        }
        this.lastTimeTravelRevision = viewed;
        this.text.resetText();
        this.text.openTab(this.store.tab());
      });
    });
  }

  ngOnInit(): void {
    const media = this.media();
    this.store.revision.set(media.revision ?? null);
    this.lastEditingLocale = this.store.editingLocale.locale();
    this.metadata.seedForm(media);
    this.usages.loadUsages();
  }

  closeDrawer(): void {
    if (!this.confirmDiscard()) {
      return;
    }
    this.closed.emit();
  }

  /**
   * `true` when there are no unsaved source edits, or the user agrees to drop them. The library calls
   * this before switching the drawer to another file.
   */
  confirmDiscard(): boolean {
    return this.text.confirmDiscard();
  }

  save(): void {
    this.metadata.save();
  }

  onReplaceFile(event: Event): void {
    this.files.onReplaceFile(event);
  }

  confirmDelete(): void {
    void this.usages.confirmDelete();
  }

  protected onReleaseChanged(mode: ReleaseMode): void {
    const uuid = this.media()?.uuid;
    if (mode === 'discard' && uuid) {
      this.discarded.emit(uuid);
    }
  }
}
