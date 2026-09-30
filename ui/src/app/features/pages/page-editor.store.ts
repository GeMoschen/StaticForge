import { Injectable, Signal, computed, inject, signal, untracked } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import type { PreviewView } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { BodyDefinition, ContentDefinition, FormBuilderService } from '../forms';
import { mergeFindings } from '../forms/rules/rule-binding';
import { readStoredView } from '../preview/preview-view.util';
import type { ReleaseMode } from '../release/release-choice.util';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { PageAutosaveService, PagePayload } from './autosave.service';
import { PageEditorFieldsService } from './page-editor-fields.service';
import { EMPTY_DEF, toDefinition, versionToPageView } from './page-editor.mapping';
import type { ContentIssue } from './page-issues.util';
import { composePagePayload } from './page-payload.util';
import type { BodiesMap, ResolveMode, SectionInstance } from './types';

type PageView = components['schemas']['PageView'];

const SPLIT_KEY = 'sf-editor-split-ratio';

/** The routed inputs of the page editor, handed to the store once by the component. */
export interface PageEditorInputs {
  projectKey: Signal<string>;
  uuid: Signal<string>;
  focusBody: Signal<string | undefined>;
  focusSection: Signal<string | undefined>;
}

/**
 * The state the page editor's parts share (header, scope router, section palette, issues, preview, conflict drawer):
 * the page, its definitions and fields form, the findings and the live rules, plus how a page is loaded and how a
 * server copy is applied. Provided per editor (next to `PageAutosaveService`), never in root. The component owns the
 * effects and feeds them into the `sync*`/`load*` methods below, so their order under zoneless change detection is
 * the one the editor always had.
 */
@Injectable()
export class PageEditorStore {
  private readonly api = inject(ApiClient);
  private readonly project = inject(ProjectContextStore);
  private readonly fb = inject(FormBuilderService);
  private readonly toast = inject(ToastService);
  readonly timeTravel = inject(TimeTravelStore);
  readonly autosave = inject(PageAutosaveService);
  readonly fields = inject(PageEditorFieldsService);
  /** The language being edited (M24.4.1); `null` in a project without languages. */
  readonly editingLocale = inject(EditingLocaleStore).binding;
  /** Time travel or an archived project (M26). */
  readonly readOnly = inject(ProjectAccessStore).readOnly;

  projectKey!: Signal<string>;
  uuid!: Signal<string>;
  private focusBody!: Signal<string | undefined>;
  private focusSection!: Signal<string | undefined>;

  readonly page = signal<PageView | null>(null);
  readonly contentDefinition = signal<ContentDefinition | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly changedKeys = signal<string[]>([]);
  readonly sectionDefs = signal<Record<string, ContentDefinition>>({});
  readonly sectionUids = signal<Record<string, string>>({});
  /**
   * The page's content findings (`PageView.issues`, M30.3.2): from the load, every save and section change, and every
   * draft check (which also serves them in time travel, where the version read carries none).
   */
  readonly issues = signal<ContentIssue[]>([]);
  /** The view the preview shows; the Issues panel notes that its checks cover the draft. */
  readonly previewView = signal<PreviewView>(readStoredView());
  readonly splitRatio = signal(this.readSplitRatio());
  readonly centreFlex = computed(() => `${this.splitRatio()} 1 0%`);
  readonly previewFlex = computed(() => `${1 - this.splitRatio()} 1 0%`);
  /** The preview's revision pin: set only while time travelling, so a live preview reads current state. */
  readonly timeTravelRevision = this.timeTravel.activeRevision;

  /** Set right before `notifyPageChanged()` so the `pageMutated` effect can tell this editor's own echo from a mutation made elsewhere. */
  private selfMutating = false;

  /** What the editor shows: the live findings (or the last save's until they arrive) and a rejected save's. */
  readonly shownIssues = computed<ContentIssue[]>(() => {
    const live = this.fields.rules.evaluated() ? (this.fields.rules.findings() as ContentIssue[]) : this.issues();
    return mergeFindings(live, this.autosave.rejected() as ContentIssue[]);
  });

  /** Re-reads the release bar whenever the page was saved, renamed or re-uid'd (M27.6.1). */
  readonly releaseRefresh = computed(
    () => `${this.autosave.revision() ?? ''}|${this.page()?.revision ?? ''}|${this.page()?.uid ?? ''}|${this.page()?.displayName ?? ''}`,
  );

  /**
   * What the centre pane shows, driven by `?section=`/`?body=`: a single section, a single body's sections, or
   * — when neither is set — just the page's own fields with no bodies at all.
   */
  readonly focusedSection = computed<{ bodyName: string; section: SectionInstance; index: number; count: number } | null>(() => {
    const target = this.focusSection();
    if (!target) {
      return null;
    }
    const bodies = (this.page()?.bodies ?? {}) as unknown as BodiesMap;
    for (const bodyName of Object.keys(bodies)) {
      const arr = bodies[bodyName] ?? [];
      const index = arr.findIndex((s) => s.instanceId === target);
      if (index >= 0) {
        return { bodyName, section: arr[index], index, count: arr.length };
      }
    }
    return null;
  });

  readonly focusedBody = computed<BodyDefinition | null>(() => {
    if (this.focusSection()) {
      return null;
    }
    const name = this.focusBody();
    return name ? (this.bodies().find((b) => b.name === name) ?? null) : null;
  });

  constructor() {
    this.autosave.setPayloadProvider(() => this.composePayload());
    this.autosave.setRefetchHandler((page, mode) => this.onResolved(page, mode));
    // Every save answers with the page's findings for what was just saved.
    this.autosave.setSavedHandler((page) => this.issues.set((page.issues ?? []) as ContentIssue[]));
  }

  /** Called once, first thing in the component's constructor. */
  attach(inputs: PageEditorInputs): void {
    this.projectKey = inputs.projectKey;
    this.uuid = inputs.uuid;
    this.focusBody = inputs.focusBody;
    this.focusSection = inputs.focusSection;
    this.fields.attach({
      projectKey: inputs.projectKey,
      uuid: inputs.uuid,
      definition: this.contentDefinition,
      payload: () => this.composePayload(),
    });
  }

  // ── Effects' bodies (the component owns the effects) ────────────────────

  loadProject(): void {
    const key = this.projectKey();
    if (key) {
      this.project.loadFor(key).subscribe();
    }
  }

  /** Loads the page being routed to (or its version, in time travel). */
  loadRouted(): void {
    const key = this.projectKey();
    const uuid = this.uuid();
    const revision = this.timeTravel.activeRevision();
    if (key && uuid) {
      this.load(key, uuid, revision);
    }
  }

  /** Lets the nav tree highlight the active row; kept apart from the load so a section click doesn't reload. */
  syncActivePage(): void {
    this.project.setActivePage(this.uuid(), this.focusBody() ?? null, this.focusSection() ?? null);
  }

  /**
   * Picks up section moves made *outside* this editor — e.g. dragging one of this page's sections onto another page's
   * row in the nav tree. `applyServerPage()` notifies `pageMutated` for every in-editor mutation too, so
   * `selfMutating` tells "I already have the fresh state, this is my own echo" from an external one.
   */
  syncExternalMutation(): void {
    const mutated = this.project.pageMutated();
    if (!mutated || mutated !== this.uuid()) {
      return;
    }
    if (this.selfMutating) {
      this.selfMutating = false;
      return;
    }
    untracked(() => this.refreshFromServer());
  }

  /**
   * Switching the editing language must rebuild the fields form: its controls hold the language it was built for, so
   * leaving it in place would edit — and then save — the wrong language.
   */
  syncEditingLocale(): void {
    const binding = this.editingLocale();
    untracked(() => this.fields.rebindFieldsForm(binding));
  }

  // ── Loading ────────────────────────────────────────────────────────────

  private load(key: string, uuid: string, revision: number | null): void {
    this.loading.set(true);
    this.error.set(null);
    if (revision != null) {
      this.api.assetVersion(key, uuid, revision).subscribe({
        next: (detail) => this.onPageLoaded(key, versionToPageView(detail)),
        error: () => {
          this.loading.set(false);
          this.error.set('Could not load page at revision ' + revision + ' — it may have been deleted.');
        },
      });
      return;
    }
    this.api.pageDetail(key, uuid).subscribe({
      next: (page) => this.onPageLoaded(key, page),
      error: () => {
        this.loading.set(false);
        this.error.set('Could not load page — check your connection and try again.');
      },
    });
  }

  private onPageLoaded(key: string, page: PageView): void {
    this.page.set(page);
    this.issues.set((page.issues ?? []) as ContentIssue[]);
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
        // A page template's effective definition carries the editors and bodies it inherits (M20).
        const def = toDefinition(td.effectiveDefinition ?? td.compiledDefinition);
        this.contentDefinition.set(def);
        this.fields.buildFieldsForm(def, page.content);
        this.loadSectionDefs(key, page);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Could not load page template — check your connection and try again.');
      },
    });
  }

  loadSectionDefs(key: string, page: PageView): void {
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
      this.api.sectionTemplateDetail(key, ref).subscribe({
        next: (td) => {
          this.sectionDefs.update((m) => ({ ...m, [ref]: toDefinition(td.compiledDefinition) }));
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

  /** A discard wrote the released version back as the draft: reload the page and its tree node (M27.6.1). */
  onReleaseChanged(mode: ReleaseMode): void {
    if (mode !== 'discard' || this.timeTravel.isTimeTravel()) {
      return;
    }
    this.load(this.projectKey(), this.uuid(), null);
    this.project.notifyPageChanged(this.uuid());
  }

  // ── Payload / server copies ────────────────────────────────────────────

  composePayload(): PagePayload {
    return composePagePayload(this.fb, this.contentDefinition(), this.fields.fieldsForm(), this.page());
  }

  private onResolved(page: PageView, mode: ResolveMode): void {
    if (mode === 'theirs') {
      this.page.set(page);
      this.issues.set((page.issues ?? []) as ContentIssue[]);
      this.autosave.setRevision(page.revision ?? null);
      this.fields.buildFieldsForm(this.contentDefinition() ?? EMPTY_DEF, page.content);
      this.loadSectionDefs(this.projectKey(), page);
      return;
    }
    // keep mine: keep local form values, re-save against the latest revision.
    const form = this.fields.fieldsForm();
    const localContent = form ? this.fb.valueOf(this.contentDefinition() ?? EMPTY_DEF, form) : (page.content ?? {});
    this.page.set({ ...page, content: localContent } as unknown as PageView);
    this.autosave.markDirty();
    this.autosave.flush();
  }

  /** Takes a server copy after an in-editor mutation, and tells the nav tree (an expanded node for this page follows without an F5). */
  applyServerPage(page: PageView): void {
    this.page.set(page);
    this.issues.set((page.issues ?? []) as ContentIssue[]);
    this.autosave.setRevision(page.revision ?? null);
    this.loadSectionDefs(this.projectKey(), page);
    this.notifyOwnChange();
  }

  /** Tells the nav tree this page changed, marking the echo as this editor's own. */
  notifyOwnChange(): void {
    this.selfMutating = true;
    this.project.notifyPageChanged(this.uuid());
  }

  /** Re-fetches just this page (not its template/section defs) after an out-of-band mutation. */
  private refreshFromServer(): void {
    const key = this.projectKey();
    const uuid = this.uuid();
    if (!key || !uuid) {
      return;
    }
    this.api.pageDetail(key, uuid).subscribe({
      next: (page) => this.applyServerPage(page),
      error: () => this.toast.show('Could not refresh this page — it may have changed elsewhere.', 'error'),
    });
  }

  // ── Bodies ─────────────────────────────────────────────────────────────

  bodies(): BodyDefinition[] {
    return this.contentDefinition()?.bodies ?? [];
  }

  sectionsFor(bodyName: string): SectionInstance[] {
    const bodies = (this.page()?.bodies ?? {}) as unknown as BodiesMap;
    return bodies[bodyName] ?? [];
  }

  bodyCount(bodyName: string): number {
    return this.sectionsFor(bodyName).length;
  }

  private readSplitRatio(): number {
    if (typeof localStorage === 'undefined') {
      return 0.6;
    }
    const stored = Number(localStorage.getItem(SPLIT_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : 0.6;
  }

  /** Keeps the dragged divider position for the next editor. */
  persistSplitRatio(): void {
    localStorage.setItem(SPLIT_KEY, String(this.splitRatio()));
  }
}
