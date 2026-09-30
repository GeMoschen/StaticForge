import { DestroyRef, Injectable, Signal, computed, inject, signal } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { ApiClient } from '../../core/api/api.client';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ContentDefinition, EditingLocale, FormBuilderService } from '../forms';
import { RuleBinding } from '../forms/rules/rule-binding';
import { PageAutosaveService, PagePayload } from './autosave.service';

/** What the fields service needs from the editor's store, handed over once (the store injects this service). */
export interface PageEditorFieldsInputs {
  projectKey: Signal<string>;
  uuid: Signal<string>;
  definition: Signal<ContentDefinition | null>;
  payload: () => PagePayload;
}

/**
 * The page's own fields form: built and re-bound per language, wired to autosave and to the live rules (M33.8), plus
 * the translation status of the language being edited (M24.4). Provided per page editor.
 */
@Injectable()
export class PageEditorFieldsService {
  private readonly api = inject(ApiClient);
  private readonly fb = inject(FormBuilderService);
  private readonly autosave = inject(PageAutosaveService);
  private readonly readOnly = inject(ProjectAccessStore).readOnly;
  private readonly localesForLabels = inject(LocalesStore);
  private readonly editingLocale = inject(EditingLocaleStore).binding;

  private projectKey!: Signal<string>;
  private uuid!: Signal<string>;
  private definition!: Signal<ContentDefinition | null>;
  private payload!: () => PagePayload;

  readonly fieldsForm = signal<FormGroup | null>(null);
  /**
   * The content object as stored — every language, not just the one being edited. The form binds
   * one language; the fallback hint needs the others (M24.4.1).
   */
  readonly storedContent = signal<Record<string, unknown>>({});
  private readonly translationStatus = signal<{ locale: string; missing: number; total: number }[] | null>(null);
  private fieldsSub: { unsubscribe(): void } | null = null;

  /**
   * Live editor rules on the page (M33.8): the whole payload — fields and sections — is evaluated; fills and states
   * apply to the page's own fields, findings show at their field wherever it is.
   */
  readonly rules = new RuleBinding((request) => this.api.evaluateRules(this.projectKey(), request));

  /** Language tag to label, so the form says "from Deutsch" rather than "from de". */
  readonly localeLabels = computed<Record<string, string>>(() =>
    Object.fromEntries(
      this.localesForLabels.locales().map((locale) => [locale.code ?? '', locale.label ?? locale.code ?? '']),
    ),
  );

  /**
   * "en: 3 of 12 fields missing" for the language being edited, or `null` when there is nothing to
   * say: no languages, the default language (which owes nothing), or a complete translation (M24.4.2).
   */
  readonly translationSummary = computed<string | null>(() => {
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

  constructor() {
    inject(DestroyRef).onDestroy(() => this.rules.dispose());
  }

  attach(inputs: PageEditorFieldsInputs): void {
    this.projectKey = inputs.projectKey;
    this.uuid = inputs.uuid;
    this.definition = inputs.definition;
    this.payload = inputs.payload;
  }

  /** Reloads the status after a save, so the count follows what the editor just typed. */
  refreshTranslationStatus(): void {
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

  buildFieldsForm(def: ContentDefinition, content: unknown): void {
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
   * Re-binds the fields form to `binding` in place, keeping unsaved edits in the language being left behind (they are
   * folded back into the stored content first). Does nothing before the form exists, or when it is already on that
   * language — a page load builds it bound correctly and must not be rebuilt underneath the editor.
   */
  rebindFieldsForm(binding: EditingLocale | null): void {
    const form = this.fieldsForm();
    const def = this.definition();
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
    const def = this.definition();
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
        const payload = this.payload();
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
}
