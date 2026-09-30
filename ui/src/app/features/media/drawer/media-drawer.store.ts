import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../../core/api/api.client';
import { EditingLocaleStore } from '../../../core/project/editing-locale.store';
import { LocalesStore } from '../../../core/project/locales.store';
import { ProjectAccessStore } from '../../../core/project/project-access.store';
import { ToastService } from '../../../core/ui/toast.service';

export type MediaView = components['schemas']['MediaView'];
export type Diagnostic = components['schemas']['Diagnostic'];

/** Details for every file; Source and Rendered for text media (M18.4.1). */
export type MediaDrawerTab = 'details' | 'source' | 'rendered';

/** What the drawer component hands its store: the inputs (as signals) and the outputs it forwards. */
export interface MediaDrawerSource {
  readonly projectKey: Signal<string>;
  readonly media: Signal<MediaView>;
  readonly updated: (media: MediaView) => void;
  readonly deleted: (uuid: string) => void;
}

/**
 * State the drawer's parts share: which file is open, its revision, the active tab and the flags the server keeps
 * per file. Provided by `MediaDetailDrawerComponent`, so every drawer has its own.
 */
@Injectable()
export class MediaDrawerStore {
  readonly api = inject(ApiClient);
  readonly toasts = inject(ToastService);
  /** The language alt text and caption are edited in (M24.4.1); `null` without languages. */
  readonly editingLocale = inject(EditingLocaleStore);
  readonly locales = inject(LocalesStore);
  private readonly access = inject(ProjectAccessStore);

  /** Time travel or an archived project (M26). */
  readonly readOnly = this.access.readOnly;
  readonly readOnlyLabel = this.access.readOnlyLabel;

  projectKey!: Signal<string>;
  media!: Signal<MediaView>;
  private source!: MediaDrawerSource;

  readonly revision = signal<number | null>(null);
  readonly tab = signal<MediaDrawerTab>('details');
  readonly processCms = signal(false);
  /** Warnings and errors of the last switch-on attempt. */
  readonly processDiagnostics = signal<Diagnostic[]>([]);
  readonly localized = signal(false);

  /** The switch exists only in a project with languages. */
  readonly showLocalization = computed(() => this.locales.isLocalized());
  readonly textEditable = computed(() => this.media()?.textEditable ?? false);
  readonly variants = computed(() => this.media()?.variants ?? []);

  /** Wires the drawer's inputs and outputs in; called once, first thing in the component's constructor. */
  connect(source: MediaDrawerSource): void {
    this.source = source;
    this.projectKey = source.projectKey;
    this.media = source.media;
  }

  emitUpdated(media: MediaView): void {
    this.source.updated(media);
  }

  emitDeleted(uuid: string): void {
    this.source.deleted(uuid);
  }

  /** A server answer that changed the file: follow its revision and localized flag, tell the library. */
  applyUpdated(updated: MediaView): void {
    this.revision.set(updated.revision ?? null);
    this.localized.set(updated.localized ?? false);
    this.emitUpdated(updated);
  }

  /**
   * The value of the language being edited. An untranslated field shows empty rather than the
   * inherited text, so saving it can't silently copy another language's words into this one.
   */
  localizedMetadata(byLocale: Record<string, string> | undefined | null, resolved: string | undefined | null): string {
    const locale = this.editingLocale.locale();
    if (!byLocale || !locale) {
      return resolved ?? '';
    }
    return byLocale[locale] ?? '';
  }
}
