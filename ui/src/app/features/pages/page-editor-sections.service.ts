import { Injectable, inject, signal } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import type { BodyDefinition, ContentDefinition } from '../forms';
import { EMPTY_DEF } from './page-editor.mapping';
import { PageEditorStore } from './page-editor.store';
import { SectionPaletteService } from './section-palette.service';
import type { BodiesMap } from './types';

type PageView = components['schemas']['PageView'];

/** The MIME type a section drag carries across bodies and pages. */
const SECTION_DRAG_TYPE = 'application/x-sf-section';

/**
 * What the editor does with a page's sections besides adding one (see {@link SectionPaletteService}): the lookups
 * the section cards need, edits, removal, reordering, and moves between bodies and pages. Provided per page editor.
 */
@Injectable()
export class PageEditorSectionsService {
  private readonly api = inject(ApiClient);
  private readonly project = inject(ProjectContextStore);
  private readonly toast = inject(ToastService);
  private readonly editor = inject(PageEditorStore);
  private readonly palette = inject(SectionPaletteService);

  /** The section being dragged within its body (same-body reorder). */
  readonly drag = signal<{ body: string; index: number } | null>(null);

  defFor(templateRef: string): ContentDefinition {
    return this.editor.sectionDefs()[templateRef] ?? EMPTY_DEF;
  }

  uidFor(templateRef: string): string {
    return this.editor.sectionUids()[templateRef] ?? templateRef;
  }

  title(templateRef: string): string {
    const tpl = this.project.sectionTemplates().find((t) => t.uuid === templateRef);
    return tpl?.displayName ?? tpl?.uid ?? templateRef;
  }

  /** The page's other bodies, shown as a compact drop-target rail next to the focused body so sections can be dragged straight across without leaving the editor. */
  otherBodies(): BodyDefinition[] {
    const current = this.editor.focusedBody()?.name;
    return this.editor.bodies().filter((b) => b.name !== current);
  }

  remove(bodyName: string, instanceId: string): void {
    if (this.editor.readOnly()) {
      return;
    }
    this.api
      .deleteSection(
        this.editor.projectKey(),
        this.editor.uuid(),
        bodyName,
        instanceId,
        this.editor.autosave.revision() ?? undefined,
      )
      .subscribe({
        next: (page) => {
          this.editor.applyServerPage(page);
          this.toast.show('Section removed', 'success');
        },
        error: () => this.toast.show('Could not remove section — someone may have edited this page, try reloading it.', 'error'),
      });
  }

  moveBy(bodyName: string, from: number, delta: number): void {
    this.reorder(bodyName, from, from + delta);
  }

  onDragStarted(bodyName: string, index: number): void {
    this.drag.set({ body: bodyName, index });
  }

  onDrop(bodyName: string, targetIndex: number): void {
    const current = this.drag();
    if (current && current.body === bodyName) {
      this.reorder(bodyName, current.index, targetIndex);
    }
    this.drag.set(null);
  }

  /** Dragover for a body's dropzone — only claims drags carrying our cross-body/cross-page section payload; same-body reorder stays with `sf-section-editor`'s own dragover/drop. */
  onBodyDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes(SECTION_DRAG_TYPE)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  onBodyDrop(body: BodyDefinition, event: DragEvent): void {
    if (this.editor.readOnly() || !event.dataTransfer?.types.includes(SECTION_DRAG_TYPE)) {
      return;
    }
    event.preventDefault();
    const raw = event.dataTransfer.getData(SECTION_DRAG_TYPE);
    if (!raw) {
      return;
    }
    let payload: { pageUuid: string; bodyName: string; instanceId: string; templateRef: string };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (payload.pageUuid === this.editor.uuid() && payload.bodyName === body.name) {
      return;
    }
    if (!this.palette.allowedTemplates(body).some((t) => t.uuid === payload.templateRef)) {
      this.toast.show("This section type isn't allowed in this body.", 'error');
      return;
    }
    this.api
      .moveSection(
        this.editor.projectKey(),
        this.editor.uuid(),
        body.name,
        {
          sourcePageUuid: payload.pageUuid,
          sourceBody: payload.bodyName,
          instanceId: payload.instanceId,
          position: this.editor.bodyCount(body.name),
        },
        this.editor.autosave.revision() ?? undefined,
      )
      .subscribe({
        next: (page) => {
          this.editor.applyServerPage(page);
          if (payload.pageUuid !== this.editor.uuid()) {
            this.project.notifyPageChanged(payload.pageUuid);
          }
          this.toast.show('Section moved', 'success');
        },
        error: () =>
          this.toast.show('Could not move section — someone may have edited one of the pages, try reloading.', 'error'),
      });
  }

  private reorder(bodyName: string, from: number, to: number): void {
    if (this.editor.readOnly()) {
      return;
    }
    const arr = this.editor.sectionsFor(bodyName);
    if (from < 0 || to < 0 || from >= arr.length || to >= arr.length || from === to) {
      return;
    }
    const ids = arr.map((s) => s.instanceId);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    this.api
      .reorderSections(
        this.editor.projectKey(),
        this.editor.uuid(),
        bodyName,
        ids,
        this.editor.autosave.revision() ?? undefined,
      )
      .subscribe({
        next: (page) => this.editor.applyServerPage(page),
        error: () => this.toast.show('Could not reorder sections — someone may have edited this page, try reloading it.', 'error'),
      });
  }

  /** A section's fields changed: the page's bodies follow and the page is dirty. */
  onValueChange(bodyName: string, instanceId: string, value: Record<string, unknown>): void {
    if (this.editor.readOnly() || !this.editor.page()) {
      return;
    }
    this.editor.fields.rules.changed();
    if (this.setSectionContent(bodyName, instanceId, value)) {
      this.editor.autosave.markDirty();
    }
  }

  /**
   * A live fill changed a section (M33): the page's bodies follow without counting it as an edit — the next save
   * carries it.
   */
  onFilled(bodyName: string, instanceId: string, value: Record<string, unknown>): void {
    if (this.editor.readOnly()) {
      return;
    }
    this.setSectionContent(bodyName, instanceId, value);
  }

  /** Returns whether the section exists (and was updated). */
  private setSectionContent(bodyName: string, instanceId: string, value: Record<string, unknown>): boolean {
    const p = this.editor.page();
    if (!p) {
      return false;
    }
    const bodies = { ...((p.bodies ?? {}) as unknown as BodiesMap) };
    const arr = bodies[bodyName] ?? [];
    const idx = arr.findIndex((s) => s.instanceId === instanceId);
    if (idx < 0) {
      return false;
    }
    const next = [...arr];
    next[idx] = { ...next[idx], content: value };
    bodies[bodyName] = next;
    this.editor.page.set({ ...p, bodies } as unknown as PageView);
    return true;
  }
}
