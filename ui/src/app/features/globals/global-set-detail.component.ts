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

const EMPTY_DEF: ContentDefinition = { editors: [], bodies: [] };

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
 * page editor uses, and saves explicitly (not autosave — a set is read by every page that
 * references it, so a half-typed title should not reach a preview). <b>Schema</b> edits the CDL
 * with live diagnostics, mirroring the templates screen.
 *
 * <p>The split is a permission boundary, not a layout choice: declaring fields is a `DEVELOPER`
 * act, filling them in an `EDITOR` one, and the server enforces exactly that per endpoint. The
 * disabled controls here are the immediate feedback; the 403 is the real guard.
 */
@Component({
  selector: 'sf-global-set-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfFieldComponent, SfIconComponent, SfContentFormComponent, ReleaseBarComponent],
  templateUrl: './global-set-detail.component.html',
  styleUrl: './global-set-detail.component.scss',
})
export class GlobalSetDetailComponent {
  readonly projectKey = input.required<string>();
  readonly uuid = input.required<string>();

  /** The set was saved (values or schema), so the parent can refresh its tree. */
  readonly changed = output<void>();
  readonly closed = output<void>();
  readonly deleted = output<void>();

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
  protected readonly savingValues = signal(false);
  protected readonly savingSchema = signal(false);

  protected readonly detail = signal<GlobalSetDetailView | null>(null);
  protected readonly definition = signal<ContentDefinition>(EMPTY_DEF);
  protected readonly valuesForm = signal<FormGroup | null>(null);

  /**
   * The content object as stored — every language, not just the one being edited. The form binds
   * one language; the fallback hint needs the others (M24.4.1).
   */
  protected readonly storedContent = signal<Record<string, unknown>>({});
  protected readonly contentDefinition = signal('');
  protected readonly cdlDiagnostics = signal<Diagnostic[]>([]);
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
    inject(DestroyRef).onDestroy(() => {
      this.rulesSub?.unsubscribe();
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
    this.bindRules(rebound.form);
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

  protected onContentDefinitionInput(event: Event): void {
    this.contentDefinition.set((event.target as HTMLTextAreaElement).value);
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

  protected saveValues(): void {
    const form = this.valuesForm();
    const current = this.detail();
    if (!form || !current?.uuid || !this.canEditValues()) {
      return;
    }
    const content = this.forms.valueOf(this.definition(), form);
    this.savingValues.set(true);
    this.valueIssues.set([]);
    this.globals
      .updateContent(this.projectKey(), current.uuid, content, etagFor(current.revision ?? 0))
      .subscribe({
        next: (saved) => {
          this.savingValues.set(false);
          this.apply(saved);
          this.toasts.show('Values saved', 'success');
          this.changed.emit();
        },
        error: (err) => this.onSaveError(err, 'values'),
      });
  }

  protected saveSchema(): void {
    const current = this.detail();
    if (!current?.uuid || !this.canEditSchema()) {
      return;
    }
    this.savingSchema.set(true);
    this.globals
      .updateSchema(this.projectKey(), current.uuid, this.contentDefinition(), etagFor(current.revision ?? 0))
      .subscribe({
        next: (saved) => {
          this.savingSchema.set(false);
          this.cdlDiagnostics.set([]);
          // The definition changed, so the values form is rebuilt from scratch below — reusing the
          // FormGroup would leave controls behind for editors the new schema no longer declares.
          this.apply(saved);
          this.toasts.show('Schema saved', 'success');
          this.changed.emit();
        },
        error: (err) => this.onSaveError(err, 'schema'),
      });
  }

  protected validateCdl(): void {
    this.globals.validateCdl(this.projectKey(), this.contentDefinition()).subscribe({
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
    this.globals.delete(this.projectKey(), current.uuid).subscribe({
      next: () => {
        this.toasts.show(
          online ? 'Property set deleted — it stays online until you release the deletion' : 'Property set deleted',
          'success',
        );
        this.deleted.emit();
      },
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
    this.contentDefinition.set(detail.contentDefinition ?? '');
    const definition = toDefinition(detail.compiledDefinition);
    this.definition.set(definition);
    this.storedContent.set((detail.content ?? {}) as Record<string, unknown>);
    const form = this.forms.build(definition, (detail.content ?? {}) as Record<string, unknown>, this.editingLocale());
    if (!this.canEditValues()) {
      form.disable();
    }
    this.valuesForm.set(form);
    this.bindRules(form);
  }

  /**
   * A rejected save. A `409` means someone else wrote a newer version: the set is reloaded so the
   * screen shows what is actually stored rather than silently retrying over a stranger's edit. A
   * `422` carries either CDL diagnostics (schema) or field-level `issues` (values).
   */
  private onSaveError(err: unknown, what: 'values' | 'schema'): void {
    this.savingValues.set(false);
    this.savingSchema.set(false);
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
    if (what === 'schema' && Array.isArray(body.diagnostics) && body.diagnostics.length > 0) {
      this.cdlDiagnostics.set(body.diagnostics);
      this.toasts.show('CDL has compile errors — see the diagnostics below.', 'error');
      return;
    }
    if (Array.isArray(body.issues) && body.issues.length > 0) {
      this.valueIssues.set(body.issues);
      this.toasts.show('Some values are invalid — see the messages on the fields below.', 'error');
      return;
    }
    if (err.status === 403) {
      this.toasts.show(
        what === 'schema'
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
