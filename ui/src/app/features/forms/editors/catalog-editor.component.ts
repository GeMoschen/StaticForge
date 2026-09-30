import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormControl } from '@angular/forms';
import { ApiClient } from '../../../core/api/api.client';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SectionEditorComponent } from '../../pages/section-editor.component';
import type { SectionInstance } from '../../pages/types';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { CatalogCard, CatalogValue, ContentDefinition, EditorDefinition } from '../form.model';
import { SF_FORM_CONTEXT } from '../form.context';
import { pathOfControl } from '../rules/rule-form.util';

type TemplateSummary = components['schemas']['TemplateSummary'];

const EMPTY_DEF: ContentDefinition = { editors: [], bodies: [] };

/**
 * Editor for a CATALOG field: an ordered list of section-template instances ("cards"),
 * restricted by `definition().allow` — the same `{instanceId, templateRef, content}` shape and
 * allow-list semantics as a page body's sections, just embedded in a field value instead of a
 * top-level body. Reuses `SectionEditorComponent` unmodified to render each card (its API is
 * already section/body-agnostic), so a card's own template may itself declare another `catalog`
 * editor — nesting "just works" via the normal `sf-editor-outlet` recursion.
 *
 * Unlike LIST (whose row schema is statically known from `definition().items`), a card's schema
 * comes from *another* asset's template, fetched by UUID — so this editor owns its own
 * `cards` signal (seeded from, and pushed back into, the single FormControl `form-builder.service`
 * builds for CATALOG) instead of a typed FormArray of sub-controls.
 */
@Component({
  selector: 'sf-catalog-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `forwardRef` (not a direct class reference): `editor-registry.ts` imports this file to map
  // 'CATALOG' -> SfCatalogEditor, and SectionEditorComponent's own render path (via
  // SfContentFormComponent -> SfEditorOutlet) imports `editor-registry.ts` back — a real cycle.
  // A direct reference here would be captured as `undefined` by whichever module happens to
  // still be mid-evaluation when this decorator runs; `forwardRef`'s thunk instead gets called
  // lazily when Angular actually resolves template matches, well after the whole module graph
  // has settled.
  imports: [SfIconComponent, SfButtonComponent, SfFieldComponent, forwardRef(() => SectionEditorComponent)],
  templateUrl: './catalog-editor.component.html',
  styleUrl: './catalog-editor.component.scss',
})
export class SfCatalogEditor {
  private readonly api = inject(ApiClient);
  private readonly store = inject(ProjectContextStore);

  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormControl>();
  readonly projectKey = input<string>();

  /** The enclosing form (M33): its rule answers, findings and where this catalog's value sits. */
  private readonly form = inject(SF_FORM_CONTEXT, { optional: true });
  protected readonly ruleHub = computed(() => this.form?.ruleHub?.() ?? null);
  protected readonly findings = computed(() => this.form?.issues?.() ?? []);
  /** This catalog's content path (`content.teasers`, `bodies.main[0].content.rows[1].cards`); `null`: unknown. */
  private readonly catalogPath = computed(() => {
    const form = this.form;
    if (!form?.formGroup || !form.definition) {
      return null;
    }
    return pathOfControl(form.formGroup(), form.definition().editors ?? [], this.control(), form.issuePrefix?.() ?? '');
  });

  /** Where card `index`'s fields sit, for its findings and live rules. */
  protected cardPrefix(index: number): string | null {
    const path = this.catalogPath();
    return path === null ? null : `${path}.cards[${index}].content`;
  }

  protected readonly cards = signal<CatalogCard[]>([]);
  protected readonly paletteOpen = signal(false);

  private readonly defs = signal<Record<string, ContentDefinition>>({});
  private readonly pendingLoads = new Set<string>();
  private lastControl: FormControl | null = null;
  private dragIndex: number | null = null;

  protected allowedTemplates(): TemplateSummary[] {
    const allow = this.definition().allow ?? [];
    const templates = this.store.sectionTemplates();
    if (allow.length === 0 || allow.includes('*')) {
      return templates;
    }
    return templates.filter((t) => t.uid != null && allow.includes(t.uid));
  }

  constructor() {
    // Re-seed `cards` only when the control *instance* changes (a genuinely different
    // page/section loaded) — every other mutation flows through `emit()` below, which is the
    // sole writer of both `cards` and the control's value, so there's no feedback loop to guard.
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

  protected contentDefFor(templateRef: string): ContentDefinition {
    return this.defs()[templateRef] ?? EMPTY_DEF;
  }

  /**
   * `sf-section-editor` must never be created with a placeholder `EMPTY_DEF` and then
   * transitioned to the real definition later — that transition races its own effect (deferred
   * to a microtask) against this component's synchronous template re-render, leaving
   * `SfContentFormComponent.controlFor()` looking up a control the stale form group never got
   * ("Cannot find control with unspecified name attribute"). So: don't create the card at all
   * until its definition has actually loaded.
   */
  protected isLoaded(templateRef: string): boolean {
    return this.defs()[templateRef] !== undefined;
  }

  protected uidFor(templateRef: string): string {
    return this.templateOf(templateRef)?.uid ?? templateRef;
  }

  protected titleFor(templateRef: string): string {
    const tpl = this.templateOf(templateRef);
    return tpl?.displayName ?? tpl?.uid ?? templateRef;
  }

  protected asSection(card: CatalogCard): SectionInstance {
    return card;
  }

  protected togglePalette(): void {
    if (this.definition().readOnly) {
      return;
    }
    this.paletteOpen.update((v) => !v);
  }

  protected addCard(templateRef: string): void {
    const card: CatalogCard = { instanceId: crypto.randomUUID(), templateRef, content: {} };
    this.emit([...this.cards(), card]);
    this.paletteOpen.set(false);
  }

  protected removeCard(instanceId: string): void {
    this.emit(this.cards().filter((c) => c.instanceId !== instanceId));
  }

  protected moveCard(index: number, delta: number): void {
    const target = index + delta;
    const list = this.cards();
    if (target < 0 || target >= list.length) {
      return;
    }
    const next = [...list];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    this.emit(next);
  }

  protected onCardValueChange(instanceId: string, content: Record<string, unknown>): void {
    this.emit(this.cards().map((c) => (c.instanceId === instanceId ? { ...c, content } : c)));
  }

  /**
   * A live fill changed a card (M33): the catalog's value follows without an event — not an edit — and the enclosing
   * form is told, so a section holding this catalog passes its value up the same way.
   */
  protected onCardFilled(instanceId: string, content: Record<string, unknown>): void {
    const cards = this.cards().map((c) => (c.instanceId === instanceId ? { ...c, content } : c));
    this.cards.set(cards);
    this.control().setValue({ type: 'CATALOG', cards } satisfies CatalogValue, { emitEvent: false });
    this.form?.filled?.();
  }

  protected onDragStarted(index: number): void {
    this.dragIndex = index;
  }

  protected onDropOn(targetIndex: number): void {
    const from = this.dragIndex;
    this.dragIndex = null;
    if (from == null || from === targetIndex) {
      return;
    }
    const list = [...this.cards()];
    const [moved] = list.splice(from, 1);
    list.splice(targetIndex, 0, moved);
    this.emit(list);
  }

  protected onDragEnd(): void {
    this.dragIndex = null;
  }

  private templateOf(templateRef: string): TemplateSummary | undefined {
    return this.store.sectionTemplates().find((t) => t.uuid === templateRef);
  }

  private emit(cards: CatalogCard[]): void {
    this.cards.set(cards);
    const control = this.control();
    control.setValue({ type: 'CATALOG', cards } satisfies CatalogValue, { emitEvent: true });
    control.markAsDirty();
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
