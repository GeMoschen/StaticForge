import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { SfAssetImpactComponent } from '../generation/insight/sf-asset-impact.component';
import { SfAssetUrlsComponent } from '../settings/asset-urls.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfUidRenameComponent } from '../../shared/components/sf-uid-rename.component';
import {
  BodyDefinition,
  ContentDefinition,
  EditingLocale,
  FormBuilderService,
  SfContentFormComponent,
} from '../forms';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SectionEditorComponent } from './section-editor.component';
import { ConflictDrawerComponent } from './conflict-drawer.component';
import { PageAutosaveService, PagePayload } from './autosave.service';
import { composePagePayload } from './page-payload.util';
import { PageNav, PageNavSettingsComponent } from './page-nav-settings.component';
import { mergePayload } from './conflict-util';
import { SfPreviewFrameComponent } from '../preview';
import { readStoredView } from '../preview/preview-view.util';
import type { PreviewView } from '../../core/api/api.client';
import { PageIssuesPanelComponent } from './page-issues-panel.component';
import { RuleBinding, mergeFindings } from '../forms/rules/rule-binding';
import {
  issueDestination,
  issueFocusTarget,
  type ContentIssue,
  type DraftCheckView,
  type IssueTarget,
} from './page-issues.util';
import type { BodiesMap, FieldResolveEvent, ResolveMode, SectionInstance } from './types';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ReleaseBarComponent } from '../release/release-bar.component';
import type { ReleaseMode } from '../release/release-choice.util';

type PageView = components['schemas']['PageView'];
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
    SectionEditorComponent,
    ConflictDrawerComponent,
    SfContentFormComponent,
    SfButtonComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    SfSpinnerComponent,
    SfPreviewFrameComponent,
    SfAssetImpactComponent,
    SfAssetUrlsComponent,
    SfUidRenameComponent,
    ReleaseBarComponent,
    PageNavSettingsComponent,
    PageIssuesPanelComponent,
  ],
  providers: [PageAutosaveService],
  templateUrl: './page-editor.component.html',
  styleUrl: './page-editor.component.scss',
})
export class PageEditorComponent {
  private readonly api = inject(ApiClient);
  /** The language being edited (M24.4.1); `null` in a project without languages. */
  protected readonly editingLocale = inject(EditingLocaleStore).binding;

  private readonly localesForLabels = inject(LocalesStore);

  /** Language tag to label, so the form says "from Deutsch" rather than "from de". */
  protected readonly localeLabels = computed<Record<string, string>>(() =>
    Object.fromEntries(
      this.localesForLabels.locales().map((locale) => [locale.code ?? '', locale.label ?? locale.code ?? '']),
    ),
  );

  private readonly store = inject(ProjectContextStore);
  private readonly fb = inject(FormBuilderService);
  private readonly toast = inject(ToastService);
  private readonly timeTravel = inject(TimeTravelStore);
  private readonly router = inject(Router);
  protected readonly autosave = inject(PageAutosaveService);

  readonly projectKey = input.required<string>();
  readonly uuid = input.required<string>();
  /** Bound from `?body=`/`?section=` query params (see `PageNavNodeComponent`). */
  readonly focusBody = input<string | undefined>(undefined, { alias: 'body' });
  readonly focusSection = input<string | undefined>(undefined, { alias: 'section' });

  protected readonly page = signal<PageView | null>(null);
  protected readonly metaOpen = signal(false);
  protected readonly editingDisplayName = signal(false);
  protected readonly displayNameDraft = signal('');
  protected readonly savingDisplayName = signal(false);
  protected readonly contentDefinition = signal<ContentDefinition | null>(null);
  protected readonly fieldsForm = signal<FormGroup | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly paletteBody = signal<BodyDefinition | null>(null);

  private readonly sectionDefs = signal<Record<string, ContentDefinition>>({});
  private readonly sectionUids = signal<Record<string, string>>({});
  protected readonly drag = signal<{ body: string; index: number } | null>(null);
  protected readonly changedKeys = signal<string[]>([]);

  private readonly mainRef = viewChild.required<ElementRef<HTMLElement>>('main');
  private readonly previewFrame = viewChild(SfPreviewFrameComponent);

  /**
   * The page's content findings (`PageView.issues`, M30.3.2): from the load, every save and section change, and every
   * draft check (which also serves them in time travel, where the version read carries none). Shown at their fields and
   * in the Issues panel.
   */
  protected readonly issues = signal<ContentIssue[]>([]);
  /** The view the preview shows; the Issues panel notes that its checks cover the draft. */
  protected readonly previewView = signal<PreviewView>(readStoredView());

  private fieldsSub: { unsubscribe(): void } | null = null;

  /**
   * Live editor rules on the page (M33.8): the whole payload — fields and sections — is evaluated; fills and states
   * apply to the page's own fields, findings show at their field wherever it is.
   */
  protected readonly rules = new RuleBinding((request) => this.api.evaluateRules(this.projectKey(), request));

  /** What the editor shows: the live findings (or the last save's until they arrive) and a rejected save's. */
  protected readonly shownIssues = computed<ContentIssue[]>(() => {
    const live = this.rules.evaluated() ? (this.rules.findings() as ContentIssue[]) : this.issues();
    return mergeFindings(live, this.autosave.rejected() as ContentIssue[]);
  });

  protected readonly splitRatio = signal(this.readSplitRatio());

  protected readonly centreFlex = computed(() => `${this.splitRatio()} 1 0%`);
  protected readonly previewFlex = computed(() => `${1 - this.splitRatio()} 1 0%`);

  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;
  /** The preview's revision pin: set only while time travelling, so a live preview reads current state. */
  protected readonly timeTravelRevision = this.timeTravel.activeRevision;

  /** Re-reads the release bar whenever the page was saved, renamed or re-uid'd (M27.6.1). */
  protected readonly releaseRefresh = computed(
    () => `${this.autosave.revision() ?? ''}|${this.page()?.revision ?? ''}|${this.page()?.uid ?? ''}|${this.page()?.displayName ?? ''}`,
  );

  protected readonly statusLabel = computed(() => {
    if (this.timeTravel.isTimeTravel()) {
      return 'Viewing revision ' + (this.timeTravel.activeRevision() ?? '—');
    }
    if (this.readOnly()) {
      return 'Archived — read-only';
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
      case 'rejected': {
        const errors = this.autosave.rejected().filter((f) => f.severity === 'ERROR').length;
        return `Not saved — fix ${errors} error${errors === 1 ? '' : 's'}`;
      }
      default:
        return '';
    }
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.rules.dispose());
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

    // Kept separate from the load effect above so that changing `?body=`/`?section=` (e.g.
    // clicking a different section) only updates the nav-tree's active-row highlight, not a
    // full reload of the page.
    effect(
      () => {
        this.store.setActivePage(this.uuid(), this.focusBody() ?? null, this.focusSection() ?? null);
      },
      { allowSignalWrites: true },
    );

    // Picks up section moves made *outside* this editor — e.g. dragging one of this page's
    // sections onto another page's row in the nav tree — which otherwise leave this editor's
    // own `page()` showing the section that was just moved away. `applyServerPage()` already
    // notifies `pageMutated` for every in-editor mutation too, so `selfMutating` distinguishes
    // "I already have the fresh state, this is just my own echo" from an external one.
    effect(
      () => {
        const mutated = this.store.pageMutated();
        if (!mutated || mutated !== this.uuid()) {
          return;
        }
        if (this.selfMutating) {
          this.selfMutating = false;
          return;
        }
        untracked(() => this.refreshFromServer());
      },
      { allowSignalWrites: true },
    );

    // Switching the editing language must rebuild the fields form: its controls hold the language
    // it was built for, so leaving it in place would edit — and then save — the wrong language.
    effect(
      () => {
        const binding = this.editingLocale();
        untracked(() => this.rebindFieldsForm(binding));
      },
      { allowSignalWrites: true },
    );

    this.autosave.setPayloadProvider(() => this.composePayload());
    this.autosave.setRefetchHandler((page, mode) => this.onResolved(page, mode));
    // Every save answers with the page's findings for what was just saved.
    this.autosave.setSavedHandler((page) => this.issues.set((page.issues ?? []) as ContentIssue[]));
  }

  /**
   * What the centre pane shows, driven by `?section=`/`?body=` (see
   * `PageNavNodeComponent`): a single section, a single body's sections, or
   * — when neither is set — just the page's own fields with no bodies at
   * all.
   */
  protected readonly focusedSection = computed<{ bodyName: string; section: SectionInstance; index: number; count: number } | null>(() => {
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

  protected readonly focusedBody = computed<BodyDefinition | null>(() => {
    if (this.focusSection()) {
      return null;
    }
    const name = this.focusBody();
    if (!name) {
      return null;
    }
    return this.bodies().find((b) => b.name === name) ?? null;
  });

  private readSplitRatio(): number {
    if (typeof localStorage === 'undefined') {
      return 0.6;
    }
    const stored = Number(localStorage.getItem(SPLIT_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : 0.6;
  }

  // ── Header metadata popover (UID rename + displayName edit) ─────────────

  protected toggleMeta(): void {
    this.metaOpen.update((v) => !v);
  }

  protected closeMeta(): void {
    this.metaOpen.set(false);
    this.editingDisplayName.set(false);
  }

  protected startEditDisplayName(): void {
    this.displayNameDraft.set(this.page()?.displayName ?? '');
    this.editingDisplayName.set(true);
  }

  protected cancelEditDisplayName(): void {
    this.editingDisplayName.set(false);
  }

  protected onDisplayNameInput(event: Event): void {
    this.displayNameDraft.set((event.target as HTMLInputElement).value);
  }

  protected saveDisplayName(): void {
    const name = this.displayNameDraft().trim();
    const key = this.projectKey();
    const uuid = this.uuid();
    if (!name || !key || !uuid || this.savingDisplayName()) {
      return;
    }
    this.savingDisplayName.set(true);
    this.api
      .renameAsset(key, uuid, { displayName: name }, this.autosave.revision() ?? undefined)
      .subscribe({
        next: (detail) => {
          this.savingDisplayName.set(false);
          this.editingDisplayName.set(false);
          this.page.update((cur) => (cur ? { ...cur, displayName: detail.displayName ?? name } : cur));
          if (detail.revision != null) {
            this.autosave.setRevision(detail.revision);
          }
          this.toast.show('Page renamed', 'success');
          this.selfMutating = true;
          this.store.notifyPageChanged(uuid);
        },
        error: () => {
          this.savingDisplayName.set(false);
          this.toast.show('Could not rename page — try again in a moment.', 'error');
        },
      });
  }

  /** The page's `nav` settings (a `JsonNode` in the API types). */
  protected navOf(page: PageView): PageNav | undefined {
    return page.nav as PageNav | undefined;
  }

  /** "Show in navigation" / "Hide from search engines" (M30.2.2): saved with the page right away. */
  protected onNavChange(nav: PageNav): void {
    if (this.readOnly()) {
      return;
    }
    this.page.update((cur) => (cur ? { ...cur, nav: nav as PageView['nav'] } : cur));
    this.autosave.markDirty();
    this.autosave.flush();
  }

  protected onUidChanged(newUid: string): void {
    this.page.update((cur) => (cur ? { ...cur, uid: newUid } : cur));
    this.selfMutating = true;
    this.store.notifyPageChanged(this.uuid());
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
        const def = this.toDefinition(td.effectiveDefinition ?? td.compiledDefinition);
        this.contentDefinition.set(def);
        this.buildFieldsForm(def, page.content);
        this.loadSectionDefs(key, page);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Could not load page template — check your connection and try again.');
      },
    });
  }

  /**
   * The content object as stored — every language, not just the one being edited. The form binds
   * one language; the fallback hint needs the others (M24.4.1).
   */
  protected readonly storedContent = signal<Record<string, unknown>>({});

  /** How complete this page's translations are (M24.4.2); `null` in a project without languages. */
  private readonly translationStatus = signal<
    { locale: string; missing: number; total: number }[] | null
  >(null);

  /**
   * "en: 3 of 12 fields missing" for the language being edited, or `null` when there is nothing to
   * say: no languages, the default language (which owes nothing), or a complete translation.
   */
  protected readonly translationSummary = computed<string | null>(() => {
    const locale = this.editingLocale()?.locale;
    const statuses = this.translationStatus();
    if (!locale || !statuses) {
      return null;
    }
    const status = statuses.find((entry) => entry.locale === locale);
    if (!status || status.missing === 0) {
      return null;
    }
    return `${this.localeLabels()[locale] ?? locale}: ${status.missing} of ${status.total} fields not translated`;
  });

  /** Reloads the status after a save, so the count follows what the editor just typed. */
  protected refreshTranslationStatus(): void {
    const key = this.projectKey();
    const uuid = this.uuid();
    if (!key || !uuid) {
      return;
    }
    this.api.translationStatus(key, uuid).subscribe({
      next: (status) =>
        this.translationStatus.set(
          (status.locales ?? []).map((entry) => ({
            locale: entry.locale ?? '',
            missing: entry.missing ?? 0,
            total: entry.total ?? 0,
          })),
        ),
      error: () => this.translationStatus.set(null),
    });
  }

  private buildFieldsForm(def: ContentDefinition, content: unknown): void {
    this.unwireFields();
    this.storedContent.set((content ?? {}) as Record<string, unknown>);
    this.refreshTranslationStatus();
    const form = this.fb.build(def, (content ?? {}) as Record<string, unknown>, this.editingLocale());
    if (this.readOnly()) {
      form.disable();
    }
    this.fieldsForm.set(form);
    if (!this.readOnly()) {
      this.wireFields();
    }
  }

  /**
   * Re-binds the fields form to `binding` in place, keeping unsaved edits in the language being
   * left behind (they are folded back into the stored content first). Does nothing before the
   * form exists, or when the form is already on that language — a page load builds it bound
   * correctly and must not be rebuilt underneath the editor.
   */
  private rebindFieldsForm(binding: EditingLocale | null): void {
    const form = this.fieldsForm();
    const def = this.contentDefinition();
    if (!form || !def || this.fb.bindingOf(form)?.locale === (binding?.locale ?? null)) {
      return;
    }
    this.unwireFields();
    const rebound = this.fb.rebind(def, form, binding);
    this.storedContent.set(rebound.content);
    if (this.readOnly()) {
      rebound.form.disable();
    }
    this.fieldsForm.set(rebound.form);
    if (!this.readOnly()) {
      this.wireFields();
    }
    this.refreshTranslationStatus();
  }

  private wireFields(): void {
    this.unwireFields();
    const form = this.fieldsForm();
    if (form) {
      this.fieldsSub = form.valueChanges.subscribe(() => {
        this.autosave.markDirty();
        this.rules.changed();
      });
      this.bindRules(form);
    }
  }

  /** Evaluates the page's rules live on its fields form (M33.8). */
  private bindRules(form: FormGroup): void {
    const def = this.contentDefinition();
    if (!def || this.readOnly()) {
      this.rules.unbind();
      return;
    }
    const locale = this.editingLocale()?.locale ?? null;
    this.rules.bind({
      form,
      editors: def.editors ?? [],
      locale,
      content: () => this.fb.valueOf(def, form),
      request: (content) => {
        const payload = this.composePayload();
        return {
          kind: 'PAGE',
          assetUuid: this.uuid(),
          content: content as never,
          bodies: (payload.bodies ?? {}) as never,
          locale: locale ?? undefined,
        };
      },
    });
  }

  private unwireFields(): void {
    this.fieldsSub?.unsubscribe();
    this.fieldsSub = null;
    this.rules.unbind();
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
      this.api.sectionTemplateDetail(key, ref).subscribe({
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
    return composePagePayload(this.fb, this.contentDefinition(), this.fieldsForm(), this.page());
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
    this.issues.set((page.issues ?? []) as ContentIssue[]);
    this.autosave.setRevision(page.revision ?? null);
    const def = this.contentDefinition() ?? EMPTY_DEF;
    this.buildFieldsForm(def, page.content);
    this.loadSectionDefs(this.projectKey(), page);
  }

  /** Set right before `notifyPageChanged()` below so the `pageMutated` effect above can tell this call's own echo apart from a mutation made elsewhere. */
  private selfMutating = false;

  private applyServerPage(page: PageView): void {
    this.page.set(page);
    this.issues.set((page.issues ?? []) as ContentIssue[]);
    this.autosave.setRevision(page.revision ?? null);
    this.loadSectionDefs(this.projectKey(), page);
    // So an already-expanded nav-tree node for this same page (bodies/sections shown read-only alongside the editor) picks up the change without an F5.
    this.selfMutating = true;
    this.store.notifyPageChanged(this.uuid());
  }

  /** A discard wrote the released version back as the draft: reload the page and its tree node (M27.6.1). */
  protected onReleaseChanged(mode: ReleaseMode): void {
    if (mode !== 'discard' || this.timeTravel.isTimeTravel()) {
      return;
    }
    this.load(this.projectKey(), this.uuid(), null);
    this.store.notifyPageChanged(this.uuid());
  }

  /** Re-fetches just this page (not its template/section defs) after an out-of-band mutation, e.g. a section dragged onto another page's row in the nav tree while this editor stayed open. */
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

  // ── Bodies / sections ──────────────────────────────────────────────────

  protected bodies(): BodyDefinition[] {
    return this.contentDefinition()?.bodies ?? [];
  }

  /** The page's other bodies, shown as a compact drop-target rail next to the focused body so sections can be dragged straight across without leaving the editor. */
  protected otherBodies(): BodyDefinition[] {
    const current = this.focusedBody()?.name;
    return this.bodies().filter((b) => b.name !== current);
  }

  protected switchBody(bodyName: string): void {
    void this.router.navigate([], { queryParams: { body: bodyName } });
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
    // Refresh section templates every time the palette opens — a template created or
    // uid-renamed on the Templates screen only reaches `store.sectionTemplates()` via that
    // screen's own force-reload, so a page editor that was already open before that happened
    // (the common case: create the template, then come back here to use it) would otherwise
    // keep showing its stale pre-creation snapshot.
    const key = this.projectKey();
    if (key) {
      this.store.loadFor(key, true).subscribe();
    }
  }

  protected addSection(body: BodyDefinition, templateUuid: string): void {
    if (this.readOnly()) {
      return;
    }
    const key = this.projectKey();
    const uuid = this.uuid();
    const revision = this.autosave.revision();
    const position = this.bodyCount(body.name);
    this.api
      .addSection(key, uuid, body.name, { templateUuid, position }, revision ?? undefined)
      .subscribe({
        next: (page) => {
          this.paletteBody.set(null);
          this.applyServerPage(page);
          this.toast.show('Section added', 'success');
        },
        error: () => this.toast.show('Could not add section — someone may have edited this page, try reloading it.', 'error'),
      });
  }

  protected removeSection(bodyName: string, instanceId: string): void {
    if (this.readOnly()) {
      return;
    }
    const revision = this.autosave.revision();
    this.api
      .deleteSection(this.projectKey(), this.uuid(), bodyName, instanceId, revision ?? undefined)
      .subscribe({
        next: (page) => {
          this.applyServerPage(page);
          this.toast.show('Section removed', 'success');
        },
        error: () => this.toast.show('Could not remove section — someone may have edited this page, try reloading it.', 'error'),
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

  /** Dragover for a body's dropzone — only claims drags carrying our cross-body/cross-page section payload; same-body reorder stays with `sf-section-editor`'s own dragover/drop. */
  protected onBodyDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('application/x-sf-section')) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  protected onBodyDrop(body: BodyDefinition, event: DragEvent): void {
    if (this.readOnly() || !event.dataTransfer?.types.includes('application/x-sf-section')) {
      return;
    }
    event.preventDefault();
    const raw = event.dataTransfer.getData('application/x-sf-section');
    if (!raw) {
      return;
    }
    let payload: { pageUuid: string; bodyName: string; instanceId: string; templateRef: string };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (payload.pageUuid === this.uuid() && payload.bodyName === body.name) {
      return;
    }
    const allowed = this.filteredSectionTemplates(body).some((t) => t.uuid === payload.templateRef);
    if (!allowed) {
      this.toast.show("This section type isn't allowed in this body.", 'error');
      return;
    }
    const revision = this.autosave.revision();
    this.api
      .moveSection(
        this.projectKey(),
        this.uuid(),
        body.name,
        {
          sourcePageUuid: payload.pageUuid,
          sourceBody: payload.bodyName,
          instanceId: payload.instanceId,
          position: this.bodyCount(body.name),
        },
        revision ?? undefined,
      )
      .subscribe({
        next: (page) => {
          this.applyServerPage(page);
          if (payload.pageUuid !== this.uuid()) {
            this.store.notifyPageChanged(payload.pageUuid);
          }
          this.toast.show('Section moved', 'success');
        },
        error: () =>
          this.toast.show(
            'Could not move section — someone may have edited one of the pages, try reloading.',
            'error',
          ),
      });
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
    const revision = this.autosave.revision();
    this.api
      .reorderSections(this.projectKey(), this.uuid(), bodyName, ids, revision ?? undefined)
      .subscribe({
        next: (page) => this.applyServerPage(page),
        error: () => this.toast.show('Could not reorder sections — someone may have edited this page, try reloading it.', 'error'),
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
    this.rules.changed();
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

  /**
   * A live fill changed a section (M33): the page's bodies follow without counting it as an edit — the next save
   * carries it.
   */
  protected onSectionFilled(bodyName: string, instanceId: string, value: Record<string, unknown>): void {
    const p = this.page();
    if (!p || this.readOnly()) {
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

  // ── Issues (M30.3.2) ───────────────────────────────────────────────────

  /** A draft check returns the completeness of the version it checked: the freshest there is. */
  protected onIssuesChecked(result: DraftCheckView): void {
    this.issues.set((result.completeness ?? []) as ContentIssue[]);
  }

  /**
   * Goes where an issue points: a page field opens the page's fields and focuses it; a section field or a section opens
   * that section (`?section=`) and focuses the field or the section; the section — or else the element — is outlined in
   * the preview while it shows the draft (the checks' view).
   */
  protected onIssueSelect(target: IssueTarget): void {
    const destination = issueDestination(target, (body, index) => this.sectionsFor(body)[index]?.instanceId ?? null);
    if (destination.form?.scope === 'page') {
      const editor = destination.form.editor;
      void this.router.navigate([], { queryParams: {} }).then(() => this.focusField(null, editor));
    } else if (destination.form?.scope === 'section') {
      const { instanceId, editor } = destination.form;
      void this.router.navigate([], { queryParams: { section: instanceId } }).then(() => this.focusField(instanceId, editor));
    }
    // The preview shows the checked view only in Draft: outlining an element of the published page would mislead.
    if (destination.preview && this.previewView() === 'draft') {
      this.previewFrame()?.focusSection(destination.preview.instanceId, destination.preview.selector);
    }
  }

  /**
   * Scrolls to a field of the page's own form (`section` null) or of a section card, or to the card itself when no
   * field is named (or the card is collapsed), and focuses it. Waits for the scope switch to render.
   */
  private focusField(section: string | null, editor: string | null, attempt = 0): void {
    const found = issueFocusTarget(this.mainRef().nativeElement, section, editor);
    if (!found) {
      if (attempt < 20) {
        setTimeout(() => this.focusField(section, editor, attempt + 1), 50);
      }
      return;
    }
    found.scrollIntoView?.({ block: 'center' });
    const field = found.hasAttribute('data-sf-editor');
    const focusable = field
      ? found.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select, [contenteditable="true"], button')
      : found.querySelector<HTMLElement>('.section-card__header');
    focusable?.focus({ preventScroll: true });
    found.classList.add('sf-issue-target');
    setTimeout(() => found.classList.remove('sf-issue-target'), 2000);
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
