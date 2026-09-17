import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, debounceTime, forkJoin, of, Subject, switchMap } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfCreateAssetDialogComponent, type CreateAssetFormValue } from '../../shared/components/sf-create-asset-dialog.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfUidRenameComponent } from '../../shared/components/sf-uid-rename.component';
import { ChannelsService } from '../channels/channels.service';
import { sortByDisplayName } from '../../shared/tree-sort.util';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { SfAssetImpactComponent } from '../generation/insight/sf-asset-impact.component';
import { ContentService } from '../content/content.service';
import { DatasetSchemaEditorComponent } from '../content/dataset-schema-editor.component';
import { TemplateFolderNodeComponent } from './template-folder-node.component';
import {
  childTemplates,
  descendantProblemsOf,
  diagnosticsOf,
  inheritanceBreadcrumb,
  inheritedGroups,
  normalizeDescendants,
  sortDiagnostics,
  templateInUseOf,
  type DescendantProblem,
  type TemplateInUse,
  type TemplateRef,
  type UsageLike,
} from './inheritance.util';
import {
  DATASETS_ROOT_UID,
  PAGE_TEMPLATES_ROOT_UID,
  SECTION_TEMPLATES_ROOT_UID,
  TEMPLATES_ROOT_UID,
  type FolderMoveEvent,
  type TemplateAssetKind,
  type TemplateFolderSelectEvent,
} from './types';
import {
  etagFor,
  TemplatesService,
  type Diagnostic,
  type TemplateDetail,
  type TemplateKind,
  type TemplateSummary,
} from './templates.service';
import {
  DEFAULT_PAGINATION_PATH,
  declaresPagination,
  paginationPathError,
  paginationPathsForSave,
  readPaginationPaths,
} from './pagination-path.util';

type ChannelView = components['schemas']['ChannelView'];
type FolderView = components['schemas']['FolderView'];

interface ChannelTemplateValue {
  source?: string;
  compiledHash?: string;
}

const NEW_CONTENT_DEFINITION = '';

/** How long channel typing pauses before the source is validated against the template's context (M20.4.1). */
const OCTL_VALIDATE_DEBOUNCE_MS = 300;

interface OctlValidation {
  key: string;
  templateUuid: string;
  channelKey: string;
  source: string;
  contentDefinition: string;
}

/** What a new dataset starts with: one field, so its first record already has something to fill in. */
const NEW_DATASET_DEFINITION = `content {
  editor text name { label "Name" required }
}
`;

@Component({
  selector: 'sf-templates',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfButtonComponent,
    SfCreateAssetDialogComponent,
    SfEmptyStateComponent,
    SfFieldComponent,
    SfSpinnerComponent,
    SfUidRenameComponent,
    TemplateFolderNodeComponent,
    DatasetSchemaEditorComponent,
    RouterLink,
    SfAssetImpactComponent,
  ],
  templateUrl: './templates.component.html',
  styleUrls: ['./templates.component.scss', './templates-inheritance.scss', './templates-pagination.scss'],
})
export class TemplatesComponent {
  readonly projectKey = input.required<string>();
  /** `?kind=DATASET` opens the store on the datasets folder (the Content store's empty state links here). */
  readonly kind$ = input<string | undefined>(undefined, { alias: 'kind' });

  private readonly service = inject(TemplatesService);
  private readonly contentService = inject(ContentService);
  private readonly channelsService = inject(ChannelsService);
  private readonly store = inject(ProjectContextStore);
  private readonly toast = inject(ToastService);
  private readonly api = inject(ApiClient);
  private readonly timeTravel = inject(TimeTravelStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly readOnly = this.timeTravel.isTimeTravel;

  /** `ProjectContextStore.pageTemplates`/`sectionTemplates` (used by the "new page" template picker and the page editor's "add section" palette) — AND, as of M13.3, `templateFolderTree` — are only loaded once per project — force a refresh whenever a template or folder is created/renamed/moved/deleted here so those stay in sync without an F5. */
  private refreshTemplateStore(): void {
    const key = this.projectKey();
    if (key) {
      this.store.loadFor(key, true).subscribe();
    }
  }

  protected readonly templateFolderTree = this.store.templateFolderTree;
  /** The store's real top-level folders ("Page Templates"/"Section Templates") — the fixed "All
   * Templates" wrapper root (`templateFolderTree()`'s sole top-level entry) is unwrapped here so
   * it's never rendered as its own row, matching Pages/Media's tree visualization. Every other
   * consumer above still walks the raw `templateFolderTree()` (uuid/uid lookups, the
   * ambiguous-root check, etc.) — this is a display-only unwrap. */
  protected readonly topLevelFolders = computed<FolderView[]>(() => this.templateFolderTree()[0]?.children ?? []);

  /** The folder currently selected in the tree — scopes the template list to that folder's
   * direct contents and is the default target for "New template" (Task M13.3.2). */
  protected readonly selectedFolder = signal<string | null>(null);
  /** The inherited kind of `selectedFolder`, carried alongside it by `TemplateFolderSelectEvent`
   * rather than re-derived by walking the tree (see `types.ts`). */
  protected readonly selectedFolderKind = signal<TemplateAssetKind | null>(null);

  /**
   * Kind-toggle removal (M13.3.1 step 5): the old `kind` signal was a standalone toggle the
   * user flipped independently of anything else. Every place that read it (`reloadList`,
   * `reloadDetail`, `saveDefinition`, `delete`, the channel CRUD calls, `createDialogKind`)
   * only ever needed "which of the two template endpoints/kinds is currently relevant" — never
   * the toggle's on/off state itself — so it traces cleanly onto "whichever kind the current
   * tree/list selection implies". `kind` is now a *computed* derived from that selection:
   * a selected template's own `assetType` wins (you're looking straight at it), else the
   * selected folder's inherited kind, else `PAGE_TEMPLATE` as a sane first-load default. This
   * removes an entire independent piece of state (and the toggle UI) instead of layering a
   * second, redundant source of truth beside the tree.
   */
  protected readonly activeTemplateKind = computed<TemplateAssetKind>(
    () => this.selectedTemplateAssetType() ?? this.selectedFolderKind() ?? 'PAGE_TEMPLATE',
  );

  readonly kind = computed<TemplateKind>(() => (this.activeTemplateKind() === 'SECTION_TEMPLATE' ? 'section' : 'page'));

  readonly templates = signal<TemplateSummary[]>([]);
  readonly loading = signal(false);
  readonly selectedUuid = signal<string | null>(null);

  protected readonly selectedTemplateAssetType = computed<TemplateAssetKind | null>(() => {
    const uuid = this.selectedUuid();
    if (!uuid) {
      return null;
    }
    const found = this.templates().find((t) => t.uuid === uuid);
    const assetType = found?.assetType?.toUpperCase();
    return assetType === 'SECTION_TEMPLATE' || assetType === 'PAGE_TEMPLATE' || assetType === 'DATASET' ? assetType : null;
  });

  /** A dataset is selected: the detail pane is the dataset schema editor, not the template editor. */
  protected readonly datasetSelected = computed(() => this.selectedTemplateAssetType() === 'DATASET');

  /** Templates grouped by their canonical folder path — threaded down the tree so every
   * folder node can render its own templates as leaves, sorted after subfolders (mirrors
   * `PagesListComponent.pagesByFolder`/`FolderNodeComponent.ownPages`). */
  protected readonly templatesByFolder = computed<Map<string, TemplateSummary[]>>(() => {
    const map = new Map<string, TemplateSummary[]>();
    for (const t of this.templates()) {
      const path = t.folderPath ?? '/';
      const list = map.get(path);
      if (list) {
        list.push(t);
      } else {
        map.set(path, [t]);
      }
    }
    for (const [path, list] of map) {
      map.set(path, sortByDisplayName(list));
    }
    return map;
  });

  readonly detail = signal<TemplateDetail | null>(null);
  readonly displayName = signal('');
  readonly category = signal('');
  readonly deprecated = signal(false);
  readonly contentDefinition = signal('');
  readonly saving = signal(false);
  readonly cdlDiagnostics = signal<Diagnostic[]>([]);

  readonly channels = signal<ChannelView[]>([]);
  readonly selectedChannel = signal('');
  readonly channelSource = signal('');
  readonly channelSaving = signal(false);

  readonly confirmDelete = signal(false);

  // ---- Inheritance (M20.4.1) ----
  /** A page template's `abstract` flag as edited: a layout other templates extend, never used by pages. */
  readonly abstractTemplate = signal(false);
  /** A page template's per-channel path patterns of pages 2..N of a paginated page, as edited (M21). */
  readonly paginationPaths = signal<Record<string, string>>({});
  /** Whether the pagination paths apply: the template declares or inherits a pagination editor, or has patterns. */
  readonly showPaginationPaths = computed(
    () =>
      !this.isSection() &&
      (declaresPagination(
        (this.detail()?.effectiveDefinition as { editors?: { type?: string }[] } | null | undefined)?.editors,
        this.contentDefinition(),
      ) ||
        Object.keys(paginationPathsForSave(this.paginationPaths())).length > 0),
  );
  readonly paginationPathErrors = computed<Record<string, string>>(() => {
    const errors: Record<string, string> = {};
    for (const [channel, pattern] of Object.entries(this.paginationPaths())) {
      const error = paginationPathError(pattern);
      if (error) {
        errors[channel] = error;
      }
    }
    return errors;
  });
  protected readonly defaultPaginationPath = DEFAULT_PAGINATION_PATH;
  /** Diagnostics of the selected channel's source, validated live as that template's channel. */
  readonly octlDiagnostics = signal<Diagnostic[]>([]);
  /** Descendants a rejected save would have broken (`422 SF-DOM-0124`). */
  readonly descendantProblems = signal<DescendantProblem[]>([]);
  /** Warnings a successful save produced on descendants; dismissible. */
  readonly descendantWarnings = signal<DescendantProblem[]>([]);
  /** Pages still using the template when making it abstract was refused (`422 SF-DOM-0122`). */
  readonly templateInUse = signal<TemplateInUse | null>(null);
  /** Templates extending the selected one, from its usages. */
  readonly childTemplates = signal<TemplateRef[]>([]);
  /** `base › docs_layout › article`: root first, ending at the selected template. */
  readonly breadcrumb = computed(() => inheritanceBreadcrumb(this.detail()));
  /** Inherited editors and bodies, grouped by the ancestor declaring them (read-only). */
  readonly inheritedGroups = computed(() => inheritedGroups(this.detail()));

  private readonly octlValidation = new Subject<OctlValidation>();

  readonly channelKeys = computed<string[]>(() => {
    const templates = this.channelTemplatesOf(this.detail());
    return Object.keys(templates ?? {});
  });

  readonly availableChannels = computed<ChannelView[]>(() => {
    const existing = new Set(this.channelKeys());
    return this.channels().filter((c) => !existing.has(c.key ?? ''));
  });

  constructor() {
    // Live OCTL diagnostics: debounced, and a newer keystroke cancels the request still in flight.
    this.octlValidation
      .pipe(
        debounceTime(OCTL_VALIDATE_DEBOUNCE_MS),
        switchMap((request) =>
          this.service
            .validateOctl(request.key, {
              source: request.source,
              channelKey: request.channelKey,
              templateUuid: request.templateUuid,
              contentDefinition: request.contentDefinition,
            })
            .pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => {
        if (response) {
          this.octlDiagnostics.set(sortDiagnostics(response.diagnostics ?? []) as Diagnostic[]);
        }
      });

    effect(() => {
      const key = this.projectKey();
      if (!key) {
        return;
      }
      this.store.loadFor(key).subscribe();
    });

    effect(
      () => {
        const key = this.projectKey();
        if (!key) {
          return;
        }
        this.reloadList(key);
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const key = this.projectKey();
        if (!key) {
          return;
        }
        this.reloadChannels(key);
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const key = this.projectKey();
        const uuid = this.selectedUuid();
        if (!key || !uuid || this.datasetSelected()) {
          this.detail.set(null);
          return;
        }
        this.reloadDetail(key, uuid);
      },
      { allowSignalWrites: true },
    );

    // Once the templates tree loads, default the selection to the "Page Templates" root so the
    // screen isn't blank on first load — mirrors `reloadList`'s existing "auto-select the first
    // row" behavior, one level up (auto-select the first *folder*). Also resets the selection if
    // it ever points at a folder no longer in the tree (e.g. it was just deleted).
    effect(
      () => {
        const tree = this.templateFolderTree();
        const selected = this.selectedFolder();
        if (selected !== null && findFolder(tree, selected)) {
          return;
        }
        if (tree.length === 0) {
          this.selectedFolder.set(null);
          this.selectedFolderKind.set(null);
          return;
        }
        // PAGE_TEMPLATES_ROOT_UID is no longer necessarily top-level — it now nests one level
        // inside the fixed "All Templates" wrapper root (M13.1.2, generalized) — so this needs
        // a recursive lookup, not a flat top-level `.find`.
        const preferredUid = untracked(() => this.kind$()) === 'DATASET' ? DATASETS_ROOT_UID : PAGE_TEMPLATES_ROOT_UID;
        const root = findFolderByUid(tree, preferredUid) ?? tree[0];
        if (root.uuid) {
          this.selectedFolder.set(root.uuid);
          this.selectedFolderKind.set(this.rootKind(root));
        }
      },
      { allowSignalWrites: true },
    );
  }

  isSection(): boolean {
    return this.kind() === 'section';
  }

  /** The inherited kind of one of the two fixed roots, by its well-known `uid`. */
  protected rootKind(node: FolderView): TemplateAssetKind {
    if (node.uid === DATASETS_ROOT_UID) {
      return 'DATASET';
    }
    return node.uid === SECTION_TEMPLATES_ROOT_UID ? 'SECTION_TEMPLATE' : 'PAGE_TEMPLATE';
  }

  protected selectFolder(event: TemplateFolderSelectEvent): void {
    this.selectedFolder.set(event.uuid);
    this.selectedFolderKind.set(event.templateKind);
    this.selectedUuid.set(null);
  }

  /** Handles both folder-onto-folder drags on the templates tree — the generic move endpoint
   * dispatches by asset type; cross-kind drags are already rejected client-side by
   * `TemplateFolderNodeComponent.onDrop`. */
  protected moveItemTo(event: FolderMoveEvent): void {
    if (!event.source || !event.target || this.readOnly()) {
      return;
    }
    this.api.moveAsset(this.projectKey(), event.source, { folderUuid: event.target }).subscribe({
      next: () => {
        this.toast.show('Moved', 'success');
        this.onTreeChanged();
      },
      error: () => this.toast.show('Could not move — that may create a cycle.', 'error'),
    });
  }

  /** Reloads the folder tree and this kind's template list — used after any folder
   * create/rename/move/delete, and after a template is moved via cut/paste. */
  protected onTreeChanged(): void {
    const key = this.projectKey();
    if (!key) {
      return;
    }
    this.reloadList(key);
    this.refreshTemplateStore();
  }

  select(uuid?: string): void {
    this.selectedUuid.set(uuid ?? null);
  }

  protected onDatasetChanged(): void {
    const key = this.projectKey();
    if (key) {
      this.reloadList(key);
    }
  }

  protected onDatasetDeleted(): void {
    this.selectedUuid.set(null);
    this.onDatasetChanged();
    this.refreshTemplateStore();
  }

  readonly newTemplateOpen = signal(false);
  readonly creatingTemplate = signal(false);

  readonly createDialogKind = computed<TemplateAssetKind>(() => this.activeTemplateKind());

  newTemplate(): void {
    if (this.readOnly()) {
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
    const selected = this.selectedFolder();
    const selectedNode = selected ? findFolder(this.templateFolderTree(), selected) : null;
    if (selectedNode && selectedNode.uid !== TEMPLATES_ROOT_UID) {
      return selected ?? undefined;
    }
    const kind = this.activeTemplateKind();
    const rootUid =
      kind === 'SECTION_TEMPLATE' ? SECTION_TEMPLATES_ROOT_UID : kind === 'DATASET' ? DATASETS_ROOT_UID : PAGE_TEMPLATES_ROOT_UID;
    return findFolderByUid(this.templateFolderTree(), rootUid)?.uuid;
  }

  submitNewTemplate(value: CreateAssetFormValue): void {
    const key = this.projectKey();
    if (!key || this.readOnly()) {
      return;
    }
    this.creatingTemplate.set(true);
    if (this.activeTemplateKind() === 'DATASET') {
      this.contentService
        .createDataset(key, {
          displayName: value.displayName,
          contentDefinition: NEW_DATASET_DEFINITION,
          titleEditor: 'name',
          parentFolderUuid: this.newTemplateParentUuid(),
        })
        .subscribe({
          next: (created) => {
            this.creatingTemplate.set(false);
            this.newTemplateOpen.set(false);
            this.toast.show('Dataset created', 'success');
            this.reloadList(key, created.uuid ?? null);
            this.refreshTemplateStore();
          },
          error: () => {
            this.creatingTemplate.set(false);
            this.toast.show('Could not create the dataset — you may need the developer role.', 'error');
          },
        });
      return;
    }
    this.service
      .create(this.kind(), key, {
        displayName: value.displayName,
        contentDefinition: NEW_CONTENT_DEFINITION,
        channelSources: {},
        parentFolderUuid: this.newTemplateParentUuid(),
      })
      .subscribe({
        next: (created) => {
          this.creatingTemplate.set(false);
          this.newTemplateOpen.set(false);
          this.toast.show('Template created', 'success');
          this.reloadList(key);
          this.selectedUuid.set(created.uuid ?? null);
          this.refreshTemplateStore();
        },
        error: () => {
          this.creatingTemplate.set(false);
          this.toast.show('Could not create template — try again in a moment.', 'error');
        },
      });
  }

  onDisplayNameInput(event: Event): void {
    this.displayName.set((event.target as HTMLInputElement).value);
  }

  onCategoryInput(event: Event): void {
    this.category.set((event.target as HTMLInputElement).value);
  }

  onDeprecatedChange(event: Event): void {
    this.deprecated.set((event.target as HTMLInputElement).checked);
  }

  onContentDefinitionInput(event: Event): void {
    this.contentDefinition.set((event.target as HTMLTextAreaElement).value);
    // Unsaved editors change what the channel may use.
    this.requestOctlValidation();
  }

  onPaginationPathInput(channel: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.paginationPaths.update((paths) => ({ ...paths, [channel]: value }));
  }

  onAbstractChange(event: Event): void {
    this.abstractTemplate.set((event.target as HTMLInputElement).checked);
    this.templateInUse.set(null);
  }

  /** Opens another template of the chain (breadcrumb, "Extended by", a broken descendant). */
  openTemplate(uuid: string | null | undefined): void {
    if (uuid) {
      this.selectedUuid.set(uuid);
    }
  }

  dismissDescendantWarnings(): void {
    this.descendantWarnings.set([]);
  }

  /** Queues a context-aware validation of the selected channel's current (unsaved) source. */
  private requestOctlValidation(): void {
    const key = this.projectKey();
    const uuid = this.selectedUuid();
    const channelKey = this.selectedChannel();
    if (!key || !uuid || !channelKey || this.datasetSelected()) {
      this.octlDiagnostics.set([]);
      return;
    }
    this.octlValidation.next({
      key,
      templateUuid: uuid,
      channelKey,
      source: this.channelSource(),
      contentDefinition: this.contentDefinition(),
    });
  }

  /** The descendants a rejected save names, or its compile diagnostics; `true` when the error was one of those. */
  private showSaveProblems(err: unknown, diagnosticsTarget: (d: Diagnostic[]) => void): boolean {
    const descendants = descendantProblemsOf(err);
    if (descendants) {
      this.descendantProblems.set(descendants);
      this.toast.show('Not saved: the change would break templates that extend this one — see below.', 'error');
      return true;
    }
    const inUse = templateInUseOf(err);
    if (inUse) {
      this.templateInUse.set(inUse);
      this.toast.show('Not saved: pages still use this template, so it can\'t be abstract.', 'error');
      return true;
    }
    const diagnostics = diagnosticsOf(err) as Diagnostic[];
    if (diagnostics.length > 0) {
      diagnosticsTarget(diagnostics);
      return true;
    }
    return false;
  }

  validateCdl(): void {
    const key = this.projectKey();
    if (!key) {
      return;
    }
    this.service.validateCdl(key, this.contentDefinition()).subscribe({
      next: (res) => {
        this.cdlDiagnostics.set(res.diagnostics ?? []);
        this.toast.show(
          (res.diagnostics ?? []).some((d) => d.severity === 'ERROR')
            ? 'CDL has errors'
            : 'CDL is valid',
          (res.diagnostics ?? []).some((d) => d.severity === 'ERROR')
            ? 'error'
            : 'success',
        );
      },
      error: () => this.toast.show('Could not validate CDL — check your connection and try again.', 'error'),
    });
  }

  saveDefinition(): void {
    const key = this.projectKey();
    const uuid = this.selectedUuid();
    const detail = this.detail();
    if (!key || !uuid || !detail || this.readOnly()) {
      return;
    }
    if (Object.keys(this.paginationPathErrors()).length > 0) {
      this.toast.show('A pagination path is missing {pageNumber} — fix it before saving.', 'error');
      return;
    }
    this.saving.set(true);
    this.service
      .update(
        this.kind(),
        key,
        uuid,
        {
          displayName: this.displayName(),
          contentDefinition: this.contentDefinition(),
          category: this.category(),
          deprecated: this.deprecated(),
          channelSources: this.channelSourcesOf(detail),
          ...(this.isSection()
            ? {}
            : {
                outputPath: this.pathMapOf(detail.outputPath),
                // Edited under "Pagination paths"; blank channels use the default sibling-file path (M21).
                paginationPath: paginationPathsForSave(this.paginationPaths()),
                abstract: this.abstractTemplate(),
              }),
        },
        this.etag(detail),
      )
      .subscribe({
        next: (updated) => {
          this.applyUpdated(updated);
          this.toast.show('Template saved', 'success');
          this.saving.set(false);
          this.cdlDiagnostics.set([]);
          this.descendantProblems.set([]);
          this.templateInUse.set(null);
          this.descendantWarnings.set(normalizeDescendants(updated.descendantWarnings));
          this.refreshTemplateStore();
          // Ancestors and inherited editors are derived on save; reload to show them.
          this.reloadDetail(key, uuid, false);
        },
        error: (err) => {
          const problem = (err as { error?: { field?: string; detail?: string } }).error;
          if (problem?.field?.startsWith('paginationPath') && problem.detail) {
            this.toast.show(problem.detail, 'error');
            this.saving.set(false);
            return;
          }
          const shown = this.showSaveProblems(err, (diagnostics) => {
            this.cdlDiagnostics.set(diagnostics);
            this.toast.show(
              'Template has compile errors — see diagnostics below. Removing content used by a channel template will break that channel until it is updated too.',
              'error',
            );
          });
          if (!shown) {
            this.toast.show('Could not save template — someone may have edited it, try reloading.', 'error');
          }
          this.saving.set(false);
        },
      });
  }

  onUidChanged(): void {
    const key = this.projectKey();
    const uuid = this.selectedUuid();
    if (!key || !uuid) {
      return;
    }
    this.reloadDetail(key, uuid);
    this.reloadList(key);
    this.refreshTemplateStore();
  }

  selectChannel(channelKey: string): void {
    this.selectedChannel.set(channelKey);
    this.channelSource.set(this.readChannelSource(channelKey));
    this.octlDiagnostics.set([]);
    this.requestOctlValidation();
  }

  onChannelInput(event: Event): void {
    this.channelSource.set((event.target as HTMLTextAreaElement).value);
    this.requestOctlValidation();
  }

  onAddChannel(event: Event): void {
    const channelKey = (event.target as HTMLSelectElement).value;
    if (channelKey) {
      this.addChannel(channelKey);
    }
  }

  addChannel(channelKey: string): void {
    const key = this.projectKey();
    const uuid = this.selectedUuid();
    const detail = this.detail();
    if (!key || !uuid || !detail || !channelKey || this.readOnly()) {
      return;
    }
    this.channelSaving.set(true);
    this.service
      .saveChannel(this.kind(), key, uuid, channelKey, '', this.etag(detail))
      .subscribe({
        next: () => {
          this.toast.show(`Channel ${channelKey} added`, 'success');
          this.channelSaving.set(false);
          this.reloadDetail(key, uuid);
          this.selectedChannel.set(channelKey);
        },
        error: () => {
          this.toast.show(`Could not add channel ${channelKey} — it may already exist.`, 'error');
          this.channelSaving.set(false);
        },
      });
  }

  saveChannel(): void {
    const key = this.projectKey();
    const uuid = this.selectedUuid();
    const detail = this.detail();
    const channel = this.selectedChannel();
    if (!key || !uuid || !detail || !channel || this.readOnly()) {
      return;
    }
    this.channelSaving.set(true);
    this.service
      .saveChannel(
        this.kind(),
        key,
        uuid,
        channel,
        this.channelSource(),
        this.etag(detail),
      )
      .subscribe({
        next: (saved) => {
          this.toast.show(`Channel ${channel} saved`, 'success');
          this.channelSaving.set(false);
          this.descendantProblems.set([]);
          this.descendantWarnings.set(normalizeDescendants(saved?.descendantWarnings));
          this.reloadDetail(key, uuid, false);
        },
        error: (err) => {
          const shown = this.showSaveProblems(err, (diagnostics) => {
            this.octlDiagnostics.set(sortDiagnostics(diagnostics) as Diagnostic[]);
            this.toast.show(`Channel ${channel} has compile errors — see diagnostics below.`, 'error');
          });
          if (!shown) {
            this.toast.show(`Could not save channel ${channel} — check the OCTL source compiles.`, 'error');
          }
          this.channelSaving.set(false);
        },
      });
  }

  deleteChannel(): void {
    const key = this.projectKey();
    const uuid = this.selectedUuid();
    const detail = this.detail();
    const channel = this.selectedChannel();
    if (!key || !uuid || !detail || !channel || this.readOnly()) {
      return;
    }
    this.channelSaving.set(true);
    this.service
      .deleteChannel(this.kind(), key, uuid, channel, this.etag(detail))
      .subscribe({
        next: () => {
          this.toast.show(`Channel ${channel} removed`, 'success');
          this.channelSaving.set(false);
          this.selectedChannel.set('');
          this.channelSource.set('');
          this.reloadDetail(key, uuid);
        },
        error: (err) => {
          if (!this.showSaveProblems(err, () => undefined)) {
            this.toast.show(`Could not remove channel ${channel} — try again in a moment.`, 'error');
          }
          this.channelSaving.set(false);
        },
      });
  }

  requestDelete(): void {
    if (this.readOnly()) {
      return;
    }
    this.confirmDelete.set(true);
  }

  cancelDelete(): void {
    this.confirmDelete.set(false);
  }

  confirmDeleteAction(): void {
    const key = this.projectKey();
    const uuid = this.selectedUuid();
    if (!key || !uuid || this.readOnly()) {
      return;
    }
    this.service.delete(this.kind(), key, uuid).subscribe({
      next: () => {
        this.toast.show('Template deleted', 'success');
        this.confirmDelete.set(false);
        this.selectedUuid.set(null);
        this.detail.set(null);
        this.reloadList(key);
        this.refreshTemplateStore();
      },
      error: (err) => {
        const detail = err instanceof HttpErrorResponse ? (err.error as { detail?: string } | null)?.detail : undefined;
        this.toast.show(detail ?? 'Could not delete template — it may still be in use by a page.', 'error');
        this.confirmDelete.set(false);
      },
    });
  }

  private channelTemplatesOf(detail: TemplateDetail | null): Record<string, ChannelTemplateValue> | null {
    return (detail?.channelTemplates as Record<string, ChannelTemplateValue> | null) ?? null;
  }

  private channelSourcesOf(detail: TemplateDetail): Record<string, string> {
    const templates = this.channelTemplatesOf(detail) ?? {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(templates)) {
      out[key] = value?.source ?? '';
    }
    return out;
  }

  /** A per-channel path map of the detail (`outputPath`, `paginationPath`) as the update request sends it. */
  private pathMapOf(value: unknown): Record<string, string> {
    const raw = value as Record<string, string> | null | undefined;
    if (!raw) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string') {
        out[key] = value;
      }
    }
    return out;
  }

  private readChannelSource(channelKey: string): string {
    const templates = this.channelTemplatesOf(this.detail()) ?? {};
    return templates[channelKey]?.source ?? '';
  }

  private etag(detail: TemplateDetail): string | undefined {
    const revision = detail.revision;
    return revision != null ? etagFor(revision) : undefined;
  }

  /** Fetches BOTH template kinds and merges them into one list, always — deliberately not
   * scoped to `this.kind()`. This tree has two fixed roots ("Page Templates"/"Section
   * Templates") shown at once, exactly like any other store's tree can have multiple top-level
   * folders shown at once; scoping the fetch to "whichever kind is currently selected" (the old
   * behavior) meant selecting something under one root silently emptied the other root's
   * branch in the tree until you selected something back under it — a "switching" UI the other
   * stores don't have and this one shouldn't either. `this.kind()` still exists and is still
   * correct to use for *per-item* operations (create/save/delete/channel calls scoped to
   * whichever one template is selected), just never again for "what to fetch". */
  private reloadList(key: string, select: string | null = null): void {
    this.loading.set(true);
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
        this.templates.set(list);
        this.loading.set(false);
        if (select) {
          this.selectedUuid.set(select);
          return;
        }
        const current = this.selectedUuid();
        if (!current && list.length > 0) {
          this.selectedUuid.set(list[0].uuid ?? null);
        }
      },
      error: () => {
        this.toast.show('Could not load templates — check your connection and try again.', 'error');
        this.loading.set(false);
      },
    });
  }

  private reloadChannels(key: string): void {
    this.channelsService.list(key).subscribe({
      next: (list) => this.channels.set(list ?? []),
      error: () => this.channels.set([]),
    });
  }

  /** @param resetOutcomes whether to clear the last save's descendant outcomes (not when reloading after that save) */
  private reloadDetail(key: string, uuid: string, resetOutcomes = true): void {
    this.service.get(this.kind(), key, uuid).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.displayName.set(detail.displayName ?? '');
        this.category.set(detail.category ?? '');
        this.deprecated.set(detail.deprecated ?? false);
        this.abstractTemplate.set(detail.abstract ?? false);
        this.paginationPaths.set(readPaginationPaths(detail.paginationPath));
        this.contentDefinition.set(detail.contentDefinition ?? '');
        this.cdlDiagnostics.set([]);
        this.octlDiagnostics.set([]);
        this.templateInUse.set(null);
        if (resetOutcomes) {
          this.descendantProblems.set([]);
          this.descendantWarnings.set([]);
        }
        this.reloadChildTemplates(key, detail);
        const keys = this.channelKeys();
        const selected = this.selectedChannel();
        if (selected && keys.includes(selected)) {
          this.channelSource.set(this.readChannelSource(selected));
        } else if (keys.length > 0) {
          this.selectedChannel.set(keys[0]);
          this.channelSource.set(this.readChannelSource(keys[0]));
        } else {
          this.selectedChannel.set('');
          this.channelSource.set('');
        }
        this.requestOctlValidation();
      },
      error: () => this.toast.show('Could not load template — check your connection and try again.', 'error'),
    });
  }

  /** "Extended by": a page template's usages recorded from its children's `parentTemplateRef`. */
  private reloadChildTemplates(key: string, detail: TemplateDetail): void {
    this.childTemplates.set([]);
    if (detail.assetType !== 'PAGE_TEMPLATE' || !detail.uuid) {
      return;
    }
    const uuid = detail.uuid;
    this.api.assetUsages(key, uuid).subscribe({
      next: (usages) => {
        if (this.detail()?.uuid === uuid) {
          this.childTemplates.set(childTemplates(usages as UsageLike[]));
        }
      },
      error: () => this.childTemplates.set([]),
    });
  }

  private applyUpdated(updated: TemplateDetail): void {
    this.detail.set(updated);
    this.templates.update((list) =>
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

function findFolder(nodes: FolderView[], uuid: string): FolderView | null {
  for (const node of nodes) {
    if (node.uuid === uuid) {
      return node;
    }
    const found = findFolder(node.children ?? [], uuid);
    if (found) {
      return found;
    }
  }
  return null;
}

/** Same shape as `findFolder`, but matches on the well-known `uid` string instead of `uuid` —
 * needed since the fixed kind-roots are no longer necessarily top-level array items (they now
 * nest one level inside the fixed "All Templates" wrapper root). */
function findFolderByUid(nodes: FolderView[], uid: string): FolderView | null {
  for (const node of nodes) {
    if (node.uid === uid) {
      return node;
    }
    const found = findFolderByUid(node.children ?? [], uid);
    if (found) {
      return found;
    }
  }
  return null;
}
