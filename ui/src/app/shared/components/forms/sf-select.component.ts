import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRender,
  computed,
  input,
  model,
  viewChild,
} from '@angular/core';
import { SfIconComponent } from '../sf-icon.component';
import { SfControlBase, provideSfControl } from './sf-control';

export interface SfSelectOption<T> {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
}

/**
 * A native `<select>` (M35.6) with a chevron, for short fixed lists (use `sf-combobox` for long or searchable ones).
 * Option values may be of any type: the `<option>`s carry their index, and the value is matched with `compareWith`
 * (`Object.is` by default).
 *
 * The select never *shows* an option the model didn't choose: when the value is `null` or matches no option, an empty
 * option (the `placeholder`, or a hidden blank one) is rendered and selected, so what you see is what the form holds.
 * With a `placeholder` and not `required`, picking the placeholder sets the value back to `null`.
 */
@Component({
  selector: 'sf-select',
  standalone: true,
  imports: [SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sf-select.component.scss',
  providers: [provideSfControl(() => SfSelectComponent)],
  template: `
    <div class="sf-select">
      <select
        #select
        class="sf-select__control"
        [id]="controlId()"
        [disabled]="isDisabled()"
        [required]="isRequired()"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-labelledby]="ariaLabelledBy()"
        [attr.aria-describedby]="describedBy()"
        [attr.aria-invalid]="isInvalid() || null"
        [attr.aria-required]="isRequired() || null"
        [attr.aria-readonly]="readonly() || null"
        [class.is-readonly]="readonly()"
        (change)="onPick($event)"
        (keydown)="onKeydown($event)"
        (mousedown)="onMousedown($event)"
        (blur)="markTouched()"
      >
        @if (hasEmptyOption()) {
          <option
            value=""
            [selected]="selectedIndex() < 0"
            [hidden]="!placeholder()"
            [disabled]="!placeholder() || isRequired()"
          >
            {{ placeholder() ?? '' }}
          </option>
        }
        @for (option of options(); track $index) {
          <option [value]="$index" [selected]="$index === selectedIndex()" [disabled]="option.disabled ?? false">
            {{ option.label }}
          </option>
        }
      </select>
      <sf-icon class="sf-select__chevron" name="expand_more" />
    </div>
  `,
})
export class SfSelectComponent<T = unknown> extends SfControlBase<T | null> {
  readonly value = model<T | null>(null);
  readonly options = input<readonly SfSelectOption<T>[]>([]);
  /** The text of the empty option shown while nothing is chosen. */
  readonly placeholder = input<string | null>(null);
  /** Matches the value against option values. */
  readonly compareWith = input<(a: T | null, b: T | null) => boolean>(Object.is);

  private readonly select = viewChild.required<ElementRef<HTMLSelectElement>>('select');

  /** The index of the chosen option, `-1` when the value matches none. */
  protected readonly selectedIndex = computed(() => {
    const value = this.value();
    const compare = this.compareWith();
    return this.options().findIndex((option) => compare(option.value, value));
  });
  protected readonly hasEmptyOption = computed(() => this.selectedIndex() < 0 || !!this.placeholder());
  /** The `<option>` the select must show: the empty one (first) when nothing matches. */
  private readonly domIndex = computed(() =>
    this.selectedIndex() < 0 ? 0 : this.selectedIndex() + (this.hasEmptyOption() ? 1 : 0),
  );

  constructor() {
    super();
    // Safety net: whatever the browser did with the options (re-rendered, reordered), the displayed option is the
    // model's. The `[selected]` bindings handle the normal case.
    afterRender({
      write: () => {
        const select = this.select().nativeElement;
        if (select.selectedIndex !== this.domIndex()) {
          select.selectedIndex = this.domIndex();
        }
      },
    });
  }

  focus(): void {
    this.select().nativeElement.focus();
  }

  protected writeModel(value: T | null | undefined): void {
    this.value.set(value ?? null);
  }

  protected onPick(event: Event): void {
    const select = event.target as HTMLSelectElement;
    if (this.readonly()) {
      select.selectedIndex = this.domIndex();
      return;
    }
    const raw = select.value;
    const value = raw === '' ? null : (this.options()[Number(raw)]?.value ?? null);
    this.value.set(value);
    this.emitChange(value);
  }

  /** A native select has no read-only state: keep the keys that would change it from doing so. */
  protected onKeydown(event: KeyboardEvent): void {
    if (this.readonly() && event.key !== 'Tab' && event.key !== 'Escape') {
      event.preventDefault();
    }
  }

  protected onMousedown(event: MouseEvent): void {
    if (this.readonly()) {
      event.preventDefault();
      this.select().nativeElement.focus();
    }
  }
}
