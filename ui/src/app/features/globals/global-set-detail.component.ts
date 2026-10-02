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
import { FormGroup } from '@angular/forms';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfContentFormComponent } from '../forms/sf-content-form.component';
import {
  EMPTY_SECTIONS,
  firstSectionWithErrors,
  isSaveShortcut,
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
import { ReleaseBarComponent } from '../release/release-bar.component';
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
  imports: [SfCdlSectionsEditorComponent, SfButtonComponent, SfFieldComponent, SfIconComponent, SfContentFormComponent, ReleaseBarComponent],
  templateUrl: './global-set-detail.component.html',
  styleUrl: './global-set-detail.component.scss',
})
export class GlobalSetDetailComponent {
  readonly projectKey = input.required<string>();
  readonly uuid = input.required<string>();

  /** The set was saved (values or schema), so the parent can refresh its tree. */
  readonly changed = output<void>();
  readonly closed = output<void>();
  /** Emitted after the set was deleted; the store offers the Undo, since this panel closes with the set. */
  readonly deleted = output<DeletedGlobalSet>();

  private readonly globals = inject(GlobalsService);
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

  private readonly forms = inject(FormBuilderService);
  private readonly toasts = inject(ToastService);
  private readonly timeTravel = inject(TimeTravelStore);

  protected readonly timeTravelling = this.timeTravel.isTimeTravel;

  protected readonly tab = signal<'values' | 'schema'>('values');
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
  protected readonly copied = signal(false);

  private readonly permissions = inject(ProjectPermissionsStore);

  /** Values need `EDITOR`; the schema needs `DEVELOPER`. Time travel makes the whole screen read-only. */
  protected readonly canEditValues = this.permissions.canEditContent;
  protected readonly canEditSchema = this.permissions.canEditTemplates;

  /** The snippet a developer pastes into a channel template to read this set. */
  protected readonly usageSnippet = computed(() => {
    const uid = this.detail()?.uid ?? 'set';
    const first = this.definition().editors?.[0]?.name ?? 'field';
    return `$CMS_VALUE(CMS_GLOBAL.${uid}.${first})$`;
  });

  constructor() {
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
    this.valuesSub = form.valueChanges.subscribe(() => this.valuesDirty.set(dirty || form.dirty));
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

  protected showValues(): void {
    this.tab.set('values');
  }

  protected showSchema(): void {
    this.tab.set('schema');
  }

  protected onSectionInput(change: { section: CdlSection; value: string }): void {
    this.sections.update((sections) => ({ ...sections, [change.section]: change.value }));
    this.scheduleCdlValidation();
  }

  /** Ctrl+S / ⌘S saves the set (M34). */
  protected onKeydown(event: KeyboardEvent): void {
    if (isSaveShortcut(event)) {
      event.preventDefault();
      this.save();
    }
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

  protected copySnippet(): void {
    void navigator.clipboard?.writeText(this.usageSnippet()).then(
      () => {
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 1500);
      },
      () => this.toasts.show('Could not copy — select the snippet and copy it manually.', 'error'),
    );
  }

  /**
   * The one Save (M34). A schema change goes to the schema endpoint with the edited values along (when this user may
   * edit them), so both are one revision; values alone go to the values endpoint.
   */
  protected save(): void {
    const current = this.detail();
    const form = this.valuesForm();
    if (!current?.uuid || !this.dirty() || this.saving() || this.timeTravelling()) {
      return;
    }
    const withValues = this.valuesDirty() && this.canEditValues() && form !== null;
    const content = withValues ? this.forms.valueOf(this.definition(), form) : undefined;
    const schema = this.schemaDirty() && this.canEditSchema();
    this.saving.set(true);
    this.valueIssues.set([]);
    const request = schema
      ? this.globals.updateSchema(this.projectKey(), current.uuid, this.sections(), content, etagFor(current.revision ?? 0))
      : this.globals.updateContent(this.projectKey(), current.uuid, content ?? {}, etagFor(current.revision ?? 0));
    request.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.cdlDiagnostics.set([]);
        // A schema change rebuilds the values form from scratch below — reusing the FormGroup would leave
        // controls behind for editors the new schema no longer declares.
        this.apply(saved);
        this.toasts.show(schema && withValues ? 'Schema and values saved' : schema ? 'Schema saved' : 'Values saved', 'success');
        this.changed.emit();
      },
      error: (err) => this.onSaveError(err),
    });
  }

  protected validateCdl(): void {
    this.globals.validateCdl(this.projectKey(), this.sections()).subscribe({
      next: (res) => {
        const diagnostics = res.diagnostics ?? [];
        this.cdlDiagnostics.set(diagnostics);
        const failed = diagnostics.some((d) => d.severity === 'ERROR');
        this.toasts.show(failed ? 'CDL has errors' : 'CDL is valid', failed ? 'error' : 'success');
      },
      error: () => this.toasts.show('Could not validate CDL — check your connection and try again.', 'error'),
    });
  }

  protected close(): void {
    this.closed.emit();
  }

  protected deleteSet(): void {
    const current = this.detail();
    if (!current?.uuid || !this.canEditSchema()) {
      return;
    }
    const online = isOnline(current.release);
    const uuid = current.uuid;
    const name = current.displayName ?? current.uid ?? 'the property set';
    this.globals.delete(this.projectKey(), uuid).subscribe({
      next: () => this.deleted.emit({ uuid, name, online }),
      error: (err) => {
        const inUse = err instanceof HttpErrorResponse && (err.status === 409 || err.status === 422);
        this.toasts.show(
          inUse
            ? 'Could not delete — a template or page still reads this property set. Check its usages first.'
            : 'Could not delete — try again in a moment.',
          'error',
        );
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
        this.toasts.show('Could not load the property set — try again in a moment.', 'error');
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
   * (the values tab opens). Every edit is kept.
   */
  private onSaveError(err: unknown): void {
    this.saving.set(false);
    if (!(err instanceof HttpErrorResponse)) {
      this.toasts.show('Could not save — try again in a moment.', 'error');
      return;
    }
    if (err.status === 409) {
      this.toasts.show('Someone else saved this property set — reloading the current version.', 'error');
      this.load(this.projectKey(), this.uuid(), this.timeTravel.activeRevision());
      return;
    }
    const body = (err.error ?? {}) as { diagnostics?: Diagnostic[]; issues?: ContentIssue[] };
    if (Array.isArray(body.diagnostics) && body.diagnostics.length > 0) {
      this.cdlDiagnostics.set(body.diagnostics);
      this.tab.set('schema');
      const section = firstSectionWithErrors(body.diagnostics, SET_SECTIONS);
      if (section) {
        this.cdlTab.set(section);
      }
      this.toasts.show(`The schema has compile errors — see the ${section ?? 'content'} tab.`, 'error');
      return;
    }
    if (Array.isArray(body.issues) && body.issues.length > 0) {
      this.valueIssues.set(body.issues);
      this.tab.set('values');
      this.toasts.show('Some values are invalid — see the messages on the fields below.', 'error');
      return;
    }
    if (err.status === 403) {
      this.toasts.show(
        this.schemaDirty()
          ? 'Only a developer can change a property set’s schema.'
          : 'You do not have permission to change these values.',
        'error',
      );
      return;
    }
    this.toasts.show('Could not save — try again in a moment.', 'error');
  }
}

/** The backend sends the compiled definition verbatim; an absent one renders an empty form. */
function toDefinition(compiled: unknown): ContentDefinition {
  if (compiled && typeof compiled === 'object') {
    return compiled as ContentDefinition;
  }
  return EMPTY_DEF;
}
