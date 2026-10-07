import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { SfAssetFavoriteComponent } from '../../shared/components/sf-asset-favorite.component';
import { FormGroup } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import { type EditorError, type EditorStateService, saveStateOf } from '../../core/editor/editor-state';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import type { SaveResult } from '../../shared/components/dialog/unsaved-changes.service';
import { SfCopyableComponent } from '../../shared/components/display/sf-copyable.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfSaveStatusComponent } from '../../shared/components/layout/sf-save-status.component';
import { SfSectionComponent } from '../../shared/components/layout/sf-section.component';
import { SfSkeletonComponent } from '../../shared/components/layout/sf-skeleton.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfTabsComponent, type SfTab } from '../../shared/components/sf-tabs.component';
import { HistoryDrawerStore } from '../history/history-drawer.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfContentFormComponent } from '../forms/sf-content-form.component';
import {
  EMPTY_SECTIONS,
  firstSectionWithErrors,
  sectionsEqual,
  sectionsOf,
  type CdlSection,
  type CdlSections,
} from '../../shared/code-editor/cdl-sections';
import { SfCdlSectionsEditorComponent } from '../../shared/components/sf-cdl-sections-editor.component';
import { declaredPaths } from '../../shared/code-editor/completions';
import { FormBuilderService } from '../forms/form-builder.service';
import type { ContentDefinition } from '../forms/form.model';
import type { EditingLocale } from '../forms/l10n.util';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { Subscription } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import { RuleBinding, mergeFindings } from '../forms/rules/rule-binding';
import { GlobalsService, etagFor, type Diagnostic, type GlobalSetDetailView } from './globals.service';
import { ReleaseActionsComponent } from '../release/release-actions.component';
import type { ReleaseMode } from '../release/release-choice.util';
import { isOnline } from '../release/release-status.util';
import { useFrameItem } from '../../core/frame/use-frame-item';

/** What the store needs to offer Undo for a deleted property set. */
export interface DeletedGlobalSet {
  uuid: string;
  name: string;
  /** The set was released: it stays online until the deletion is released. */
  online: boolean;
}

const EMPTY_DEF: ContentDefinition = { editors: [], bodies: [] };

/** A property set's CDL tabs: a set has no page, so no bodies. */
const SET_SECTIONS: readonly CdlSection[] = ['content', 'rules'];

/** A field-level validation finding from a rejected save (`ContentIssue` on the wire). */
interface ContentIssue {
  path?: string;
  code?: string;
  message?: string;
  severity?: string;
  locale?: string;
  rule?: string;
}

/**
 * One global property set, in two tabs.
 *
 * <p><b>Values</b> renders the set's `compiledDefinition` through the same dynamic form engine the
 * page editor uses. <b>Schema</b> edits the CDL — a Content and a Rules tab (M34) — with live
 * diagnostics, mirroring the templates screen.
 *
 * <p>One Save writes both (M34): not autosave — a set is read by every page that references it, so a
 * half-typed title should not reach a preview. Values alone go to the values endpoint; a schema change
 * sends the edited values along, so schema and values are one revision. Declaring fields is still a
 * `DEVELOPER` act and filling them in an `EDITOR` one, which the server enforces per endpoint; the
 * disabled controls here are the immediate feedback, the 403 the real guard.
 */
@Component({
  selector: 'sf-global-set-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReleaseActionsComponent,
    SfAssetFavoriteComponent,
    SfButtonComponent,
    SfCdlSectionsEditorComponent,
    SfContentFormComponent,
    SfCopyableComponent,
    SfPageHeaderComponent,
    SfSaveStatusComponent,
    SfSectionComponent,
    SfSkeletonComponent,
    SfTabsComponent,
    TranslocoPipe,
  ],
  templateUrl: './global-set-detail.component.html',
  styleUrl: './global-set-detail.component.scss',
})
export class GlobalSetDetailComponent {
  readonly projectKey = input.required<string>();
  readonly uuid = input.required<string>();
  /** The tab the URL asks for (`?gtab=`); the Schema tab exists in developer mode only. */
  readonly tabParam = input<'values' | 'schema' | undefined>(undefined, { alias: 'tab' });

  /** The set was saved (values or schema), so the parent can refresh its tree. */
  readonly changed = output<void>();
  /** Another tab was chosen, so the parent can keep it in the URL. */
  readonly tabChange = output<'values' | 'schema'>();
  /** Emitted after the set was deleted; the store offers the Undo, since this panel closes with the set. */
  readonly deleted = output<DeletedGlobalSet>();

  private readonly globals = inject(GlobalsService);
  private readonly api = inject(ApiClient);
  private readonly transloco = inject(TranslocoService);
  private readonly confirms = inject(ConfirmService);
  protected readonly historyDrawer = inject(HistoryDrawerStore);
  /** Developer mode shows the Schema tab, the UID and how a template reads each field (decision 25). */
  protected readonly developerMode = inject(DeveloperModeService).enabled;
  /** The language being edited (M24.4.1); `null` in a project without languages. */
  protected readonly editingLocale = inject(EditingLocaleStore).binding;

  private readonly localesForLabels = inject(LocalesStore);

  /** Language tag to label, so the form says "from Deutsch" rather than "from de". */
  protected readonly localeLabels = computed<Record<string, string>>(() =>
    Object.fromEntries(
      this.localesForLabels.locales().map((locale) => [locale.code ?? '', locale.label ?? locale.code ?? '']),
    ),
  );

  private readonly forms = inject(FormBuilderService);
  private readonly toasts = inject(ToastService);
  private readonly timeTravel = inject(TimeTravelStore);

  protected readonly timeTravelling = this.timeTravel.isTimeTravel;

  private readonly requestedTab = signal<'values' | 'schema'>('values');
  /** Schema is a developer-mode tab: without developer mode the Values tab shows. */
  protected readonly tab = computed<'values' | 'schema'>(() => (this.developerMode() ? this.requestedTab() : 'values'));
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);

  protected readonly detail = signal<GlobalSetDetailView | null>(null);
  protected readonly definition = signal<ContentDefinition>(EMPTY_DEF);
  protected readonly valuesForm = signal<FormGroup | null>(null);

  /**
   * The content object as stored — every language, not just the one being edited. The form binds
   * one language; the fallback hint needs the others (M24.4.1).
   */
  protected readonly storedContent = signal<Record<string, unknown>>({});
  /** The schema as edited (M34): content and rules. */
  protected readonly sections = signal<CdlSections>(EMPTY_SECTIONS);
  protected readonly savedSections = computed<CdlSections | null>(() => {
    const detail = this.detail();
    return detail ? sectionsOf(detail) : null;
  });
  protected readonly cdlTabs = SET_SECTIONS;
  protected readonly cdlTab = signal<CdlSection>('content');
  protected readonly cdlDiagnostics = signal<Diagnostic[]>([]);
  /** Whether the values form holds edits the last save or load didn't write. */
  protected readonly valuesDirty = signal(false);
  private valuesSub: Subscription | null = null;

  /** The fields the Content tab declares, for completion on the Rules tab. */
  protected readonly declaredNames = computed(() =>
    declaredPaths(this.sections().content).filter((path) => !path.endsWith('[]')),
  );

  protected readonly schemaDirty = computed(() => {
    const saved = this.savedSections();
    return saved !== null && !sectionsEqual(this.sections(), saved);
  });
  /** Anything this user may save: values need `EDITOR`, the schema `DEVELOPER`. */
  protected readonly dirty = computed(
    () => (this.valuesDirty() && this.canEditValues()) || (this.schemaDirty() && this.canEditSchema()),
  );
  protected readonly valueIssues = signal<ContentIssue[]>([]);

  /** Live editor rules on the values form (M33.8). */
  protected readonly rules = new RuleBinding((request) => this.api.evaluateRules(this.projectKey(), request));
  private rulesSub: Subscription | null = null;

  /** What the values form shows: the live findings (or the stored draft's until they arrive) and a rejected save's. */
  protected readonly shownIssues = computed<ContentIssue[]>(() => {
    const live = this.rules.evaluated()
      ? (this.rules.findings() as ContentIssue[])
      : ((this.detail()?.issues ?? []) as ContentIssue[]);
    return mergeFindings(live, this.valueIssues());
  });
  /** Why the last save was refused (shown in the status and the leave dialog); cleared by the next edit or save. */
  protected readonly saveError = signal<EditorError | null>(null);
  protected readonly savedAt = signal<string | null>(null);

  private readonly permissions = inject(ProjectPermissionsStore);

  /** Values need `EDITOR`; the schema needs `DEVELOPER`. Time travel makes the whole screen read-only. */
  protected readonly canEditValues = this.permissions.canEditContent;
  protected readonly canEditSchema = this.permissions.canEditTemplates;

  /** The snippet a developer pastes into a channel template to read this set's first field. */
  protected readonly usageSnippet = computed(() => {
    const uid = this.detail()?.uid ?? 'set';
    const first = this.definition().editors?.[0]?.name ?? 'field';
    return `$CMS_VALUE(CMS_GLOBAL.${uid}.${first})$`;
  });

  /** How a template reads each top-level field (developer mode): lists and catalogs are looped over, the rest read as a value. */
  protected readonly usages = computed(() => {
    const uid = this.detail()?.uid ?? 'set';
    return this.definition().editors
      .filter((editor) => !editor.hidden)
      .map((editor) => {
        const path = `CMS_GLOBAL.${uid}.${editor.name}`;
        const loop = editor.type === 'LIST' || editor.type === 'CATALOG';
        return { name: editor.name, label: editor.label ?? editor.name, usage: loop ? `$CMS_FOR(item : ${path})$` : `$CMS_VALUE(${path})$` };
      });
  });

  protected readonly saveState = computed(() => saveStateOf({ dirty: this.dirty, saving: this.saving, error: this.saveError }));
  protected readonly readOnlyLabel = computed(() =>
    this.timeTravelling()
      ? this.transloco.translate('globals.detail.status.revision', { revision: this.timeTravel.activeRevision() ?? '—' })
      : !this.canEditValues() && !this.canEditSchema()
        ? this.transloco.translate('globals.detail.status.readOnly')
        : '',
  );

  protected readonly tabs = computed<SfTab[]>(() => {
    const tabs: SfTab[] = [
      { id: 'values', label: this.transloco.translate('globals.detail.tabs.values'), dirty: this.valuesDirty() && this.canEditValues() },
    ];
    if (this.developerMode()) {
      tabs.push({ id: 'schema', label: this.transloco.translate('globals.detail.tabs.schema'), dirty: this.schemaDirty() && this.canEditSchema() });
    }
    return tabs;
  });

  protected readonly moreActions = computed<SfMenuItem[]>(() => {
    const t = (key: string) => this.transloco.translate(`globals.detail.menu.${key}`);
    const items: SfMenuItem[] = [
      {
        id: 'discard',
        label: t('discard'),
        icon: 'undo',
        disabled: !this.dirty(),
        disabledReason: this.dirty() ? undefined : t('nothingToDiscard'),
      },
      { id: 'history', label: t('history'), icon: 'history' },
    ];
    if (this.canEditSchema()) {
      items.push({ id: 'delete', label: t('delete'), icon: 'delete', danger: true, separatorBefore: true });
    }
    return items;
  });

  /** This set as one editor for the frame: Ctrl+S saves it, and leaving it with unsaved changes asks first (M35.13). */
  private readonly editor: EditorStateService = {
    name: computed(() => this.detail()?.displayName ?? this.detail()?.uid ?? ''),
    dirty: this.dirty,
    saving: this.saving,
    lastSaved: this.savedAt,
    error: this.saveError,
    autosave: false,
    save: () => this.save(),
    discard: async () => this.discard(),
  };

  constructor() {
    const unregister = inject(ActiveEditorService).register(this.editor);
    inject(DestroyRef).onDestroy(unregister);
    effect(
      () => {
        const tab = this.tabParam();
        if (tab) {
          this.requestedTab.set(tab);
        }
      },
      { allowSignalWrites: true },
    );
    // The breadcrumb ends with the open set, and the History drawer shows its versions (M35.12).
    useFrameItem(() => {
      const set = this.detail();
      const label = set?.displayName || set?.uid;
      return label ? { label, ...(set?.uuid ? { asset: { uuid: set.uuid } } : {}) } : null;
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.cdlTimer) {
        clearTimeout(this.cdlTimer);
      }
      this.rulesSub?.unsubscribe();
      this.valuesSub?.unsubscribe();
      this.rules.dispose();
    });
    effect(() => {
      const key = this.projectKey();
      const uuid = this.uuid();
      const revision = this.timeTravel.activeRevision();
      untracked(() => this.load(key, uuid, revision));
    });

    // The values form binds one language; switching has to rebuild it, or the editors keep editing
    // the previous language and the next save writes those values into the new one (M24.4.1).
    effect(
      () => {
        const binding = this.editingLocale();
        untracked(() => this.rebindValuesForm(binding));
      },
      { allowSignalWrites: true },
    );
  }

  /** Re-binds the values form to another language, keeping unsaved edits in the one left behind. */
  private rebindValuesForm(binding: EditingLocale | null): void {
    const form = this.valuesForm();
    if (!form || this.forms.bindingOf(form)?.locale === (binding?.locale ?? null)) {
      return;
    }
    const rebound = this.forms.rebind(this.definition(), form, binding);
    this.storedContent.set(rebound.content);
    if (!this.canEditValues()) {
      rebound.form.disable();
    }
    this.valuesForm.set(rebound.form);
    this.trackValues(rebound.form, this.valuesDirty());
    this.bindRules(rebound.form);
  }

  /** Follows the values form's dirty state; `dirty` carries edits kept across a re-bind. */
  private trackValues(form: FormGroup, dirty: boolean): void {
    this.valuesSub?.unsubscribe();
    this.valuesDirty.set(dirty);
    this.valuesSub = form.valueChanges.subscribe(() => {
      this.valuesDirty.set(dirty || form.dirty);
      this.saveError.set(null);
    });
  }

  /** Evaluates the set's rules live while its values can be edited (M33.8). */
  private bindRules(form: FormGroup): void {
    this.rulesSub?.unsubscribe();
    this.rulesSub = null;
    const detail = this.detail();
    if (!this.canEditValues() || !detail?.uuid || this.timeTravel.activeRevision() != null) {
      this.rules.unbind();
      return;
    }
    const definition = this.definition();
    const locale = this.editingLocale()?.locale ?? null;
    this.rulesSub = form.valueChanges.subscribe(() => this.rules.changed());
    this.rules.bind({
      form,
      editors: definition.editors ?? [],
      locale,
      content: () => this.forms.valueOf(definition, form),
      request: (content) => ({
        kind: 'GLOBAL_SET',
        assetUuid: detail.uuid,
        content: content as never,
        locale: locale ?? undefined,
      }),
    });
  }

  protected selectTab(id: string): void {
    const tab = id === 'schema' ? 'schema' : 'values';
    this.requestedTab.set(tab);
    this.tabChange.emit(tab);
  }

  protected onMore(item: SfMenuItem): void {
    switch (item.id) {
      case 'discard':
        this.discard();
        break;
      case 'history':
        this.historyDrawer.toggle();
        break;
      case 'delete':
        void this.deleteSet();
        break;
    }
  }

  /** Gives the unsaved edits up and shows what is stored again. */
  protected discard(): void {
    this.saveError.set(null);
    this.valueIssues.set([]);
    this.cdlDiagnostics.set([]);
    const detail = this.detail();
    if (detail) {
      this.apply(detail);
    }
  }

  protected onSectionInput(change: { section: CdlSection; value: string }): void {
    this.sections.update((sections) => ({ ...sections, [change.section]: change.value }));
    this.saveError.set(null);
    this.scheduleCdlValidation();
  }

  private cdlTimer: ReturnType<typeof setTimeout> | null = null;
  private cdlSequence = 0;

  /** Live CDL diagnostics (M33): 500 ms after the last keystroke, silently; only the latest answer counts. */
  private scheduleCdlValidation(): void {
    if (this.cdlTimer) {
      clearTimeout(this.cdlTimer);
    }
    this.cdlTimer = setTimeout(() => {
      this.cdlTimer = null;
      const id = ++this.cdlSequence;
      this.globals.validateCdl(this.projectKey(), this.sections()).subscribe({
        next: (res) => {
          if (id === this.cdlSequence) {
            this.cdlDiagnostics.set(res.diagnostics ?? []);
          }
        },
        error: () => {
          // Live checks are best effort; Validate and save still report.
        },
      });
    }, 500);
  }

  /**
   * The one Save (M34). A schema change goes to the schema endpoint with the edited values along (when this user may
   * edit them), so both are one revision; values alone go to the values endpoint. Resolves how it went, for the Save
   * button, Ctrl+S and the unsaved-changes dialog.
   */
  protected async save(): Promise<SaveResult> {
    const current = this.detail();
    const form = this.valuesForm();
    if (!current?.uuid || !this.dirty() || this.saving() || this.timeTravelling()) {
      return { ok: true };
    }
    const withValues = this.valuesDirty() && this.canEditValues() && form !== null;
    const content = withValues ? this.forms.valueOf(this.definition(), form) : undefined;
    const schema = this.schemaDirty() && this.canEditSchema();
    this.saving.set(true);
    this.saveError.set(null);
    this.valueIssues.set([]);
    const request = schema
      ? this.globals.updateSchema(this.projectKey(), current.uuid, this.sections(), content, etagFor(current.revision ?? 0))
      : this.globals.updateContent(this.projectKey(), current.uuid, content ?? {}, etagFor(current.revision ?? 0));
    try {
      const saved = await firstValueFrom(request);
      this.saving.set(false);
      this.cdlDiagnostics.set([]);
      // A schema change rebuilds the values form from scratch below — reusing the FormGroup would leave
      // controls behind for editors the new schema no longer declares.
      this.apply(saved);
      this.savedAt.set(clockTime());
      this.toasts.show(
        this.transloco.translate(schema && withValues ? 'globals.detail.toast.savedBoth' : schema ? 'globals.detail.toast.savedSchema' : 'globals.detail.toast.savedValues'),
        'success',
      );
      this.changed.emit();
      return { ok: true };
    } catch (err) {
      return this.onSaveError(err);
    }
  }

  /** The Save button and the schema tab's *Validate*. */
  protected saveNow(): void {
    void this.save();
  }

  protected validateCdl(): void {
    this.globals.validateCdl(this.projectKey(), this.sections()).subscribe({
      next: (res) => {
        const diagnostics = res.diagnostics ?? [];
        this.cdlDiagnostics.set(diagnostics);
        const failed = diagnostics.some((d) => d.severity === 'ERROR');
        this.toasts.show(this.transloco.translate(failed ? 'globals.detail.toast.cdlErrors' : 'globals.detail.toast.cdlValid'), failed ? 'error' : 'success');
      },
      error: () => this.toasts.show(this.transloco.translate('globals.detail.toast.validateFailed'), 'error'),
    });
  }

  /** Asks, deletes, and hands the parent what it needs for the Undo. The set's unsaved edits go with it. */
  protected async deleteSet(): Promise<void> {
    const current = this.detail();
    if (!current?.uuid || !this.canEditSchema()) {
      return;
    }
    const online = isOnline(current.release);
    const uuid = current.uuid;
    const name: string = current.displayName ?? current.uid ?? this.transloco.translate('globals.detail.thisSet');
    const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
    const confirmed = await this.confirms.confirm({
      title: t('shared.tree.deleteTitle', { count: 1, name }),
      message: [t('globals.tree.delete.inUse'), online ? t('globals.tree.delete.online') : ''].filter(Boolean).join(' '),
      confirmLabel: t('shared.tree.deleteConfirm', { count: 1, name }),
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    this.globals.delete(this.projectKey(), uuid).subscribe({
      next: () => {
        // The set is gone: leaving it must not ask about edits that cannot be saved any more.
        this.discard();
        this.deleted.emit({ uuid, name, online });
      },
      error: (err) => {
        const inUse = err instanceof HttpErrorResponse && (err.status === 409 || err.status === 422);
        this.toasts.show(t(inUse ? 'globals.detail.toast.deleteInUse' : 'globals.detail.toast.deleteFailed'), 'error');
      },
    });
  }

  /** A discard wrote the released values back as the draft: reload the set (M27.6.1). */
  protected onReleaseChanged(mode: ReleaseMode): void {
    if (mode === 'discard' && !this.timeTravelling()) {
      this.load(this.projectKey(), this.uuid(), null);
    }
  }

  private load(projectKey: string, uuid: string, revision: number | null): void {
    if (!projectKey || !uuid) {
      return;
    }
    this.loading.set(true);
    this.valueIssues.set([]);
    this.cdlDiagnostics.set([]);
    this.globals.get(projectKey, uuid, revision).subscribe({
      next: (detail) => {
        this.loading.set(false);
        this.apply(detail);
      },
      error: () => {
        this.loading.set(false);
        this.toasts.show(this.transloco.translate('globals.detail.toast.loadFailed'), 'error');
      },
    });
  }

  private apply(detail: GlobalSetDetailView): void {
    this.detail.set(detail);
    this.sections.set(sectionsOf(detail));
    const definition = toDefinition(detail.compiledDefinition);
    this.definition.set(definition);
    this.storedContent.set((detail.content ?? {}) as Record<string, unknown>);
    const form = this.forms.build(definition, (detail.content ?? {}) as Record<string, unknown>, this.editingLocale());
    if (!this.canEditValues()) {
      form.disable();
    }
    this.valuesForm.set(form);
    this.trackValues(form, false);
    this.bindRules(form);
  }

  /**
   * A rejected save. A `409` means someone else wrote a newer version: the set is reloaded so the
   * screen shows what is actually stored rather than silently retrying over a stranger's edit. A
   * `422` carries either CDL diagnostics (the schema tab and the failing section open) or field-level `issues`
   * (the values tab opens). Every edit is kept. The refusal is both said in a toast and kept as the editor's error,
   * which turns the save status into "Not saved" and fills the unsaved-changes dialog.
   */
  private onSaveError(err: unknown): SaveResult {
    this.saving.set(false);
    const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(`globals.detail.toast.${key}`, params);
    const refuse = (message: string, count?: number): SaveResult => {
      this.saveError.set({ message, ...(count ? { count } : {}) });
      this.toasts.show(message, 'error');
      return { ok: false, message };
    };
    if (!(err instanceof HttpErrorResponse)) {
      return refuse(t('saveFailed'));
    }
    if (err.status === 409) {
      const result = refuse(t('conflict'));
      this.load(this.projectKey(), this.uuid(), this.timeTravel.activeRevision());
      this.saveError.set(null);
      return result;
    }
    const body = (err.error ?? {}) as { diagnostics?: Diagnostic[]; issues?: ContentIssue[] };
    if (Array.isArray(body.diagnostics) && body.diagnostics.length > 0) {
      this.cdlDiagnostics.set(body.diagnostics);
      this.requestedTab.set('schema');
      this.tabChange.emit('schema');
      const section = firstSectionWithErrors(body.diagnostics, SET_SECTIONS);
      if (section) {
        this.cdlTab.set(section);
      }
      return refuse(t('schemaErrors', { section: section ?? 'content' }), body.diagnostics.filter((d) => d.severity === 'ERROR').length);
    }
    if (Array.isArray(body.issues) && body.issues.length > 0) {
      this.valueIssues.set(body.issues);
      this.requestedTab.set('values');
      this.tabChange.emit('values');
      return refuse(t('invalidValues'), body.issues.filter((issue) => issue.severity === 'ERROR').length);
    }
    if (err.status === 403) {
      return refuse(this.schemaDirty() ? t('forbiddenSchema') : t('forbiddenValues'));
    }
    return refuse(t('saveFailed'));
  }
}

/** The clock time of a save, "12:04", for the save status. */
function clockTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The backend sends the compiled definition verbatim; an absent one renders an empty form. */
function toDefinition(compiled: unknown): ContentDefinition {
  if (compiled && typeof compiled === 'object') {
    return compiled as ContentDefinition;
  }
  return EMPTY_DEF;
}
