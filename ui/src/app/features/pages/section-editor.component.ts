import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormGroup } from '@angular/forms';
import {
  ContentDefinition,
  FormBuilderService,
  SfContentFormComponent,
} from '../forms';
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
  imports: [SfContentFormComponent],
  templateUrl: './section-editor.component.html',
  styleUrl: './section-editor.component.scss',
})
export class SectionEditorComponent implements OnInit {
  private readonly fb = inject(FormBuilderService);

  readonly contentDefinition = input.required<ContentDefinition>();
  readonly section = input.required<SectionInstance>();
  readonly projectKey = input<string>();
  readonly bodyName = input.required<string>();
  readonly templateUid = input.required<string>();
  readonly title = input<string>('');
  readonly index = input.required<number>();
  readonly count = input.required<number>();
  readonly readOnly = input(false);

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

  ngOnInit(): void {
    const content = (this.section().content ?? {}) as Record<string, unknown>;
    const form = this.fb.build(this.contentDefinition(), content);
    if (this.readOnly()) {
      form.disable();
    }
    this.fieldForm.set(form);
    this.valueSub = form.valueChanges.subscribe(() => {
      this.valueChange.emit(
        this.fb.valueOf(this.contentDefinition(), form),
      );
    });

    const key = this.collapseKey();
    this.collapsed.set(localStorage.getItem(key) === '1');
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
