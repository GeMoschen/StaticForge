import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  booleanAttribute,
  inject,
  input,
  model,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfButtonComponent } from '../sf-button.component';
import { SfIconComponent } from '../sf-icon.component';
import { SfControlBase, provideSfControl } from './sf-control';

/** Targets where `/` is typed text, not the search shortcut. */
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/**
 * A search box (M35.6): `role=searchbox` with a leading search icon and a clear button while it holds text (clearing
 * refocuses the input); `Escape` clears it too — and only then is swallowed, so an empty box lets `Escape` close the
 * surrounding dialog or panel.
 *
 * With `focusShortcut`, `/` anywhere on the page focuses it (announced through `aria-keyshortcuts`, hinted by a `/`
 * badge) — unless the key goes to something editable or comes with Ctrl/Alt/Meta. Use it for one search per screen.
 */
@Component({
  selector: 'sf-search-input',
  standalone: true,
  imports: [SfButtonComponent, SfIconComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sf-search-input.component.scss',
  providers: [provideSfControl(() => SfSearchInputComponent)],
  host: {
    '(document:keydown)': 'onDocumentKeydown($event)',
  },
  template: `
    <div
      class="sf-search-input"
      [class.is-invalid]="isInvalid()"
      [class.is-readonly]="readonly()"
      [class.is-disabled]="isDisabled()"
    >
      <sf-icon class="sf-search-input__icon" name="search" />
      <input
        #input
        class="sf-search-input__control"
        type="search"
        role="searchbox"
        autocomplete="off"
        [id]="controlId()"
        [value]="value()"
        [attr.placeholder]="placeholder() ?? ('shared.search.placeholder' | transloco)"
        [attr.aria-keyshortcuts]="focusShortcut() ? '/' : null"
        [readOnly]="readonly()"
        [disabled]="isDisabled()"
        [required]="isRequired()"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-labelledby]="ariaLabelledBy()"
        [attr.aria-describedby]="describedBy()"
        [attr.aria-invalid]="isInvalid() || null"
        [attr.aria-required]="isRequired() || null"
        (input)="onInput($event)"
        (keydown.escape)="onEscape($event)"
        (blur)="markTouched()"
      />
      @if (value() && !readonly() && !isDisabled()) {
        <sf-button
          class="sf-search-input__clear"
          variant="ghost"
          size="sm"
          icon="close"
          [label]="'shared.search.clear' | transloco"
          (click)="clear()"
        />
      } @else if (focusShortcut() && !value()) {
        <span class="sf-search-input__hint" aria-hidden="true">/</span>
      }
    </div>
  `,
})
export class SfSearchInputComponent extends SfControlBase<string> {
  readonly value = model<string>('');
  /** Defaults to "Search…". */
  readonly placeholder = input<string | null>(null);
  /** `/` anywhere on the page focuses this box. */
  readonly focusShortcut = input(false, { transform: booleanAttribute });

  private readonly inputEl = viewChild.required<ElementRef<HTMLInputElement>>('input');
  private readonly changeDetector = inject(ChangeDetectorRef);

  constructor() {
    super();
  }

  focus(): void {
    this.inputEl().nativeElement.focus();
  }

  /** Empties the box (as the user would) and puts the focus back into it. */
  clear(): void {
    this.update('');
    // Render now so the input is the focus target before the clear button disappears.
    this.changeDetector.detectChanges();
    this.focus();
  }

  protected writeModel(value: string | null | undefined): void {
    this.value.set(value ?? '');
  }

  protected onInput(event: Event): void {
    this.update((event.target as HTMLInputElement).value);
  }

  protected onEscape(event: Event): void {
    if (this.value() && !this.readonly()) {
      event.preventDefault();
      event.stopPropagation();
      this.clear();
    }
  }

  protected onDocumentKeydown(event: KeyboardEvent): void {
    if (
      !this.focusShortcut() ||
      event.key !== '/' ||
      event.defaultPrevented ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      this.isDisabled() ||
      (event.target instanceof Element && event.target.closest(EDITABLE))
    ) {
      return;
    }
    event.preventDefault();
    this.focus();
  }

  private update(value: string): void {
    this.value.set(value);
    this.emitChange(value);
  }
}
