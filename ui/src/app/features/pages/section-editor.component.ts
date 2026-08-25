import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormGroup } from '@angular/forms';
// Imported from their own files, not the `../forms` barrel: that barrel re-exports
// `editor-registry.ts`, which imports `SfCatalogEditor`, which imports this component to
// render cards — going through the barrel here would close that into a circular import
// (harmless for `ng build`'s bundler, but breaks Vite dev-server module evaluation with a
// "Cannot read properties of undefined (reading 'ɵcmp')" crash the first time a card renders).
import { ContentDefinition } from '../forms/form.model';
import { FormBuilderService } from '../forms/form-builder.service';
import { SfContentFormComponent } from '../forms/sf-content-form.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import type { SectionInstance } from './types';

/**
 * A single collapsible section card inside a page body. Builds its own form
 * from the section template's compiled definition and reports value changes
 * upward. Supports native drag + keyboard (Alt+ArrowUp/Down) reordering and
 * delete, all delegated to the parent via outputs.
 */
@Component({
  selector: 'sf-section-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfContentFormComponent, SfIconComponent],
  templateUrl: './section-editor.component.html',
  styleUrl: './section-editor.component.scss',
})
export class SectionEditorComponent {
  private readonly fb = inject(FormBuilderService);

  readonly contentDefinition = input.required<ContentDefinition>();
  readonly section = input.required<SectionInstance>();
  readonly projectKey = input<string>();
  /** The page this section belongs to — carried in the drag payload so a drop target elsewhere in the same editor (another body) knows where it came from. */
  readonly pageUuid = input<string>();
  readonly bodyName = input.required<string>();
  readonly templateUid = input.required<string>();
  readonly title = input<string>('');
  readonly index = input.required<number>();
  readonly count = input.required<number>();
  readonly readOnly = input(false);
  /** When true, the move/remove action buttons are hidden (e.g. single-section focus view). */
  readonly hideActions = input(false);

  readonly valueChange = output<Record<string, unknown>>();
  readonly remove = output<void>();
  readonly moveUp = output<void>();
  readonly moveDown = output<void>();
  readonly dragStarted = output<number>();
  readonly dropOn = output<number>();
  readonly dragEnd = output<void>();

  protected readonly collapsed = signal(false);
  protected readonly fieldForm = signal<FormGroup | null>(null);

  private valueSub: { unsubscribe(): void } | null = null;
  /** Guards the effect below so it only rebuilds the form when it starts editing a *different* section — an `@if`-scoped (as opposed to `@for`-tracked) host reuses the same component instance across navigations between sections, and re-syncing on every `section` reference change (e.g. after this same section's own autosave round-trip) would otherwise clobber in-progress edits. */
  private lastInstanceId: string | null = null;
  /**
   * Also rebuild whenever the *definition* itself changes reference, even for the same
   * section instance — e.g. `page-editor.component.ts` filling in a section template's
   * compiled definition asynchronously right after this section first mounted. Without
   * this, `fieldForm` stays built from the (possibly empty) old definition while the
   * template rebinds `[definition]` to the new one, so `SfContentFormComponent.controlFor()`
   * looks up a control by a name the stale form group never got — returning `null` and
   * crashing editors that dereference `control()` in their template (e.g. `SfBooleanEditor`).
   */
  private lastDefinition: ContentDefinition | null = null;

  constructor() {
    effect(
      () => {
        const definition = this.contentDefinition();
        const section = this.section();
        if (section.instanceId === this.lastInstanceId && definition === this.lastDefinition) {
          return;
        }
        this.lastInstanceId = section.instanceId;
        this.lastDefinition = definition;

        const content = (section.content ?? {}) as Record<string, unknown>;
        const form = this.fb.build(definition, content);
        if (this.readOnly()) {
          form.disable();
        }
        this.valueSub?.unsubscribe();
        this.valueSub = form.valueChanges.subscribe(() => {
          this.valueChange.emit(this.fb.valueOf(definition, form));
        });
        this.fieldForm.set(form);

        const key = this.collapseKey();
        this.collapsed.set(localStorage.getItem(key) === '1');
      },
      { allowSignalWrites: true },
    );
  }

  ngOnDestroy(): void {
    this.valueSub?.unsubscribe();
  }

  protected toggleCollapsed(event?: MouseEvent): void {
    event?.stopPropagation();
    this.collapsed.update((v) => {
      const next = !v;
      localStorage.setItem(this.collapseKey(), next ? '1' : '0');
      return next;
    });
  }

  private collapseKey(): string {
    return `sf-section-collapsed-${this.templateUid()}-${this.bodyName()}`;
  }

  protected onHeaderKeydown(event: KeyboardEvent): void {
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveUp.emit();
    } else if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveDown.emit();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.toggleCollapsed();
    }
  }

  protected onDragStart(event: DragEvent): void {
    event.dataTransfer?.setData('text/plain', String(this.index()));
    const pageUuid = this.pageUuid();
    if (pageUuid) {
      const payload = {
        pageUuid,
        bodyName: this.bodyName(),
        instanceId: this.section().instanceId,
        templateRef: this.section().templateRef,
      };
      event.dataTransfer?.setData('application/x-sf-section', JSON.stringify(payload));
    }
    event.dataTransfer && (event.dataTransfer.effectAllowed = 'move');
    this.dragStarted.emit(this.index());
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.dataTransfer && (event.dataTransfer.dropEffect = 'move');
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dropOn.emit(this.index());
  }

  protected onDragEnd(): void {
    this.dragEnd.emit();
  }
}
