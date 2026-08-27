import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { ContextMenuService } from '../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../shared/services/tree-clipboard.service';
import type { components } from '../../core/api/generated/schema.d.ts';
import { BodyDefinition, ContentDefinition } from '../forms';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfRenameAssetDialogComponent } from '../../shared/components/sf-rename-asset-dialog.component';
import type { BodiesMap, SectionInstance } from './types';

type AssetSummaryView = components['schemas']['AssetSummaryView'];
type PageView = components['schemas']['PageView'];

const EMPTY_DEF: ContentDefinition = { editors: [], bodies: [] };

/**
 * One page in the pages tree, purely for navigation: lazily loads (on first
 * expand) the page's own bodies and their currently assigned sections and
 * lists them as further tree levels. Clicking a page/body/section navigates
 * to the full page editor (optionally scrolled to that body/section) —
 * nothing here is editable, see `PageEditorComponent` for that.
 */
@Component({
  selector: 'sf-page-nav-node',
  standalone: true,
  imports: [SfIconComponent, SfRenameAssetDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './page-nav-node.component.html',
  styleUrl: './page-nav-node.component.scss',
})
export class PageNavNodeComponent {
  private readonly api = inject(ApiClient);
  private readonly store = inject(ProjectContextStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly menu = inject(ContextMenuService);
  private readonly clipboard = inject(TreeClipboardService);

  readonly projectKey = input.required<string>();
  readonly summary = input.required<AssetSummaryView>();
  readonly depth = input<number>(0);

  /** Emitted after a duplicate or delete succeeds, so the parent list reloads. */
  readonly changed = output<void>();

  protected readonly expanded = signal(false);
  protected readonly loaded = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly renameOpen = signal(false);
  protected readonly renamingName = signal(false);

  private readonly contentDefinition = signal<ContentDefinition>(EMPTY_DEF);
  private readonly page = signal<PageView | null>(null);
  /** Bumped on every load() so an in-flight request superseded by a newer one (e.g. a mutation notification arriving mid-fetch) can detect it's stale and discard its response instead of clobbering fresher data. */
  private loadGeneration = 0;

  constructor() {
    effect(
      () => {
        const mutated = this.store.pageMutated();
        // Not gated on loaded() — a mutation notification can arrive while this node's own
        // initial load() is still in flight (e.g. adding a section right after opening the
        // page), and that in-flight fetch may have started before the mutation and so land
        // with stale data. Always re-issuing load() here means whichever fetch finishes last
        // reflects the mutation, instead of the tree silently getting stuck on stale content.
        if (mutated && mutated === this.summary().uuid) {
          this.load();
        }
      },
      { allowSignalWrites: true },
    );

    // Auto-expand this node once it becomes the page open in the editor — never auto-collapses it back.
    effect(
      () => {
        const active = this.store.activePageUuid();
        if (active !== this.summary().uuid || this.expanded()) {
          return;
        }
        if (this.loaded()) {
          this.expanded.set(true);
        } else {
          this.load();
        }
      },
      { allowSignalWrites: true },
    );
  }

  protected toggle(event: Event): void {
    event.stopPropagation();
    if (!this.loaded()) {
      this.load();
      return;
    }
    this.expanded.update((v) => !v);
  }

  protected onSectionDragStart(bodyName: string, section: SectionInstance, event: DragEvent): void {
    const uuid = this.summary().uuid;
    if (!uuid) {
      return;
    }
    const payload = { pageUuid: uuid, bodyName, instanceId: section.instanceId, templateRef: section.templateRef };
    event.dataTransfer?.setData('application/x-sf-section', JSON.stringify(payload));
    event.dataTransfer && (event.dataTransfer.effectAllowed = 'move');
    event.stopPropagation();
  }

  protected onBodyDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('application/x-sf-section')) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  /** Drop a section (dragged from anywhere in the tree) directly onto this body row — moves it here without opening the editor. */
  protected onBodyDrop(body: BodyDefinition, event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('application/x-sf-section')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const raw = event.dataTransfer.getData('application/x-sf-section');
    const targetUuid = this.summary().uuid;
    if (!raw || !targetUuid) {
      return;
    }
    let payload: { pageUuid: string; bodyName: string; instanceId: string; templateRef: string };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (payload.pageUuid === targetUuid && payload.bodyName === body.name) {
      return;
    }
    const allow = body.allow ?? [];
    const templates = this.store.sectionTemplates();
    const allowed =
      allow.length === 0 ||
      allow.includes('*') ||
      templates.some((t) => t.uuid === payload.templateRef && t.uid != null && allow.includes(t.uid));
    if (!allowed) {
      this.toast.show("This section type isn't allowed in this body.", 'error');
      return;
    }
    const key = this.projectKey();
    const targetCount = this.sectionsFor(body.name).length;
    this.api
      .moveSection(
        key,
        targetUuid,
        body.name,
        { sourcePageUuid: payload.pageUuid, sourceBody: payload.bodyName, instanceId: payload.instanceId, position: targetCount },
        this.page()?.revision ?? undefined,
      )
      .subscribe({
        next: () => {
          this.toast.show('Section moved', 'success');
          this.load();
          if (payload.pageUuid !== targetUuid) {
            this.store.notifyPageChanged(payload.pageUuid);
            // The section that was just moved away was open in the editor — follow it to its
            // new page instead of leaving the editor pointed at a page that no longer has it.
            if (
              this.store.activePageUuid() === payload.pageUuid &&
              this.store.activeSectionInstanceId() === payload.instanceId
            ) {
              void this.router.navigate(['/p', key, 'pages', targetUuid], {
                queryParams: { section: payload.instanceId },
              });
            }
          }
        },
        error: () =>
          this.toast.show(
            'Could not move section — someone may have edited one of the pages, try reloading.',
            'error',
          ),
      });
  }

  protected onPageDragStart(event: DragEvent): void {
    const uuid = this.summary().uuid;
    if (!uuid) {
      return;
    }
    event.dataTransfer?.setData('text/plain', uuid);
    event.dataTransfer && (event.dataTransfer.effectAllowed = 'move');
  }

  protected onSectionContextMenu(bodyName: string, section: SectionInstance, event: MouseEvent): void {
    const uuid = this.summary().uuid;
    if (!uuid) {
      return;
    }
    const list = this.sectionsFor(bodyName);
    const index = list.findIndex((s) => s.instanceId === section.instanceId);
    this.menu.open(event, [
      { label: 'Open', icon: 'open_in_new', action: () => this.openSection(section.instanceId, event) },
      { label: '', separator: true },
      {
        label: 'Move up',
        icon: 'arrow_upward',
        disabled: index <= 0,
        action: () => this.reorderSection(bodyName, list, index, index - 1),
      },
      {
        label: 'Move down',
        icon: 'arrow_downward',
        disabled: index < 0 || index >= list.length - 1,
        action: () => this.reorderSection(bodyName, list, index, index + 1),
      },
      { label: '', separator: true },
      { label: 'Delete', icon: 'delete', danger: true, action: () => this.deleteSection(bodyName, section) },
    ]);
  }

  private reorderSection(bodyName: string, list: SectionInstance[], from: number, to: number): void {
    const uuid = this.summary().uuid;
    if (!uuid || from < 0 || to < 0 || to >= list.length) {
      return;
    }
    const instanceIds = list.map((s) => s.instanceId);
    const [moved] = instanceIds.splice(from, 1);
    instanceIds.splice(to, 0, moved);
    this.api
      .reorderSections(this.projectKey(), uuid, bodyName, instanceIds, this.page()?.revision ?? undefined)
      .subscribe({
        next: () => {
          this.load();
          this.store.notifyPageChanged(uuid);
        },
        error: () =>
          this.toast.show('Could not reorder sections — someone may have edited this page, try reloading it.', 'error'),
      });
  }

  private deleteSection(bodyName: string, section: SectionInstance): void {
    const uuid = this.summary().uuid;
    if (!uuid) {
      return;
    }
    const label = this.sectionTitle(section.templateRef);
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) {
      return;
    }
    this.api
      .deleteSection(this.projectKey(), uuid, bodyName, section.instanceId, this.page()?.revision ?? undefined)
      .subscribe({
        next: () => {
          this.toast.show('Section deleted', 'success');
          this.load();
          this.store.notifyPageChanged(uuid);
        },
        error: () =>
          this.toast.show('Could not delete section — someone may have edited this page, try reloading it.', 'error'),
      });
  }

  protected onContextMenu(event: MouseEvent): void {
    const uuid = this.summary().uuid;
    if (!uuid) {
      return;
    }
    const label = this.summary().displayName ?? this.summary().uid ?? 'page';
    this.menu.open(event, [
      { label: 'Open', icon: 'open_in_new', action: () => this.openPage() },
      { label: 'Duplicate', icon: 'content_copy', action: () => this.duplicate() },
      { label: 'Rename', icon: 'edit', action: () => this.renameOpen.set(true) },
      { label: '', separator: true },
      { label: 'Cut', icon: 'content_cut', action: () => this.clipboard.cut('PAGE', uuid, label) },
      { label: 'Copy', icon: 'file_copy', action: () => this.clipboard.copy('PAGE', uuid, label) },
      { label: '', separator: true },
      { label: 'Delete', icon: 'delete', danger: true, action: () => this.delete() },
    ]);
  }

  private duplicate(): void {
    const uuid = this.summary().uuid;
    if (!uuid) {
      return;
    }
    this.api.duplicatePage(this.projectKey(), uuid).subscribe({
      next: () => {
        this.toast.show('Page duplicated', 'success');
        this.changed.emit();
      },
      error: () => this.toast.show('Could not duplicate page — try again in a moment.', 'error'),
    });
  }

  protected closeRename(): void {
    this.renameOpen.set(false);
  }

  protected submitRenameDisplayName(displayName: string): void {
    const uuid = this.summary().uuid;
    if (!uuid) {
      return;
    }
    this.renamingName.set(true);
    this.api
      .renameAsset(this.projectKey(), uuid, { displayName }, this.page()?.revision ?? undefined)
      .subscribe({
        next: () => {
          this.renamingName.set(false);
          this.renameOpen.set(false);
          this.toast.show('Page renamed', 'success');
          this.changed.emit();
        },
        error: () => {
          this.renamingName.set(false);
          this.toast.show('Could not rename page — try again in a moment.', 'error');
        },
      });
  }

  protected onRenameUidChanged(): void {
    // sf-uid-rename already toasts "UID changed" itself — just reload.
    this.changed.emit();
  }

  private delete(): void {
    const uuid = this.summary().uuid;
    if (!uuid) {
      return;
    }
    const name = this.summary().displayName ?? this.summary().uid ?? 'this page';
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) {
      return;
    }
    this.api.deleteAsset(this.projectKey(), uuid).subscribe({
      next: () => {
        this.toast.show('Page deleted', 'success');
        this.changed.emit();
      },
      error: () => this.toast.show('Could not delete page — try again in a moment.', 'error'),
    });
  }

  protected openPage(): void {
    const uuid = this.summary().uuid;
    if (!uuid) {
      return;
    }
    void this.router.navigate(['/p', this.projectKey(), 'pages', uuid]);
  }

  protected openBody(bodyName: string, event: Event): void {
    event.stopPropagation();
    const uuid = this.summary().uuid;
    if (!uuid) {
      return;
    }
    void this.router.navigate(['/p', this.projectKey(), 'pages', uuid], {
      queryParams: { body: bodyName },
    });
  }

  protected openSection(instanceId: string, event: Event): void {
    event.stopPropagation();
    const uuid = this.summary().uuid;
    if (!uuid) {
      return;
    }
    void this.router.navigate(['/p', this.projectKey(), 'pages', uuid], {
      queryParams: { section: instanceId },
    });
  }

  protected bodies(): BodyDefinition[] {
    return this.contentDefinition().bodies ?? [];
  }

  protected sectionsFor(bodyName: string): SectionInstance[] {
    const bodies = (this.page()?.bodies ?? {}) as unknown as BodiesMap;
    return bodies[bodyName] ?? [];
  }

  protected sectionTitle(templateRef: string): string {
    const tpl = this.store.sectionTemplates().find((t) => t.uuid === templateRef);
    return tpl?.displayName ?? tpl?.uid ?? templateRef;
  }

  protected trackSection(index: number, section: SectionInstance): string {
    void index;
    return `${section.instanceId}|${section.templateRef}`;
  }

  /** Only the most specific open row highlights: a focused section beats its body, which beats the page itself. */
  private isOpenPage(): boolean {
    return this.store.activePageUuid() === this.summary().uuid;
  }

  protected isActivePage(): boolean {
    return this.isOpenPage() && !this.store.activeBodyName() && !this.store.activeSectionInstanceId();
  }

  protected isActiveBody(bodyName: string): boolean {
    return this.isOpenPage() && !this.store.activeSectionInstanceId() && this.store.activeBodyName() === bodyName;
  }

  protected isActiveSection(instanceId: string): boolean {
    return this.isOpenPage() && this.store.activeSectionInstanceId() === instanceId;
  }

  private load(): void {
    const key = this.projectKey();
    const uuid = this.summary().uuid;
    if (!uuid) {
      return;
    }
    const generation = ++this.loadGeneration;
    this.loading.set(true);
    this.error.set(null);
    this.api.pageDetail(key, uuid).subscribe({
      next: (page) => {
        if (generation !== this.loadGeneration) {
          return;
        }
        this.page.set(page);
        const templateUuid = page.template?.uuid;
        if (!templateUuid) {
          this.finishLoad();
          return;
        }
        this.api.templateDetail(key, templateUuid).subscribe({
          next: (td) => {
            if (generation !== this.loadGeneration) {
              return;
            }
            this.contentDefinition.set(this.toDefinition(td.compiledDefinition));
            this.finishLoad();
          },
          error: () => this.fail(generation),
        });
      },
      error: () => this.fail(generation),
    });
  }

  private finishLoad(): void {
    this.loading.set(false);
    this.loaded.set(true);
    this.expanded.set(true);
  }

  private fail(generation: number): void {
    if (generation !== this.loadGeneration) {
      return;
    }
    this.loading.set(false);
    this.error.set('Could not load this page.');
  }

  private toDefinition(compiled: unknown): ContentDefinition {
    if (compiled && typeof compiled === 'object') {
      return compiled as unknown as ContentDefinition;
    }
    return EMPTY_DEF;
  }
}
