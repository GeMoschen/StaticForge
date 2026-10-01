import { Directive, ElementRef, booleanAttribute, inject, input, numberAttribute, output } from '@angular/core';

/**
 * A resize handle (M35.8): the WAI-ARIA window-splitter `separator`, shared by `sf-splitter` and the drawer edge. It
 * owns the interaction, the host owns the size:
 *
 * - **Keyboard** (it is a tab stop): the arrow keys along its axis move by `step` (`Shift`: `largeStep`), `Home` / `End`
 *   go to `min` / `max`, `Enter` asks to collapse or restore (`collapseToggle`).
 * - **Pointer**: drag; **double click** resets to `defaultSize`.
 * - `aria-orientation`, `aria-valuenow/min/max` follow the inputs.
 *
 * `orientation` is the separator's own: `vertical` (a bar between side-by-side panes, moved with ←/→) or `horizontal`
 * (between stacked panes, ↑/↓). The size grows to the right / downwards; `invert` flips that, for a pane that sits after
 * the handle (a drawer on the right edge grows to the left).
 */
@Directive({
  selector: '[sfSeparator]',
  standalone: true,
  host: {
    role: 'separator',
    tabindex: '0',
    '[attr.aria-orientation]': 'orientation()',
    '[attr.aria-valuenow]': 'roundedSize()',
    '[attr.aria-valuemin]': 'min()',
    '[attr.aria-valuemax]': 'max()',
    '(keydown)': 'onKeydown($event)',
    '(pointerdown)': 'onPointerDown($event)',
    '(dblclick)': 'onDoubleClick()',
  },
})
export class SfSeparatorDirective {
  readonly orientation = input<'vertical' | 'horizontal'>('vertical', { alias: 'sfSeparator' });
  /** The current size of the pane this handle resizes, px. */
  readonly size = input.required<number, unknown>({ alias: 'sfSeparatorSize', transform: numberAttribute });
  readonly min = input(0, { alias: 'sfSeparatorMin', transform: numberAttribute });
  readonly max = input(Number.MAX_SAFE_INTEGER, { alias: 'sfSeparatorMax', transform: numberAttribute });
  readonly step = input(16, { alias: 'sfSeparatorStep', transform: numberAttribute });
  readonly largeStep = input(64, { alias: 'sfSeparatorLargeStep', transform: numberAttribute });
  /** The size a double click restores; none when `null`. */
  readonly defaultSize = input<number | null>(null, { alias: 'sfSeparatorDefault' });
  readonly invert = input(false, { alias: 'sfSeparatorInvert', transform: booleanAttribute });

  /** A new size, already clamped to `min`..`max`. */
  readonly sizeChange = output<number>({ alias: 'sfSeparatorSizeChange' });
  /** `Enter`: collapse or restore the pane. */
  readonly collapseToggle = output<void>({ alias: 'sfSeparatorCollapse' });
  /** A pointer drag ended (hosts persist then). */
  readonly resizeEnd = output<void>({ alias: 'sfSeparatorResizeEnd' });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected roundedSize(): number {
    return Math.round(this.size());
  }

  protected onKeydown(event: KeyboardEvent): void {
    const vertical = this.orientation() === 'vertical';
    const grow = vertical ? 'ArrowRight' : 'ArrowDown';
    const shrink = vertical ? 'ArrowLeft' : 'ArrowUp';
    const step = event.shiftKey ? this.largeStep() : this.step();
    const sign = this.invert() ? -1 : 1;
    let next: number | null = null;
    switch (event.key) {
      case grow:
        next = this.size() + sign * step;
        break;
      case shrink:
        next = this.size() - sign * step;
        break;
      case 'Home':
        next = this.min();
        break;
      case 'End':
        next = this.max();
        break;
      case 'Enter':
        event.preventDefault();
        this.collapseToggle.emit();
        return;
      default:
        return;
    }
    event.preventDefault();
    this.sizeChange.emit(this.clamp(next));
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.button > 0) {
      return; // only the primary button (or touch/pen) drags
    }
    event.preventDefault();
    this.host.focus();
    const vertical = this.orientation() === 'vertical';
    const start = vertical ? event.clientX : event.clientY;
    const startSize = this.size();
    const sign = this.invert() ? -1 : 1;
    this.host.setPointerCapture?.(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const delta = (vertical ? moveEvent.clientX : moveEvent.clientY) - start;
      this.sizeChange.emit(this.clamp(startSize + sign * delta));
    };
    const end = () => {
      this.host.removeEventListener('pointermove', move);
      this.host.removeEventListener('pointerup', end);
      this.host.removeEventListener('pointercancel', end);
      this.resizeEnd.emit();
    };
    this.host.addEventListener('pointermove', move);
    this.host.addEventListener('pointerup', end);
    this.host.addEventListener('pointercancel', end);
  }

  protected onDoubleClick(): void {
    const reset = this.defaultSize();
    if (reset !== null) {
      this.sizeChange.emit(this.clamp(reset));
      this.resizeEnd.emit();
    }
  }

  private clamp(value: number): number {
    return Math.min(Math.max(value, this.min()), Math.max(this.min(), this.max()));
  }
}
