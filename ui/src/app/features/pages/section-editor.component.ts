import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
  /** The language being edited (M24.4.1); `null` in a project without languages. */
  protected readonly editingLocale = inject(EditingLocaleStore).binding;

  private readonly localesForLabels = inject(LocalesStore);

  /** Language tag to label, so the form says "from Deutsch" rather than "from de". */
  protected readonly localeLabels = computed<Record<string, string>>(() =>
    Object.fromEntries(
      this.localesForLabels.locales().map((locale) => [locale.code ?? '', locale.label ?? locale.code ?? '']),
    ),
  );


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
  /**
   * The page's content findings (`PageView.issues`, M30.3.2); the form shows the ones under this section
   * (`bodies.<body>[<index>].content.…`) at their fields.
   */
  readonly issues = input<ReadonlyArray<{ path?: string; message?: string }>>([]);

  /** Where this section's fields sit in the page's content, as the findings' paths spell it. */
  protected readonly issuePrefix = computed(() => `bodies.${this.bodyName()}[${this.index()}].content`);

  readonly valueChange = output<Record<string, unknown>>();
  readonly remove = output<void>();
  readonly moveUp = output<void>();
  readonly moveDown = output<void>();
  readonly dragStarted = output<number>();
  readonly dropOn = output<number>();
  readonly dragEnd = output<void>();

  /**
   * The content object as stored — every language, not just the one being edited. The form binds
   * one language; the fallback hint needs the others (M24.4.1).
   */
  protected readonly storedContent = computed<Record<string, unknown>>(
    () => (this.section().content ?? {}) as Record<string, unknown>,
  );

  protected readonly collapsed = signal(false);
  /**
   * A `computed`, not a signal rebuilt by a side-effect: the effect this replaced rebuilt
   * `fieldForm` asynchronously after `contentDefinition` changed reference (e.g.
   * `page-editor.component.ts` filling in a section template's compiled definition once it
   * loads), which left one render where the template already saw the new `[definition]` but
   * the old, pre-load form group — `SfContentFormComponent.controlFor()` would look up a
   * control by a name the stale group never got, returning `null` and crashing editors that
   * dereference `control()` (e.g. `SfBooleanEditor`). A computed re-derives synchronously
   * within the same read, so `definition` and `formGroup` are never out of step.
   */
  protected readonly fieldForm = computed<FormGroup>(() => {
    const definition = this.contentDefinition();
    const section = this.section();
    const content = (section.content ?? {}) as Record<string, unknown>;
    const form = this.fb.build(definition, content, this.editingLocale());
    if (this.readOnly()) {
      form.disable();
    }
    return form;
  });

  private valueSub: { unsubscribe(): void } | null = null;
  /** Guards the collapse-state effect below so it only re-reads localStorage when it starts editing a *different* section — an `@if`-scoped (as opposed to `@for`-tracked) host reuses the same component instance across navigations between sections, and re-syncing on every `section` reference change (e.g. after this same section's own autosave round-trip) would otherwise clobber the in-progress collapsed state. */
  private lastInstanceId: string | null = null;

  constructor() {
    effect(
      (onCleanup) => {
        const form = this.fieldForm();
        const definition = this.contentDefinition();
        const sub = form.valueChanges.subscribe(() => {
          this.valueChange.emit(this.fb.valueOf(definition, form));
        });
        this.valueSub = sub;
        onCleanup(() => sub.unsubscribe());
      },
    );

    effect(
      () => {
        const section = this.section();
        if (section.instanceId === this.lastInstanceId) {
          return;
        }
        this.lastInstanceId = section.instanceId;
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
