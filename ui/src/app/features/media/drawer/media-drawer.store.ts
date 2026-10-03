import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { TranslocoService, type HashMap } from '@jsverse/transloco';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../../core/api/api.client';
import { EditingLocaleStore } from '../../../core/project/editing-locale.store';
import { LocalesStore } from '../../../core/project/locales.store';
import { ProjectAccessStore } from '../../../core/project/project-access.store';
import { ProjectPermissionsStore } from '../../../core/project/project-permissions.store';
import { ToastService } from '../../../core/ui/toast.service';
import { TimeTravelStore } from '../../revisions/time-travel.store';
import { isRaster } from '../library/media-library.util';

export type MediaView = components['schemas']['MediaView'];
export type Diagnostic = components['schemas']['Diagnostic'];

/** Every tab the detail drawer can show (decision 21); {@link tabsFor} says which apply to a file. */
export type MediaDrawerTab = 'details' | 'variants' | 'languages' | 'processing' | 'rendered' | 'source' | 'usedby' | 'versions';

export const MEDIA_DRAWER_TABS: readonly MediaDrawerTab[] = [
  'details',
  'variants',
  'languages',
  'processing',
  'rendered',
  'source',
  'usedby',
  'versions',
];

/**
 * The tabs that apply to a file: Details always; Variants for pictures with generated sizes; Languages for every file;
 * Processing and Source for text media, Rendered while CMS syntax is processed; Used by and Versions always.
 */
export function tabsFor(media: Pick<MediaView, 'mimeType' | 'textEditable'> | null | undefined, processCms: boolean): MediaDrawerTab[] {
  const tabs: MediaDrawerTab[] = ['details'];
  if (isRaster(media?.mimeType)) {
    tabs.push('variants');
  }
  tabs.push('languages');
  if (media?.textEditable) {
    tabs.push('processing');
    if (processCms) {
      tabs.push('rendered');
    }
    tabs.push('source');
  }
  tabs.push('usedby', 'versions');
  return tabs;
}

/** The tab a `?mtab=` value names, or `null` for anything else. */
export function tabOf(value: string | null | undefined): MediaDrawerTab | null {
  return MEDIA_DRAWER_TABS.find((tab) => tab === value) ?? null;
}

/** What the drawer component hands its store: the inputs (as signals) and the outputs it forwards. */
export interface MediaDrawerSource {
  readonly projectKey: Signal<string>;
  /** The file the drawer was opened on: a list row (a summary) or a full view. */
  readonly media: Signal<MediaView>;
  /** The tab the URL names, `null` for Details. */
  readonly tab: Signal<string | null>;
  readonly tabChange: (tab: MediaDrawerTab) => void;
  /** The UIDs of the project's media, for the Source tab's name completion. */
  readonly mediaUids?: Signal<readonly string[]>;
  readonly updated: (media: MediaView) => void;
  readonly deleted: (uuid: string) => void;
}

/**
 * State the drawer's parts share: the open file (read in full — a list row carries no alt text, variants or language
 * files), its revision, the shown tab and the flags the server keeps per file. Provided by `MediaDetailDrawerComponent`,
 * so every drawer has its own.
 */
@Injectable()
export class MediaDrawerStore {
  readonly api = inject(ApiClient);
  readonly toasts = inject(ToastService);
  /** The language alt text and caption are edited in (M24.4.1); `null` without languages. */
  readonly editingLocale = inject(EditingLocaleStore);
  readonly locales = inject(LocalesStore);
  readonly permissions = inject(ProjectPermissionsStore);
  private readonly access = inject(ProjectAccessStore);
  private readonly timeTravel = inject(TimeTravelStore);
  private readonly transloco = inject(TranslocoService);

  /** Time travel or an archived project (M26). */
  readonly readOnly = this.access.readOnly;
  readonly readOnlyLabel = this.access.readOnlyLabel;

  projectKey!: Signal<string>;
  private source!: MediaDrawerSource;
  private base!: Signal<MediaView>;

  /** The file in full, as the server last answered; `null` until it was read. */
  private readonly detail = signal<MediaView | null>(null);
  readonly loading = signal(false);
  readonly loadFailed = signal(false);
  /** The open file: the full view once read (with the opened row's release state), else the row. */
  readonly media = computed<MediaView>(() => {
    const base = this.base();
    const detail = this.detail();
    if (detail && detail.uuid === base?.uuid) {
      // The row is what the library keeps current: a release state and a UID changed from outside (the Rename dialog).
      const shown = base.release ? { ...detail, release: base.release, scheduled: base.scheduled } : detail;
      return base.uid && base.uid !== shown.uid ? { ...shown, uid: base.uid } : shown;
    }
    return base;
  });
  /** The file has been read in full (alt text, focal point, variants and language files are known). */
  readonly ready = computed(() => this.detail() !== null && this.detail()?.uuid === this.base()?.uuid);

  readonly revision = signal<number | null>(null);
  /** The last switch-on attempt's findings (warnings of the answer, or the 422's diagnostics). */
  readonly processDiagnostics = signal<Diagnostic[]>([]);
  readonly processCms = computed(() => this.media()?.processCms ?? false);
  readonly localized = computed(() => this.media()?.localized ?? false);
  readonly textEditable = computed(() => this.media()?.textEditable ?? false);
  readonly variants = computed(() => this.media()?.variants ?? []);

  readonly mediaUids = computed<readonly string[]>(() => this.source?.mediaUids?.() ?? []);

  /** The switch exists only in a project with languages. */
  readonly showLocalization = computed(() => this.locales.isLocalized());

  /** The tabs that apply to the open file. */
  readonly tabs = computed(() => tabsFor(this.media(), this.processCms()));
  /** The shown tab: the one the URL names when it applies to the file, else Details. */
  readonly tab = computed<MediaDrawerTab>(() => {
    const wanted = tabOf(this.source?.tab());
    return wanted && this.tabs().includes(wanted) ? wanted : 'details';
  });

  /** A string of the drawer: `media.drawer.<key>`. */
  t(key: string, params?: HashMap): string {
    return this.transloco.translate(`media.drawer.${key}`, params);
  }

  /** Wires the drawer's inputs and outputs in; called once, first thing in the component's constructor. */
  connect(source: MediaDrawerSource): void {
    this.source = source;
    this.projectKey = source.projectKey;
    this.base = source.media;
  }

  selectTab(tab: MediaDrawerTab): void {
    this.source.tabChange(tab);
  }

  /** Reads the open file in full (at the viewed revision in time travel); the answer replaces what is known. */
  loadDetail(): void {
    const uuid = this.base()?.uuid;
    if (!uuid) {
      return;
    }
    this.loading.set(true);
    this.loadFailed.set(false);
    this.api.mediaDetail(this.projectKey(), uuid, this.timeTravel.activeRevision()).subscribe({
      next: (view) => {
        if (this.base()?.uuid === uuid) {
          this.adopt(view);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadFailed.set(true);
      },
    });
  }

  /** Takes a full view the server answered: the file now shows it, and the revision follows. */
  adopt(view: MediaView): void {
    this.detail.set(view);
    this.revision.set(view.revision ?? null);
  }

  emitUpdated(media: MediaView): void {
    this.source.updated(media);
  }

  emitDeleted(uuid: string): void {
    this.source.deleted(uuid);
  }

  /** A server answer that changed the file: show it, follow its revision, tell the library. */
  applyUpdated(updated: MediaView): void {
    this.adopt(updated);
    this.emitUpdated(updated);
  }

  /**
   * The value of the language being edited. An untranslated field shows empty rather than the
   * inherited text, so saving it can not silently copy another language's words into this one.
   */
  localizedMetadata(byLocale: Record<string, string> | undefined | null, resolved: string | undefined | null): string {
    const locale = this.editingLocale.locale();
    if (!byLocale || !locale) {
      return resolved ?? '';
    }
    return byLocale[locale] ?? '';
  }
}
