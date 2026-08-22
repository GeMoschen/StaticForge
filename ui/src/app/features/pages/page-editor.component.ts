import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormGroup } from '@angular/forms';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import {
  BodyDefinition,
  ContentDefinition,
  FormBuilderService,
  SfContentFormComponent,
} from '../forms';
import type { components } from '../../core/api/generated/schema.d.ts';
import { FolderNodeComponent } from './folder-node.component';
import { SectionEditorComponent } from './section-editor.component';
import { ConflictDrawerComponent } from './conflict-drawer.component';
import { PageAutosaveService, PagePayload } from './autosave.service';
import { mergePayload } from './conflict-util';
import { SfPreviewFrameComponent } from '../preview';
import type { BodiesMap, FieldResolveEvent, ResolveMode, SectionInstance } from './types';

type PageView = components['schemas']['PageView'];
type TemplateDetail = components['schemas']['TemplateDetail'];
type TemplateSummary = components['schemas']['TemplateSummary'];
type AssetDetailView = components['schemas']['AssetDetailView'];

const SPLIT_KEY = 'sf-editor-split-ratio';
const EMPTY_DEF: ContentDefinition = { editors: [], bodies: [] };

/**
 * Split-view page editor: collapsible folder tree (left), page fields +
 * bodies/sections (centre), and a preview placeholder (right, wired by
 * feature F). Owns autosave and the conflict drawer.
 */
@Component({
  selector: 'sf-page-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FolderNodeComponent,
    SectionEditorComponent,
    ConflictDrawerComponent,
    SfContentFormComponent,
    SfButtonComponent,
    SfEmptyStateComponent,
    SfPreviewFrameComponent,
  ],
  providers: [PageAutosaveService],
  templateUrl: './page-editor.component.html',
  styleUrl: './page-editor.component.scss',
})
export class PageEditorComponent {
  private readonly api = inject(ApiClient);
  private readonly http = inject(HttpClient);
  private readonly store = inject(ProjectContextStore);
  private readonly fb = inject(FormBuilderService);
  private readonly toast = inject(ToastService);
  private readonly timeTravel = inject(TimeTravelStore);
  protected readonly autosave = inject(PageAutosaveService);

  readonly projectKey = input.required<string>();
  readonly uuid = input.required<string>();

  protected readonly tree = this.store.folderTree;

  protected readonly page = signal<PageView | null>(null);
  protected readonly contentDefinition = signal<ContentDefinition | null>(null);
  protected readonly fieldsForm = signal<FormGroup | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly treeOpen = signal(true);
  protected readonly paletteBody = signal<BodyDefinition | null>(null);

  protected readonly liveTemplateUuid = computed(
    () => this.page()?.template?.uuid ?? '',
  );
  protected readonly liveContent = signal<Record<string, unknown>>({});
  protected readonly liveBodies = computed<Record<string, unknown>>(
    () => (this.page()?.bodies ?? {}) as unknown as Record<string, unknown>,
  );

  private readonly sectionDefs = signal<Record<string, ContentDefinition>>({});
  private readonly sectionUids = signal<Record<string, string>>({});
  protected readonly drag = signal<{ body: string; index: number } | null>(null);
  protected readonly changedKeys = signal<string[]>([]);

  private readonly mainRef = viewChild.required<ElementRef<HTMLElement>>('main');

  private fieldsSub: { unsubscribe(): void } | null = null;

  protected readonly splitRatio = signal(this.readSplitRatio());

  protected readonly centreFlex = computed(() => `${this.splitRatio()} 1 0%`);
  protected readonly previewFlex = computed(() => `${1 - this.splitRatio()} 1 0%`);

  protected readonly readOnly = this.timeTravel.isTimeTravel;

  protected readonly statusLabel = computed(() => {
    if (this.readOnly()) {
      return 'Viewing revision ' + (this.timeTravel.activeRevision() ?? '—');
    }
    switch (this.autosave.saveState()) {
      case 'dirty':
        return 'Unsaved';
      case 'saving':
        return 'Saving…';
      case 'saved':
        return 'Saved ' + (this.autosave.lastSavedAt() ?? '');
      case 'error':
        return 'Save failed';
      default:
        return '';
    }
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
        const uuid = this.uuid();
        const revision = this.timeTravel.activeRevision();
        if (!key || !uuid) {
          return;
        }
        this.load(key, uuid, revision);
      },
      { allowSignalWrites: true },
    );

    this.autosave.setPayloadProvider(() => this.composePayload());
    this.autosave.setRefetchHandler((page, mode) => this.onResolved(page, mode));
  }

  private readSplitRatio(): number {
    if (typeof localStorage === 'undefined') {
      return 0.6;
    }
    const stored = Number(localStorage.getItem(SPLIT_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : 0.6;
  }

  protected toggleTree(): void {
    this.treeOpen.update((v) => !v);
  }

  // ── Loading ────────────────────────────────────────────────────────────

  private load(key: string, uuid: string, revision: number | null): void {
    this.loading.set(true);
    this.error.set(null);
    if (revision != null) {
      this.api.assetVersion(key, uuid, revision).subscribe({
        next: (detail) => this.onPageLoaded(key, this.toPageView(detail)),
        error: () => {
          this.loading.set(false);
          this.error.set('Failed to load page at revision ' + revision);
        },
      });
      return;
    }
    this.api.pageDetail(key, uuid).subscribe({
      next: (page) => this.onPageLoaded(key, page),
      error: () => {
        this.loading.set(false);
        this.error.set('Failed to load page');
      },
    });
  }

  private toPageView(detail: AssetDetailView): PageView {
    const payload = (detail.payload ?? {}) as Record<string, unknown>;
    const templateRef = payload['templateRef'];
    return {
      uuid: detail.uuid,
      uid: detail.uid,
      displayName: detail.displayName,
      revision: detail.revision,
      folderPath: detail.folderPath,
      template:
        typeof templateRef === 'string'
          ? { uuid: templateRef }
          : undefined,
      content: (payload['content'] ?? {}) as PageView['content'],
      bodies: (payload['bodies'] ?? {}) as PageView['bodies'],
      nav: payload['nav'] as PageView['nav'],
      output: payload['output'] as PageView['output'],
      meta: payload['meta'] as PageView['meta'],
    };
  }

  private onPageLoaded(key: string, page: PageView): void {
    this.page.set(page);
    if (!this.readOnly()) {
      this.autosave.configure(key, this.uuid(), page.revision ?? null);
    }

    const templateUuid = page.template?.uuid;
    if (!templateUuid) {
      this.loading.set(false);
      return;
    }

    this.api.templateDetail(key, templateUuid).subscribe({
      next: (td) => {
        const def = this.toDefinition(td.compiledDefinition);
        this.contentDefinition.set(def);
        this.buildFieldsForm(def, page.content);
        this.loadSectionDefs(key, page);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Failed to load page template');
      },
    });
  }

  private buildFieldsForm(def: ContentDefinition, content: unknown): void {
    this.unwireFields();
    const form = this.fb.build(def, (content ?? {}) as Record<string, unknown>);
    if (this.readOnly()) {
      form.disable();
    }
    this.fieldsForm.set(form);
    this.liveContent.set(
      this.fb.valueOf(def, this.fieldsForm() ?? undefined),
    );
    if (!this.readOnly()) {
      this.wireFields();
    }
  }

  private wireFields(): void {
    this.unwireFields();
    const form = this.fieldsForm();
    if (form) {
      this.fieldsSub = form.valueChanges.subscribe(() => {
        this.autosave.markDirty();
        this.liveContent.set(
          this.fb.valueOf(this.contentDefinition() ?? EMPTY_DEF, form),
        );
      });
    }
  }

  private unwireFields(): void {
    this.fieldsSub?.unsubscribe();
    this.fieldsSub = null;
  }

  private loadSectionDefs(key: string, page: PageView): void {
    const refs = new Set<string>();
    const bodies = (page.bodies ?? {}) as unknown as BodiesMap;
    for (const name of Object.keys(bodies)) {
      for (const section of bodies[name] ?? []) {
        if (section.templateRef) {
          refs.add(section.templateRef);
        }
      }
    }
    const missing = [...refs].filter((ref) => !this.sectionDefs()[ref]);
    if (missing.length === 0) {
      this.loading.set(false);
      return;
    }
    let pending = missing.length;
    for (const ref of missing) {
      this.http
        .get<TemplateDetail>(`/api/v1/projects/${key}/section-templates/${ref}`)
        .subscribe({
          next: (td) => {
            this.sectionDefs.update((m) => ({ ...m, [ref]: this.toDefinition(td.compiledDefinition) }));
            this.sectionUids.update((m) => ({ ...m, [ref]: td.uid ?? ref }));
            if (--pending === 0) {
              this.loading.set(false);
            }
          },
          error: () => {
            if (--pending === 0) {
              this.loading.set(false);
            }
          },
        });
    }
  }

  private toDefinition(compiled: unknown): ContentDefinition {
    if (compiled && typeof compiled === 'object') {
      return compiled as unknown as ContentDefinition;
    }
    return EMPTY_DEF;
  }

  // ── Payload / autosave ─────────────────────────────────────────────────

  private composePayload(): PagePayload {
    const def = this.contentDefinition();
    const form = this.fieldsForm();
    const content = def && form ? this.fb.valueOf(def, form) : (this.page()?.content ?? {});
    return {
      content,
      bodies: this.page()?.bodies ?? {},
      nav: this.page()?.nav,
      output: this.page()?.output,
      meta: this.page()?.meta,
    };
  }

  private onResolved(page: PageView, mode: ResolveMode): void {
    if (mode === 'theirs') {
      this.applyServerFull(page);
      return;
    }
    // keep mine: keep local form values, re-save against the latest revision.
    const localContent = this.fieldsForm()
      ? this.fb.valueOf(this.contentDefinition() ?? EMPTY_DEF, this.fieldsForm()!)
      : (page.content ?? {});
    this.page.set({ ...page, content: localContent } as unknown as PageView);
    this.autosave.markDirty();
    this.autosave.flush();
  }

  private applyServerFull(page: PageView): void {
    this.page.set(page);
    this.autosave.setRevision(page.revision ?? null);
    const def = this.contentDefinition() ?? EMPTY_DEF;
    this.buildFieldsForm(def, page.content);
    this.loadSectionDefs(this.projectKey(), page);
  }

  private applyServerPage(page: PageView): void {
    this.page.set(page);
    this.autosave.setRevision(page.revision ?? null);
    this.loadSectionDefs(this.projectKey(), page);
  }

  // ── Bodies / sections ──────────────────────────────────────────────────

  protected bodies(): BodyDefinition[] {
    return this.contentDefinition()?.bodies ?? [];
  }

  protected sectionsFor(bodyName: string): SectionInstance[] {
    const bodies = (this.page()?.bodies ?? {}) as unknown as BodiesMap;
    return bodies[bodyName] ?? [];
  }

  protected bodyCount(bodyName: string): number {
    return this.sectionsFor(bodyName).length;
  }

  protected defFor(templateRef: string): ContentDefinition {
    return this.sectionDefs()[templateRef] ?? EMPTY_DEF;
  }

  protected uidFor(templateRef: string): string {
    return this.sectionUids()[templateRef] ?? templateRef;
  }

  protected sectionTitle(templateRef: string): string {
    const tpl = this.store.sectionTemplates().find((t) => t.uuid === templateRef);
    return tpl?.displayName ?? tpl?.uid ?? templateRef;
  }

  protected trackSection(index: number, section: SectionInstance): string {
    void index;
    return `${section.instanceId}|${section.templateRef}`;
  }

  protected filteredSectionTemplates(body: BodyDefinition): TemplateSummary[] {
    const allow = body.allow ?? [];
    const templates = this.store.sectionTemplates();
    if (allow.length === 0 || allow.includes('*')) {
      return templates;
    }
    return templates.filter((t) => t.uid != null && allow.includes(t.uid));
  }

  protected openPalette(body: BodyDefinition): void {
    if (this.readOnly()) {
      return;
    }
    this.paletteBody.set(body);
  }

  protected addSection(body: BodyDefinition, templateUuid: string): void {
    if (this.readOnly()) {
      return;
    }
    const key = this.projectKey();
    const uuid = this.uuid();
    const revision = this.page()?.revision;
    const position = this.bodyCount(body.name);
    this.api
      .addSection(key, uuid, body.name, { templateUuid, position }, revision ?? undefined)
      .subscribe({
        next: (page) => {
          this.paletteBody.set(null);
          this.applyServerPage(page);
          this.toast.show('Section added', 'success');
        },
        error: () => this.toast.show('Failed to add section', 'error'),
      });
  }

  protected removeSection(bodyName: string, instanceId: string): void {
    if (this.readOnly()) {
      return;
    }
    const revision = this.page()?.revision;
    this.api
      .deleteSection(this.projectKey(), this.uuid(), bodyName, instanceId, revision ?? undefined)
      .subscribe({
        next: (page) => {
          this.applyServerPage(page);
          this.toast.show('Section removed', 'success');
        },
        error: () => this.toast.show('Failed to remove section', 'error'),
      });
  }

  protected moveSectionBy(bodyName: string, from: number, delta: number): void {
    this.reorderSections(bodyName, from, from + delta);
  }

  protected onDragStarted(bodyName: string, index: number): void {
    this.drag.set({ body: bodyName, index });
  }

  protected onDrop(bodyName: string, targetIndex: number): void {
    const current = this.drag();
    if (current && current.body === bodyName) {
      this.reorderSections(bodyName, current.index, targetIndex);
    }
    this.drag.set(null);
  }

  private reorderSections(bodyName: string, from: number, to: number): void {
    if (this.readOnly()) {
      return;
    }
    const arr = this.sectionsFor(bodyName);
    if (from < 0 || to < 0 || from >= arr.length || to >= arr.length || from === to) {
      return;
    }
    const ids = arr.map((s) => s.instanceId);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    const revision = this.page()?.revision;
    this.api
      .reorderSections(this.projectKey(), this.uuid(), bodyName, ids, revision ?? undefined)
      .subscribe({
        next: (page) => this.applyServerPage(page),
        error: () => this.toast.show('Failed to reorder sections', 'error'),
      });
  }

  protected onSectionValueChange(
    bodyName: string,
    instanceId: string,
    value: Record<string, unknown>,
  ): void {
    if (this.readOnly()) {
      return;
    }
    const p = this.page();
    if (!p) {
      return;
    }
    const bodies = { ...((p.bodies ?? {}) as unknown as BodiesMap) };
    const arr = bodies[bodyName] ?? [];
    const idx = arr.findIndex((s) => s.instanceId === instanceId);
    if (idx < 0) {
      return;
    }
    const next = [...arr];
    next[idx] = { ...next[idx], content: value };
    bodies[bodyName] = next;
    this.page.set({ ...p, bodies } as unknown as PageView);
    this.autosave.markDirty();
  }

  protected onResolve(mode: ResolveMode): void {
    this.autosave.resolveConflict(mode);
  }

  protected onResolveFields(event: FieldResolveEvent): void {
    const conflict = this.autosave.conflict();
    if (!conflict || conflict.base == null || conflict.theirs == null) {
      return;
    }
    const local = this.composePayload();
    const merged = mergePayload(conflict.theirs, local, event.fields) as Record<string, unknown>;
    const mergedPage = this.payloadToPageView(merged);
    this.page.set(mergedPage);
    this.buildFieldsForm(this.contentDefinition() ?? EMPTY_DEF, merged['content']);
    this.loadSectionDefs(this.projectKey(), mergedPage);
    this.autosave.resolveFields(conflict.currentRevision);
    this.autosave.flush();
  }

  private payloadToPageView(payload: Record<string, unknown>): PageView {
    const base = this.page() ?? ({} as PageView);
    const templateRef = payload['templateRef'];
    return {
      ...base,
      template:
        typeof templateRef === 'string'
          ? { uuid: templateRef }
          : base.template,
      content: (payload['content'] ?? {}) as PageView['content'],
      bodies: (payload['bodies'] ?? {}) as PageView['bodies'],
      nav: payload['nav'] as PageView['nav'],
      output: payload['output'] as PageView['output'],
      meta: payload['meta'] as PageView['meta'],
    };
  }

  /**
   * Handles a section click forwarded from the preview iframe. No-op for now:
   * wiring the matching section editor into focus is a stretch goal.
   */
  protected onPreviewSectionClick(instanceId: string): void {
    void instanceId;
  }

  protected onDividerPointerDown(event: PointerEvent): void {
    event.preventDefault();
    const el = this.mainRef().nativeElement;
    const move = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      this.splitRatio.set(Math.min(0.85, Math.max(0.15, ratio)));
    };
    const up = () => {
      localStorage.setItem(SPLIT_KEY, String(this.splitRatio()));
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }
}
