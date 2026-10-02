import { inject, Injectable } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { sectionsOf } from '../../shared/code-editor/cdl-sections';
import { ChannelsService } from '../channels/channels.service';
import { ContentService } from '../content/content.service';
import { childTemplates, type UsageLike } from './inheritance.util';
import { readPaginationPaths } from './pagination-path.util';
import { TemplatesEditing } from './templates-editing';
import { TemplatesService, type TemplateDetail, type TemplateSummary } from './templates.service';
import { TemplatesStore } from './templates.store';
import { channelSourcesOf } from './templates.util';

/** Loads the screen's data into `TemplatesStore`: the template list, the channels and the selected template. */
@Injectable()
export class TemplatesLoader {
  private readonly store = inject(TemplatesStore);
  private readonly editing = inject(TemplatesEditing);
  private readonly service = inject(TemplatesService);
  private readonly contentService = inject(ContentService);
  private readonly channelsService = inject(ChannelsService);
  private readonly projectContext = inject(ProjectContextStore);
  private readonly toast = inject(ToastService);
  private readonly api = inject(ApiClient);

  /** `ProjectContextStore.pageTemplates`/`sectionTemplates` (used by the "new page" template picker and the page editor's "add section" palette) — AND, as of M13.3, `templateFolderTree` — are only loaded once per project — force a refresh whenever a template or folder is created/renamed/moved/deleted here so those stay in sync without an F5. */
  refreshTemplateStore(): void {
    const key = this.store.projectKey();
    if (key) {
      this.projectContext.loadFor(key, true).subscribe();
    }
  }

  /** Reloads the folder tree and this kind's template list — used after any folder
   * create/rename/move/delete, and after a template is moved via cut/paste. */
  onTreeChanged(): void {
    const key = this.store.projectKey();
    if (!key) {
      return;
    }
    this.reloadList(key);
    this.refreshTemplateStore();
  }

  onDatasetChanged(): void {
    const key = this.store.projectKey();
    if (key) {
      this.reloadList(key);
    }
  }

  onDatasetDeleted(): void {
    this.store.selectedUuid.set(null);
    this.onDatasetChanged();
    this.refreshTemplateStore();
  }

  onUidChanged(): void {
    const key = this.store.projectKey();
    const uuid = this.store.selectedUuid();
    if (!key || !uuid) {
      return;
    }
    this.reloadDetail(key, uuid);
    this.reloadList(key);
    this.refreshTemplateStore();
  }

  /** Fetches BOTH template kinds and merges them into one list, always — deliberately not
   * scoped to `store.kind()`. This tree has two fixed roots ("Page Templates"/"Section
   * Templates") shown at once, exactly like any other store's tree can have multiple top-level
   * folders shown at once; scoping the fetch to "whichever kind is currently selected" (the old
   * behavior) meant selecting something under one root silently emptied the other root's
   * branch in the tree until you selected something back under it — a "switching" UI the other
   * stores don't have and this one shouldn't either. `store.kind()` still exists and is still
   * correct to use for *per-item* operations (create/save/delete/channel calls scoped to
   * whichever one template is selected), just never again for "what to fetch". */
  reloadList(key: string, select: string | null = null): void {
    this.store.loading.set(true);
    forkJoin({
      page: this.service.list('page', key),
      section: this.service.list('section', key),
      datasets: this.contentService.listDatasets(key),
    }).subscribe({
      next: ({ page, section, datasets }) => {
        // Datasets (M19.4.1) share the tree as leaves of the fixed "Datasets" folder.
        const datasetLeaves: TemplateSummary[] = (datasets ?? []).map((d) => ({
          uuid: d.uuid,
          uid: d.uid,
          assetType: 'DATASET',
          displayName: d.displayName,
          folderPath: d.folderPath,
          revision: d.revision,
        }));
        const list = [...(page.content ?? []), ...(section.content ?? []), ...datasetLeaves];
        this.store.templates.set(list);
        this.store.loading.set(false);
        if (select) {
          this.store.selectedUuid.set(select);
          return;
        }
        const current = this.store.selectedUuid();
        if (!current && list.length > 0) {
          this.store.selectedUuid.set(list[0].uuid ?? null);
        }
      },
      error: () => {
        this.toast.show('Could not load templates — check your connection and try again.', 'error');
        this.store.loading.set(false);
      },
    });
  }

  reloadChannels(key: string): void {
    this.channelsService.list(key).subscribe({
      next: (list) => this.store.channels.set(list ?? []),
      error: () => this.store.channels.set([]),
    });
  }

  /**
   * @param resetOutcomes whether to clear the last save's descendant outcomes (not when reloading after that save)
   * @param keepEditsWhile after a save: when it answers true once the reload arrives, edits made while the reload was in
   *   flight stay (M34), only an unchanged form is refreshed — the reload must never take back what the user typed
   *   after pressing Save
   */
  /** Gives the unsaved edits up (M35.13): every buffer shows the saved template again, without a fetch. */
  discardEdits(): void {
    const detail = this.store.detail();
    if (detail) {
      this.applyToEditors(detail);
      this.store.templateInUse.set(null);
      this.store.descendantProblems.set([]);
    }
  }

  /** Puts a template's saved values into the editor buffers (name, category, flags, paths, CDL sections, channels). */
  private applyToEditors(detail: TemplateDetail): void {
    const store = this.store;
    store.displayName.set(detail.displayName ?? '');
    store.category.set(detail.category ?? '');
    store.deprecated.set(detail.deprecated ?? false);
    store.abstractTemplate.set(detail.abstract ?? false);
    store.paginationPaths.set(readPaginationPaths(detail.paginationPath));
    store.sections.set(sectionsOf(detail));
    store.channelSources.set(channelSourcesOf(detail));
    store.cdlDiagnostics.set([]);
    store.octlDiagnostics.set({});
  }

  reloadDetail(key: string, uuid: string, resetOutcomes = true, keepEditsWhile?: () => boolean): void {
    const store = this.store;
    this.service.get(store.kind(), key, uuid).subscribe({
      next: (detail) => {
        const edited = !!keepEditsWhile && store.detail()?.uuid === detail.uuid && keepEditsWhile();
        store.detail.set(detail);
        if (!edited) {
          this.applyToEditors(detail);
        }
        if (!store.cdlTabs().includes(store.cdlTab())) {
          store.cdlTab.set('content');
        }
        store.templateInUse.set(null);
        if (resetOutcomes) {
          store.descendantProblems.set([]);
          store.descendantWarnings.set([]);
        }
        this.reloadChildTemplates(key, detail);
        const keys = store.channelKeys();
        const selected = store.selectedChannel();
        if (!selected || !keys.includes(selected)) {
          store.selectedChannel.set(keys[0] ?? '');
        }
        this.editing.requestOctlValidation();
      },
      error: () => this.toast.show('Could not load template — check your connection and try again.', 'error'),
    });
  }

  /** "Extended by": a page template's usages recorded from its children's `parentTemplateRef`. */
  private reloadChildTemplates(key: string, detail: TemplateDetail): void {
    this.store.childTemplates.set([]);
    if (detail.assetType !== 'PAGE_TEMPLATE' || !detail.uuid) {
      return;
    }
    const uuid = detail.uuid;
    this.api.assetUsages(key, uuid).subscribe({
      next: (usages) => {
        if (this.store.detail()?.uuid === uuid) {
          this.store.childTemplates.set(childTemplates(usages as UsageLike[]));
        }
      },
      error: () => this.store.childTemplates.set([]),
    });
  }

  /** A saved template replaces the detail and its row in the list. */
  applyUpdated(updated: TemplateDetail): void {
    this.store.detail.set(updated);
    this.store.templates.update((list) =>
      list.map((t) => (t.uuid === updated.uuid ? this.summaryFrom(updated) : t)),
    );
  }

  private summaryFrom(detail: TemplateDetail): TemplateSummary {
    return {
      uuid: detail.uuid,
      uid: detail.uid,
      assetType: detail.assetType,
      displayName: detail.displayName,
      // `folderPath` is what `templatesByFolder` groups leaves by for the tree — dropping it
      // here (as this used to) silently regrouped the just-saved template under `undefined`
      // (`'/'`), which matches no real folder node, so it vanished from the tree until the
      // next full reload even though it was never actually moved.
      folderPath: detail.folderPath,
      revision: detail.revision,
      abstract: detail.abstract,
      parentTemplateRef: detail.parentTemplateRef,
    };
  }
}
