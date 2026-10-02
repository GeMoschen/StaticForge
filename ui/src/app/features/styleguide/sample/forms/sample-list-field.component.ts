import { booleanAttribute, ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, input, model, signal } from '@angular/core';
import { Injector } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToastService } from '../../../../core/ui/toast.service';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { injectSampleText } from '../changes/sample-area.util';
import { moveItem } from './forms-util';

/**
 * The list editor (M35.17 sample): rows of one text value each, with **add**, **remove (with an Undo toast)** and
 * **reorder** by dragging the handle or with **Alt+↑ / Alt+↓** on it (the handle keeps the focus, and the move is
 * announced). A running count and an empty state; read-only shows the rows without controls.
 */
@Component({
  selector: 'sf-sample-list-field',
  standalone: true,
  imports: [SfButtonComponent, SfIconComponent, SfInputComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-list-field.component.scss',
  template: `
    <ul class="list" [attr.aria-label]="label()">
      @for (item of items(); track $index; let i = $index) {
        <li
          class="list__row"
          [class.is-dragging]="dragFrom() === i"
          [class.is-over]="overAt() === i && dragFrom() !== i"
          (dragover)="onDragOver($event, i)"
          (drop)="onDrop($event, i)"
        >
          @if (!readonly()) {
            <button
              type="button"
              class="list__handle"
              draggable="true"
              [attr.data-handle]="i"
              [attr.aria-label]="'styleguide.sample.forms.list.handle' | transloco: { n: i + 1 }"
              [attr.aria-describedby]="idBase + '-help'"
              (dragstart)="dragFrom.set(i)"
              (dragend)="endDrag()"
              (keydown)="onHandleKeydown($event, i)"
            >
              <sf-icon name="drag_indicator" />
            </button>
          }
          <span class="list__index" aria-hidden="true">{{ i + 1 }}</span>
          <sf-input
            class="list__input"
            [readonly]="readonly()"
            [aria-label]="'styleguide.sample.forms.list.item' | transloco: { n: i + 1 }"
            [value]="item"
            (valueChange)="setItem(i, $event)"
          />
          @if (!readonly()) {
            <sf-button variant="ghost" size="sm" icon="delete" [label]="'styleguide.sample.forms.list.remove' | transloco: { n: i + 1 }" (click)="remove(i)" />
          }
        </li>
      } @empty {
        <li class="list__empty">{{ 'styleguide.sample.forms.list.empty' | transloco }}</li>
      }
    </ul>
    @if (!readonly()) {
      <div class="list__footer">
        <sf-button variant="secondary" size="sm" icon="add" (click)="add()">{{ 'styleguide.sample.forms.list.add' | transloco }}</sf-button>
        <span class="list__count">{{ 'styleguide.sample.forms.list.count' | transloco: { count: items().length } }}</span>
      </div>
      <span class="sf-sr-only" [id]="idBase + '-help'">{{ 'styleguide.sample.forms.list.help' | transloco }}</span>
    }
    <span class="sf-sr-only" aria-live="polite">{{ announcement() }}</span>
  `,
})
export class SampleListFieldComponent {
  readonly items = model<readonly string[]>([]);
  readonly readonly = input(false, { transform: booleanAttribute });
  readonly label = input<string>('');

  private readonly toasts = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly t = injectSampleText('styleguide.sample.forms');

  protected readonly idBase = `sample-list-${Math.random().toString(36).slice(2, 8)}`;
  protected readonly dragFrom = signal<number | null>(null);
  protected readonly overAt = signal<number | null>(null);
  protected readonly announcement = signal('');

  protected setItem(index: number, value: string): void {
    this.items.update((list) => list.map((item, i) => (i === index ? value : item)));
  }

  protected add(): void {
    this.items.update((list) => [...list, '']);
    this.focusInput(this.items().length - 1);
  }

  /** Removes a row and offers Undo, which puts it back where it was. */
  protected remove(index: number): void {
    const before = this.items();
    const removed = before[index];
    this.items.set(before.filter((_, i) => i !== index));
    this.toasts.undo(this.t('list.removed', { n: index + 1 }), () => {
      const now = [...this.items()];
      now.splice(index, 0, removed);
      this.items.set(now);
    });
  }

  protected onHandleKeydown(event: KeyboardEvent, index: number): void {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) {
      return;
    }
    event.preventDefault();
    const to = index + (event.key === 'ArrowUp' ? -1 : 1);
    const next = moveItem(this.items(), index, to);
    if (next !== this.items()) {
      this.items.set(next);
      this.announcement.set(this.t('list.moved', { n: to + 1, count: next.length }));
      afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-handle="${to}"]`)?.focus(), { injector: this.injector });
    }
  }

  protected onDragOver(event: DragEvent, index: number): void {
    if (this.dragFrom() !== null) {
      event.preventDefault();
      this.overAt.set(index);
    }
  }

  protected onDrop(event: DragEvent, index: number): void {
    event.preventDefault();
    const from = this.dragFrom();
    if (from !== null) {
      this.items.set(moveItem(this.items(), from, index));
    }
    this.endDrag();
  }

  protected endDrag(): void {
    this.dragFrom.set(null);
    this.overAt.set(null);
  }

  private focusInput(index: number): void {
    afterNextRender(() => this.host.nativeElement.querySelectorAll<HTMLInputElement>('.list__input input')[index]?.focus(), { injector: this.injector });
  }
}
