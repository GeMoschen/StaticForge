import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { createShortcut } from '../../core/ui/documented-shortcuts';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ActivatedRoute, Router } from '@angular/router';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { tap } from 'rxjs';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService } from '../../core/ui/undo.service';
import { templateKindOfFolderPath } from '../../shared/asset-route.util';
import { EMPTY_SECTIONS, cdlFields } from '../../shared/code-editor/cdl-sections';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfCreateAssetDialogComponent, type CreateAssetFormValue } from '../../shared/components/sf-create-asset-dialog.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { consumeQueryParam } from '../../shared/deep-link';
import { SfAssetImpactComponent } from '../generation/insight/sf-asset-impact.component';
import { ContentService } from '../content/content.service';
import { DatasetSchemaEditorComponent, type DeletedDataset } from '../content/dataset-schema-editor.component';
import { TemplateCdlPanelComponent } from './templates-cdl-panel.component';
import { TemplateChannelPanelComponent } from './templates-channel-panel.component';
import { TemplatesEditing } from './templates-editing';
import { TemplatesLoader } from './templates-loader';
import { TemplateMetaHeaderComponent } from './templates-meta-header.component';
import { TemplateSaveOutcomesComponent } from './templates-save-outcomes.component';
import { TemplatesSaveCoordinator } from './templates-save.coordinator';
import { TemplatesTreePaneComponent } from './templates-tree-pane.component';
import { TemplatesService } from './templates.service';
import { TemplatesStore } from './templates.store';
import { findFolder, findFolderByUid, rootKindOf } from './templates.util';
import {
  DATASETS_ROOT_UID,
  PAGE_TEMPLATES_ROOT_UID,
  SECTION_TEMPLATES_ROOT_UID,
  TEMPLATES_ROOT_UID,
  type TemplateAssetKind,
} from './types';
import { useFrameItem } from '../../core/frame/use-frame-item';
import { ActiveEditorService } from '../../core/editor/active-editor.service';

/** What a new dataset starts with: one field, so its first record already has something to fill in. */
const NEW_DATASET_CONTENT = `editor text name { label "Name" required }
`;

/**
 * The templates screen: a folder tree on the left, the open template (or dataset) on the right. This component wires
 * the screen together — route inputs, the effects that load and select, the "new template" and delete dialogs; the
 * state lives in `TemplatesStore` and the parts in the `sf-template-*` components next to it.
 */
@Component({
  selector: 'sf-templates',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfButtonComponent,
    SfCreateAssetDialogComponent,
    SfEmptyStateComponent,
    SfAssetImpactComponent,
    DatasetSchemaEditorComponent,
    TemplatesTreePaneComponent,
    TemplateMetaHeaderComponent,
    TemplateSaveOutcomesComponent,
    TemplateCdlPanelComponent,
    TemplateChannelPanelComponent,
  ],
  providers: [TemplatesStore, TemplatesEditing, TemplatesLoader, TemplatesSaveCoordinator],
  templateUrl: './templates.component.html',
  styleUrls: ['./templates.component.scss', './templates-panel.scss', './templates-editors.scss'],
})
export class TemplatesComponent {
  readonly projectKey = input.required<string>();
  /** `?kind=DATASET` opens the store on the datasets folder (the Content store's empty state links here). */
  readonly kind$ = input<string | undefined>(undefined, { alias: 'kind' });
  /** `?asset=<uuid>` selects that template or dataset, `?folder=<uuid>` that folder (search deep links, M23.4.1). */
  readonly asset = input<string | undefined>();
  readonly folder = input<string | undefined>();

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(TemplatesService);
  private readonly contentService = inject(ContentService);
  private readonly toast = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly projectContext = inject(ProjectContextStore);
  protected readonly store = inject(TemplatesStore);
  protected readonly save = inject(TemplatesSaveCoordinator);
  private readonly loader = inject(TemplatesLoader);

  readonly newTemplateOpen = signal(false);
  readonly creatingTemplate = signal(false);
  readonly createDialogKind = computed<TemplateAssetKind>(() => this.store.activeTemplateKind());

  constructor() {
    this.store.bind(this.projectKey);
    // The open template is an editor for the frame (M35.13): Ctrl+S, the leave guard and the tab-close prompt.
    const unregister = inject(ActiveEditorService).register(this.save.asEditorState());
    inject(DestroyRef).onDestroy(unregister);
    // The open template or dataset: the breadcrumb ends with it, and the History drawer shows its versions (M35.12).
    useFrameItem(() => {
      const uuid = this.store.selectedUuid();
      const open = uuid ? this.store.templates().find((t) => t.uuid === uuid) : null;
      const label = open?.displayName || open?.uid;
      return label && uuid ? { label, asset: { uuid } } : null;
    });

    effect(() => {
      const key = this.projectKey();
      if (!key) {
        return;
      }
      this.projectContext.loadFor(key).subscribe();
    });

    effect(
      () => {
        const key = this.projectKey();
        if (!key) {
          return;
        }
        this.loader.reloadList(key);
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const key = this.projectKey();
        if (!key) {
          return;
        }
        this.loader.reloadChannels(key);
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const key = this.projectKey();
        const uuid = this.store.selectedUuid();
        if (!key || !uuid || this.store.datasetSelected()) {
          this.store.detail.set(null);
          return;
        }
        this.loader.reloadDetail(key, uuid);
      },
      { allowSignalWrites: true },
    );

    effect(() => {
      const uuid = this.asset();
      if (!uuid) {
        return;
      }
      untracked(() => {
        this.store.selectedUuid.set(uuid);
        consumeQueryParam(this.router, this.route, 'asset');
      });
    });
    effect(() => {
      const uuid = this.folder();
      const node = uuid ? findFolder(this.store.templateFolderTree(), uuid) : null;
      if (!node?.uuid) {
        return;
      }
      const folderUuid = node.uuid;
      untracked(() => {
        this.store.selectFolder({ uuid: folderUuid, templateKind: templateKindOfFolderPath(node.path) });
        consumeQueryParam(this.router, this.route, 'folder');
      });
    });

    // Once the templates tree loads, default the selection to the "Page Templates" root so the
    // screen isn't blank on first load — mirrors `reloadList`'s existing "auto-select the first
    // row" behavior, one level up (auto-select the first *folder*). Also resets the selection if
    // it ever points at a folder no longer in the tree (e.g. it was just deleted).
    effect(
      () => {
        const tree = this.store.templateFolderTree();
        const selected = this.store.selectedFolder();
        if (selected !== null && findFolder(tree, selected)) {
          return;
        }
        if (tree.length === 0) {
          this.store.selectedFolder.set(null);
          this.store.selectedFolderKind.set(null);
          return;
        }
        // PAGE_TEMPLATES_ROOT_UID is no longer necessarily top-level — it now nests one level
        // inside the fixed "All Templates" wrapper root (M13.1.2, generalized) — so this needs
        // a recursive lookup, not a flat top-level `.find`.
        const preferredUid = untracked(() => this.kind$()) === 'DATASET' ? DATASETS_ROOT_UID : PAGE_TEMPLATES_ROOT_UID;
        const root = findFolderByUid(tree, preferredUid) ?? tree[0];
        if (root.uuid) {
          this.store.selectedFolder.set(root.uuid);
          this.store.selectedFolderKind.set(rootKindOf(root));
        }
      },
      { allowSignalWrites: true },
    );
  }

  /** `n` creates a template (M35.14). */
  private readonly newTemplateShortcut = inject(ShortcutService).use([
    createShortcut({
      handler: () => (this.store.readOnly() ? false : this.newTemplate()),
      palette: { label: 'frame.shortcuts.items.createTemplate' },
    }),
  ]);

  newTemplate(): void {
    if (this.store.readOnly()) {
      return;
    }
    this.newTemplateOpen.set(true);
  }

  closeNewTemplate(): void {
    this.newTemplateOpen.set(false);
  }

  /** Target folder for a newly-created template (M13.3.2 step 1): the selected folder if one
   * is selected and it isn't the ambiguous "All Templates" wrapper root (which has no kind of
   * its own — content can never live directly under it), else the fixed root matching the
   * currently-relevant kind. In practice `selectedFolder` is only ever null before the tree's
   * first load — the auto-select-root effect above keeps it pointed at a real folder from then
   * on — but the fallback keeps this correct even if that changes. */
  private newTemplateParentUuid(): string | undefined {
    const tree = this.store.templateFolderTree();
    const selected = this.store.selectedFolder();
    const selectedNode = selected ? findFolder(tree, selected) : null;
    if (selectedNode && selectedNode.uid !== TEMPLATES_ROOT_UID) {
      return selected ?? undefined;
    }
    const kind = this.store.activeTemplateKind();
    const rootUid =
      kind === 'SECTION_TEMPLATE' ? SECTION_TEMPLATES_ROOT_UID : kind === 'DATASET' ? DATASETS_ROOT_UID : PAGE_TEMPLATES_ROOT_UID;
    return findFolderByUid(tree, rootUid)?.uuid;
  }

  submitNewTemplate(value: CreateAssetFormValue): void {
    const key = this.projectKey();
    if (!key || this.store.readOnly()) {
      return;
    }
    this.creatingTemplate.set(true);
    if (this.store.activeTemplateKind() === 'DATASET') {
      this.contentService
        .createDataset(key, {
          displayName: value.displayName,
          contentCdl: NEW_DATASET_CONTENT,
          titleEditor: 'name',
          parentFolderUuid: this.newTemplateParentUuid(),
        })
        .subscribe({
          next: (created) => {
            this.creatingTemplate.set(false);
            this.newTemplateOpen.set(false);
            this.toast.show('Dataset created', 'success');
            this.loader.reloadList(key, created.uuid ?? null);
            this.loader.refreshTemplateStore();
          },
          error: () => {
            this.creatingTemplate.set(false);
            this.toast.show('Could not create the dataset — you may need the developer role.', 'error');
          },
        });
      return;
    }
    this.service
      .create(this.store.kind(), key, {
        displayName: value.displayName,
        ...cdlFields(EMPTY_SECTIONS),
        channelSources: {},
        parentFolderUuid: this.newTemplateParentUuid(),
      })
      .subscribe({
        next: (created) => {
          this.creatingTemplate.set(false);
          this.newTemplateOpen.set(false);
          this.toast.show('Template created', 'success');
          this.loader.reloadList(key);
          this.store.selectedUuid.set(created.uuid ?? null);
          this.loader.refreshTemplateStore();
        },
        error: () => {
          this.creatingTemplate.set(false);
          this.toast.show('Could not create template — try again in a moment.', 'error');
        },
      });
  }

  protected onDatasetChanged(): void {
    this.loader.onDatasetChanged();
  }

  protected onDatasetDeleted(deleted: DeletedDataset): void {
    const key = this.projectKey();
    this.loader.onDatasetDeleted();
    // Undo brings the dataset back as its last live version was.
    this.undo.offer(`Deleted “${deleted.name}”.`, () =>
      this.contentService.restoreDataset(key, deleted.uuid).pipe(tap(() => this.loader.onTreeChanged())),
    );
  }
}
