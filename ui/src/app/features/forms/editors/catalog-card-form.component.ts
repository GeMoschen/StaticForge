import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  OnDestroy,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { FormGroup } from '@angular/forms';
import { EditingLocaleStore } from '../../../core/project/editing-locale.store';
import { LocalesStore } from '../../../core/project/locales.store';
import { ContentDefinition } from '../form.model';
import { FormBuilderService } from '../form-builder.service';
import { NestedRules } from '../rules/nested-rules';
import { RuleHub } from '../rules/rule-hub';
import { FormFinding, SfContentFormComponent } from '../sf-content-form.component';

/**
 * The heading level of the cards of the catalog being rendered: a catalog inside a card's form is one level deeper.
 * Provided by {@link CatalogCardFormComponent}; a top-level catalog reads the default.
 */
export const CATALOG_HEADING_LEVEL = new InjectionToken<number>('CATALOG_HEADING_LEVEL');

/**
 * The body of one catalog card (M35.17): the card's own form, built from its section template's compiled definition,
 * with the live rules, field states and findings of the asset it sits in. It is the card body that `SectionEditorComponent`
 * used to render inside its own header — the catalog's `sf-card` now supplies the header, so this is the form only.
 *
 * The form is built from the card's stored content once and kept: an edit changes the value the catalog stores, not the
 * form (so typing never rebuilds the fields). It is built again when the card's definition or the editing language changes.
 */
@Component({
  selector: 'sf-catalog-card-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `forwardRef`: the form renders editors, one of which is the catalog editor, which renders this (a cycle).
  imports: [forwardRef(() => SfContentFormComponent)],
  providers: [{ provide: CATALOG_HEADING_LEVEL, useFactory: () => (inject(CATALOG_HEADING_LEVEL, { optional: true, skipSelf: true }) ?? 3) + 1 }],
  template: `
    <sf-content-form
      [definition]="contentDefinition()"
      [formGroup]="fieldForm()"
      [projectKey]="projectKey()"
      [issues]="issues()"
      [issuePrefix]="issuePrefix()"
      [fieldStates]="fieldStates()"
      [ruleHub]="readOnly() ? null : rules()"
      [editingLocale]="editingLocale()"
      [storedValue]="storedContent()"
      [localeLabels]="localeLabels()"
      (filled)="onInnerFilled()"
    />
  `,
})
export class CatalogCardFormComponent implements OnDestroy {
  private readonly fb = inject(FormBuilderService);
  protected readonly editingLocale = inject(EditingLocaleStore).binding;
  private readonly locales = inject(LocalesStore);

  readonly contentDefinition = input.required<ContentDefinition>();
  /** The card's content as stored (every language). */
  readonly content = input.required<Record<string, unknown>>();
  readonly projectKey = input<string>();
  readonly readOnly = input(false);
  /** The asset's content findings (the form shows the ones under {@link issuePrefix}). */
  readonly issues = input<ReadonlyArray<FormFinding>>([]);
  readonly rules = input<RuleHub | null>(null);
  /** Where the card's fields sit in the evaluated content (`content.teasers.cards[1].content`). `null`: unknown. */
  readonly rulePrefix = input<string | null>(null);

  readonly valueChange = output<Record<string, unknown>>();
  /** A live fill changed the card's value: the catalog takes it without counting it as an edit. */
  readonly filled = output<Record<string, unknown>>();

  protected readonly issuePrefix = computed(() => this.rulePrefix() ?? 'content');
  protected readonly fieldStates = computed(() => this.rules()?.view()?.fieldStates ?? []);
  protected readonly storedContent = computed(() => this.content() as Record<string, unknown>);
  protected readonly localeLabels = computed<Record<string, string>>(() =>
    Object.fromEntries(this.locales.locales().map((locale) => [locale.code ?? '', locale.label ?? locale.code ?? ''])),
  );

  private readonly nested = new NestedRules();

  /**
   * Built from the content as it is when the card appears (not tracked: an edit must not rebuild the form); again when the
   * definition, the editing language or the read-only state changes.
   */
  protected readonly fieldForm = computed<FormGroup>(() => {
    const definition = this.contentDefinition();
    const locale = this.editingLocale();
    const form = this.fb.build(definition, untracked(() => this.content()), locale);
    if (this.readOnly()) {
      form.disable();
    }
    return form;
  });

  constructor() {
    effect((onCleanup) => {
      const form = this.fieldForm();
      const definition = this.contentDefinition();
      const subscription = form.valueChanges.subscribe(() => this.valueChange.emit(this.fb.valueOf(definition, form)));
      onCleanup(() => subscription.unsubscribe());
    });
    // Live rules (M33): attach under the card's prefix, then apply every answer to the form.
    effect(() => {
      const hub = this.readOnly() ? null : this.rules();
      const prefix = this.issuePrefix();
      untracked(() => this.nested.attach(hub, prefix, () => this.fieldForm(), () => this.contentDefinition().editors ?? []));
    });
    effect(() => {
      const view = this.readOnly() ? null : (this.rules()?.view() ?? null);
      const form = this.fieldForm();
      const definition = this.contentDefinition();
      this.issuePrefix();
      const locale = this.editingLocale()?.locale ?? null;
      untracked(() => {
        if (this.nested.apply(view, form, definition.editors ?? [], locale)) {
          this.filled.emit(this.fb.valueOf(definition, form));
        }
      });
    });
  }

  ngOnDestroy(): void {
    this.nested.detach();
  }

  /** A nested form (a catalog inside this card) was filled: pass the card's value up the same way. */
  protected onInnerFilled(): void {
    this.filled.emit(this.fb.valueOf(this.contentDefinition(), this.fieldForm()));
  }
}
