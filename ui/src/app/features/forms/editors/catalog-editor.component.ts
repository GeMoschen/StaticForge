import { ChangeDetectionStrategy, Component, computed, effect, forwardRef, inject, input, signal, untracked } from '@angular/core';
import { FormControl } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { ApiClient } from '../../../core/api/api.client';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { EditingLocaleStore } from '../../../core/project/editing-locale.store';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { ToastService } from '../../../core/ui/toast.service';
import { SfCatalogCardDirective, SfCatalogComponent, SfCatalogItem, SfCatalogType } from '../../../shared/components/card/sf-catalog.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfSpinnerComponent } from '../../../shared/components/sf-spinner.component';
import { SfEditorBase } from '../editor-base';
import { CatalogCard, CatalogValue, ContentDefinition } from '../form.model';
import { SF_FORM_CONTEXT } from '../form.context';
import { resolve } from '../l10n.util';
import { pathOfControl } from '../rules/rule-form.util';
import { CATALOG_HEADING_LEVEL, CatalogCardFormComponent } from './catalog-card-form.component';

type TemplateSummary = components['schemas']['TemplateSummary'];

/** One card as `sf-catalog` sees it: its instance id and its section template (the card type), plus the card itself. */
interface CatalogItem extends SfCatalogItem {
  readonly card: CatalogCard;
}

const EMPTY_DEF: ContentDefinition = { editors: [], bodies: [] };

/** Editor types whose value is text a card summary can show. */
const SUMMARY_TYPES = new Set(['TEXT', 'TEXTAREA', 'RICHTEXT', 'MARKDOWN']);

/**
 * The CATALOG editor (M35.17, M35.9 decisions 7–11): an ordered list of section-template instances ("cards") in an
 * `sf-catalog` — each card a framed panel with a header (drag handle, type icon, "Type · summary", collapse, ⋮ menu) and,
 * as its body, the card's own form. The same `{instanceId, templateRef, content}` shape and allow-list semantics as a page
 * body's sections, embedded in a field value; a card's template may itself declare another catalog, which nests.
 *
 * - **Add:** "Add card" at the end (a menu of the allowed types, `definition().allow`) and a "+" between cards; **remove**
 *   with an Undo toast; **duplicate**; **reorder** by dragging a header or `Alt+↑` / `Alt+↓`; Collapse all / Expand all;
 *   collapse state remembered per field for the session (`sf-catalog`).
 * - **Summary:** the card type plus the value of the card's first text-like field, "Untitled" when empty.
 * - **Rules:** each card's form gets the live fills, field states and findings of the enclosing asset
 *   (`SF_FORM_CONTEXT`), under the card's own path (`<catalog path>.cards[i].content`), which follows the card as it moves.
 *
 * A card's schema comes from *another* asset's template, fetched by UUID, so this editor owns its `cards` signal (seeded from,
 * and pushed back into, the one `FormControl` the form builder makes for a CATALOG) instead of a typed form array.
 */
@Component({
  selector: 'sf-catalog-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `forwardRef`: `editor-registry.ts` imports this file, and the card form renders editors through the registry (a cycle).
  imports: [SfCatalogComponent, SfCatalogCardDirective, SfFieldComponent, SfSpinnerComponent, TranslocoPipe, forwardRef(() => CatalogCardFormComponent)],
  templateUrl: './catalog-editor.component.html',
  styleUrl: './catalog-editor.component.scss',
})
export class SfCatalogEditor extends SfEditorBase<FormControl> {
  private readonly api = inject(ApiClient);
  private readonly store = inject(ProjectContextStore);
  private readonly toasts = inject(ToastService);
  private readonly editingLocale = inject(EditingLocaleStore).binding;
  protected readonly level = inject(CATALOG_HEADING_LEVEL, { optional: true }) ?? 3;

  readonly projectKey = input<string>();

  /** The enclosing form (M33): its rule answers, findings and where this catalog's value sits. */
  private readonly form = inject(SF_FORM_CONTEXT, { optional: true });
  protected readonly ruleHub = computed(() => this.form?.ruleHub?.() ?? null);
  protected readonly issues = computed(() => this.form?.issues?.() ?? []);
  /** This catalog's content path (`content.teasers`, `bodies.main[0].content.rows[1].cards`); `null`: unknown. */
  private readonly catalogPath = computed(() => {
    const form = this.form;
    if (!form?.formGroup || !form.definition) {
      return null;
    }
    return pathOfControl(form.formGroup(), form.definition().editors ?? [], this.control(), form.issuePrefix?.() ?? '');
  });

  protected readonly cards = signal<CatalogCard[]>([]);
  protected readonly readOnly = computed(() => !!this.definition().readOnly);
  protected readonly items = computed<CatalogItem[]>(() => this.cards().map((card) => ({ id: card.instanceId, type: card.templateRef, card })));

  /** Remembers collapsed cards per field for the session: the project, the catalog's place and its name. */
  protected readonly catalogId = computed(() => `${this.projectKey() ?? ''}:${this.catalogPath() ?? this.definition().name}`);

  /** The allowed card types, the section templates the field's `allow` list names (all of them without one). */
  protected readonly types = computed<SfCatalogType[]>(() => {
    const allow = this.definition().allow ?? [];
    const all = this.store.sectionTemplates();
    const templates = allow.length === 0 || allow.includes('*') ? all : all.filter((t) => t.uid != null && allow.includes(t.uid));
    return templates.map((t) => ({ id: t.uuid ?? '', label: t.displayName ?? t.uid ?? '', icon: 'widgets', description: t.uid }));
  });

  private readonly defs = signal<Record<string, ContentDefinition>>({});
  private readonly pendingLoads = new Set<string>();
  private lastControl: FormControl | null = null;

  constructor() {
    super();
    // Re-seed `cards` only when the control *instance* changes (a genuinely different page or section loaded): every other
    // change flows through `emit()`, the one writer of both `cards` and the control's value, so there is no feedback loop.
    effect(
      () => {
        const control = this.control();
        if (control === this.lastControl) {
          return;
        }
        this.lastControl = control;
        const value = control.value as CatalogValue | null;
        this.cards.set(value?.cards ?? []);
      },
      { allowSignalWrites: true },
    );

    effect(() => {
      const key = this.projectKey();
      const refs = new Set(this.cards().map((c) => c.templateRef).filter(Boolean));
      if (!key) {
        return;
      }
      untracked(() => {
        for (const ref of refs) {
          this.ensureLoaded(key, ref);
        }
      });
    });
  }

  /** The catalog has no cards: a required catalog says so once. */
  protected override isEmpty(): boolean {
    return this.cards().length === 0;
  }

  /** Where card `index`'s fields sit, for its findings and live rules. */
  protected cardPrefix(index: number): string | null {
    const path = this.catalogPath();
    return path === null ? null : `${path}.cards[${index}].content`;
  }

  protected contentDefFor(templateRef: string): ContentDefinition {
    return this.defs()[templateRef] ?? EMPTY_DEF;
  }

  /**
   * A card's form is not created until its definition has loaded: creating it with a placeholder and switching later races
   * the form against its definition ("Cannot find control …").
   */
  protected isLoaded(templateRef: string): boolean {
    return this.defs()[templateRef] !== undefined;
  }

  /** The card summary: the first text-like field's value in the language being edited; `null` when empty ("Untitled"). */
  protected readonly summaryOf = (item: CatalogItem): string | null => {
    const definition = this.defs()[item.type];
    const chain = this.editingLocale()?.chain ?? [];
    for (const editor of definition?.editors ?? []) {
      if (!SUMMARY_TYPES.has(editor.type)) {
        continue;
      }
      const text = this.textOf(chain.length > 0 ? resolve(item.card.content?.[editor.name], chain) : this.anyLanguage(item.card.content?.[editor.name]));
      if (text) {
        return text;
      }
    }
    return null;
  };

  protected onAdd(event: { type: string; index: number }): void {
    const card: CatalogCard = { instanceId: crypto.randomUUID(), templateRef: event.type, content: {} };
    const next = [...this.cards()];
    next.splice(Math.max(0, Math.min(event.index, next.length)), 0, card);
    this.emit(next);
  }

  protected onMove(event: { from: number; to: number }): void {
    const list = this.cards();
    if (event.from === event.to || event.from < 0 || event.from >= list.length) {
      return;
    }
    const next = [...list];
    const [moved] = next.splice(event.from, 1);
    next.splice(event.to, 0, moved);
    this.emit(next);
  }

  protected onDuplicate(event: { item: CatalogItem; index: number }): void {
    const copy: CatalogCard = { ...event.item.card, instanceId: crypto.randomUUID(), content: structuredClone(event.item.card.content ?? {}) };
    const next = [...this.cards()];
    next.splice(event.index + 1, 0, copy);
    this.emit(next);
  }

  /** Removes the card and offers Undo, which puts it back where it was. */
  protected onRemove(event: { item: CatalogItem; index: number }): void {
    const { card } = event.item;
    this.emit(this.cards().filter((c) => c.instanceId !== card.instanceId));
    const type = this.types().find((t) => t.id === card.templateRef)?.label ?? card.templateRef;
    const summary = this.summaryOf(event.item) ?? this.transloco.translate('forms.catalog.untitled');
    this.toasts.undo(this.transloco.translate('forms.catalog.removed', { type, summary }), () => {
      if (this.cards().some((c) => c.instanceId === card.instanceId)) {
        return;
      }
      const next = [...this.cards()];
      next.splice(Math.min(event.index, next.length), 0, card);
      this.emit(next);
    });
  }

  protected onCardValueChange(instanceId: string, content: Record<string, unknown>): void {
    this.emit(this.cards().map((c) => (c.instanceId === instanceId ? { ...c, content } : c)));
  }

  /**
   * A live fill changed a card (M33): the catalog's value follows without an event — not an edit — and the enclosing form is
   * told, so a section holding this catalog passes its value up the same way.
   */
  protected onCardFilled(instanceId: string, content: Record<string, unknown>): void {
    const cards = this.cards().map((c) => (c.instanceId === instanceId ? { ...c, content } : c));
    this.cards.set(cards);
    this.control().setValue({ type: 'CATALOG', cards } satisfies CatalogValue, { emitEvent: false });
    this.form?.filled?.();
  }

  private emit(cards: CatalogCard[]): void {
    this.cards.set(cards);
    const control = this.control();
    control.setValue({ type: 'CATALOG', cards } satisfies CatalogValue, { emitEvent: true });
    control.markAsDirty();
  }

  private anyLanguage(value: unknown): unknown {
    if (value && typeof value === 'object' && 'values' in value) {
      return Object.values((value as { values: Record<string, unknown> }).values).find((v) => typeof v === 'string' && v.trim() !== '');
    }
    return value;
  }

  private textOf(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const text = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return text === '' ? null : text;
  }

  private ensureLoaded(projectKey: string, templateRef: string): void {
    if (!templateRef || this.defs()[templateRef] || this.pendingLoads.has(templateRef)) {
      return;
    }
    this.pendingLoads.add(templateRef);
    this.api.sectionTemplateDetail(projectKey, templateRef).subscribe({
      next: (td) => {
        const def =
          td.compiledDefinition && typeof td.compiledDefinition === 'object'
            ? (td.compiledDefinition as unknown as ContentDefinition)
            : EMPTY_DEF;
        this.defs.update((m) => ({ ...m, [templateRef]: def }));
      },
      error: () => {
        this.pendingLoads.delete(templateRef);
      },
      complete: () => this.pendingLoads.delete(templateRef),
    });
  }
}
