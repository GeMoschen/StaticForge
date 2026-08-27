import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { forkJoin } from 'rxjs';
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
import { TemplateFolderNodeComponent } from './template-folder-node.component';
import {
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

type ChannelView = components['schemas']['ChannelView'];
type FolderView = components['schemas']['FolderView'];

interface ChannelTemplateValue {
  source?: string;
  compiledHash?: string;
}

const NEW_CONTENT_DEFINITION = '';

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
  ],
  templateUrl: './templates.component.html',
  styleUrl: './templates.component.scss',
})
export class TemplatesComponent {
  readonly projectKey = input.required<string>();

  private readonly service = inject(TemplatesService);
  private readonly channelsService = inject(ChannelsService);
  private readonly store = inject(ProjectContextStore);
  private readonly toast = inject(ToastService);
  private readonly api = inject(ApiClient);

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
    return assetType === 'SECTION_TEMPLATE' || assetType === 'PAGE_TEMPLATE' ? assetType : null;
  });

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

  readonly channelKeys = computed<string[]>(() => {
    const templates = this.channelTemplatesOf(this.detail());
    return Object.keys(templates ?? {});
  });

  readonly availableChannels = computed<ChannelView[]>(() => {
    const existing = new Set(this.channelKeys());
    return this.channels().filter((c) => !existing.has(c.key ?? ''));
  });

  constructor() {
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
        if (!key || !uuid) {
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
        const root = findFolderByUid(tree, PAGE_TEMPLATES_ROOT_UID) ?? tree[0];
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
    if (!event.source || !event.target) {
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

  readonly newTemplateOpen = signal(false);
  readonly creatingTemplate = signal(false);

  readonly createDialogKind = computed<TemplateAssetKind>(() => this.activeTemplateKind());

  newTemplate(): void {
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
    const rootUid = this.activeTemplateKind() === 'SECTION_TEMPLATE' ? SECTION_TEMPLATES_ROOT_UID : PAGE_TEMPLATES_ROOT_UID;
    return findFolderByUid(this.templateFolderTree(), rootUid)?.uuid;
  }

  submitNewTemplate(value: CreateAssetFormValue): void {
    const key = this.projectKey();
    if (!key) {
      return;
    }
    this.creatingTemplate.set(true);
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
    if (!key || !uuid || !detail) {
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
          ...(this.isSection() ? {} : { outputPath: this.outputPathOf(detail) }),
        },
        this.etag(detail),
      )
      .subscribe({
        next: (updated) => {
          this.applyUpdated(updated);
          this.toast.show('Template saved', 'success');
          this.saving.set(false);
          this.cdlDiagnostics.set([]);
          this.refreshTemplateStore();
        },
        error: (err) => {
          const diagnostics = this.diagnosticsOf(err);
          if (diagnostics.length > 0) {
            this.cdlDiagnostics.set(diagnostics);
            this.toast.show(
              'Template has compile errors — see diagnostics below. Removing content used by a channel template will break that channel until it is updated too.',
              'error',
            );
          } else {
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

  private diagnosticsOf(err: unknown): Diagnostic[] {
    if (!(err instanceof HttpErrorResponse)) {
      return [];
    }
    const body = err.error as { diagnostics?: Diagnostic[] } | null;
    return Array.isArray(body?.diagnostics) ? body.diagnostics : [];
  }

  selectChannel(channelKey: string): void {
    this.selectedChannel.set(channelKey);
    this.channelSource.set(this.readChannelSource(channelKey));
  }

  onChannelInput(event: Event): void {
    this.channelSource.set((event.target as HTMLTextAreaElement).value);
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
    if (!key || !uuid || !detail || !channelKey) {
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
    if (!key || !uuid || !detail || !channel) {
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
        next: () => {
          this.toast.show(`Channel ${channel} saved`, 'success');
          this.channelSaving.set(false);
          this.reloadDetail(key, uuid);
        },
        error: () => {
          this.toast.show(`Could not save channel ${channel} — check the OCTL source compiles.`, 'error');
          this.channelSaving.set(false);
        },
      });
  }

  deleteChannel(): void {
    const key = this.projectKey();
    const uuid = this.selectedUuid();
    const detail = this.detail();
    const channel = this.selectedChannel();
    if (!key || !uuid || !detail || !channel) {
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
        error: () => {
          this.toast.show(`Could not remove channel ${channel} — try again in a moment.`, 'error');
          this.channelSaving.set(false);
        },
      });
  }

  requestDelete(): void {
    this.confirmDelete.set(true);
  }

  cancelDelete(): void {
    this.confirmDelete.set(false);
  }

  confirmDeleteAction(): void {
    const key = this.projectKey();
    const uuid = this.selectedUuid();
    if (!key || !uuid) {
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
      error: () => {
        this.toast.show('Could not delete template — it may still be in use by a page.', 'error');
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

  private outputPathOf(detail: TemplateDetail): Record<string, string> {
    const raw = detail.outputPath as Record<string, string> | null | undefined;
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
  private reloadList(key: string): void {
    this.loading.set(true);
    forkJoin({
      page: this.service.list('page', key),
      section: this.service.list('section', key),
    }).subscribe({
      next: ({ page, section }) => {
        const list = [...(page.content ?? []), ...(section.content ?? [])];
        this.templates.set(list);
        this.loading.set(false);
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

  private reloadDetail(key: string, uuid: string): void {
    this.service.get(this.kind(), key, uuid).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.displayName.set(detail.displayName ?? '');
        this.category.set(detail.category ?? '');
        this.deprecated.set(detail.deprecated ?? false);
        this.contentDefinition.set(detail.contentDefinition ?? '');
        this.cdlDiagnostics.set([]);
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
      },
      error: () => this.toast.show('Could not load template — check your connection and try again.', 'error'),
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
