import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, computed, inject, input, model } from '@angular/core';
import { SfTooltipDirective } from '../../directives/sf-tooltip.directive';
import { SfIconComponent } from '../sf-icon.component';
import { SfControlBase, provideSfControl } from './sf-control';

export interface SfSegmentedOption<T> {
  value: T;
  label: string;
  icon?: string;
  /** Shows only the icon; the label becomes the segment's `aria-label` and tooltip. */
  iconOnly?: boolean;
  disabled?: boolean;
}

/**
 * A segmented control (M35.6): a single choice among a few options, shown as joined buttons — a `role=radiogroup` of
 * `role=radio` buttons with a roving tabindex (only the checked segment, or the first enabled one when none is, is in
 * the tab order).
 *
 * Keyboard (WAI-ARIA radio group): `←`/`↑` and `→`/`↓` move to the previous/next enabled segment and select it
 * (wrapping), `Home`/`End` the first/last; `Space`/`Enter` select the focused one. Read-only moves without selecting.
 *
 * The group is labelled like `sf-radio-group` (field label, `aria-label` or `aria-labelledby`).
 *
 * - Value: `T | null`; options are matched with `compareWith` (default `Object.is`).
 * - `size`: `sm | md` (heights follow the density).
 */
@Component({
  selector: 'sf-segmented',
  standalone: true,
  imports: [SfIconComponent, SfTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [provideSfControl(() => SfSegmentedComponent)],
  template: `
    <div
      role="radiogroup"
      class="sf-segmented"
      [class.sf-segmented--sm]="size() === 'sm'"
      [class.is-readonly]="readonly()"
      [class.is-invalid]="isInvalid()"
      [id]="controlId()"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-labelledby]="groupLabelledBy()"
      [attr.aria-describedby]="describedBy()"
      [attr.aria-invalid]="isInvalid() || null"
      [attr.aria-required]="isRequired() || null"
      [attr.aria-readonly]="readonly() || null"
      [attr.aria-disabled]="isDisabled() || null"
      (keydown)="onKeydown($event)"
    >
      @for (option of options(); track $index; let i = $index) {
        <button
          type="button"
          role="radio"
          class="sf-segmented__item"
          [class.sf-segmented__item--icon-only]="option.iconOnly && option.icon"
          [attr.aria-checked]="i === checkedIndex()"
          [attr.tabindex]="i === tabStop() ? 0 : -1"
          [disabled]="isDisabled() || !!option.disabled"
          [attr.aria-label]="option.iconOnly && option.icon ? option.label : null"
          [sfTooltip]="option.iconOnly && option.icon ? option.label : null"
          [sfTooltipDescribes]="false"
          (click)="select(i)"
          (blur)="markTouched()"
        >
          @if (option.icon) {
            <sf-icon class="sf-segmented__icon" [name]="option.icon" />
          }
          @if (!(option.iconOnly && option.icon)) {
            <span class="sf-segmented__label">{{ option.label }}</span>
          }
        </button>
      }
    </div>
  `,
  styleUrl: './sf-segmented.component.scss',
})
export class SfSegmentedComponent<T = unknown> extends SfControlBase<T | null> {
  readonly options = input<readonly SfSegmentedOption<T>[]>([]);
  readonly size = input<'sm' | 'md'>('md');
  readonly compareWith = input<(a: T, b: T) => boolean>(Object.is);
  readonly value = model<T | null>(null);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly changeDetector = inject(ChangeDetectorRef);

  protected readonly checkedIndex = computed(() => {
    const value = this.value();
    const compare = this.compareWith();
    return value === null ? -1 : this.options().findIndex((option) => compare(option.value, value));
  });

  /** The one segment in the tab order: the checked one if it can take focus, else the first enabled one. */
  protected readonly tabStop = computed(() => {
    const checked = this.checkedIndex();
    if (checked >= 0 && this.isEnabled(checked)) {
      return checked;
    }
    return this.options().findIndex((_, index) => this.isEnabled(index));
  });

  constructor() {
    super('group');
  }

  protected writeModel(value: T | null | undefined): void {
    this.value.set(value ?? null);
  }

  protected select(index: number): void {
    const option = this.options()[index];
    if (!option || !this.isEnabled(index) || this.readonly() || index === this.checkedIndex()) {
      return;
    }
    this.value.set(option.value);
    this.emitChange(option.value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const buttons = this.buttons();
    const from = buttons.indexOf(event.target as HTMLButtonElement);
    if (from < 0) {
      return;
    }
    let target: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        target = this.nextEnabled(from, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        target = this.nextEnabled(from, -1);
        break;
      case 'Home':
        target = this.nextEnabled(-1, 1);
        break;
      case 'End':
        target = this.nextEnabled(this.options().length, -1);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (target < 0) {
      return;
    }
    this.select(target);
    // Render the new tab stop before moving focus, so the focused segment is the tabbable one.
    this.changeDetector.detectChanges();
    buttons[target]?.focus();
  }

  private isEnabled(index: number): boolean {
    return !this.isDisabled() && !this.options()[index]?.disabled;
  }

  /** The next enabled index from `from` in `step` direction, wrapping; -1 when none is enabled. */
  private nextEnabled(from: number, step: 1 | -1): number {
    const count = this.options().length;
    for (let offset = 1; offset <= count; offset++) {
      const index = (((from + step * offset) % count) + count) % count;
      if (this.isEnabled(index)) {
        return index;
      }
    }
    return -1;
  }

  private buttons(): HTMLButtonElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  }
}
