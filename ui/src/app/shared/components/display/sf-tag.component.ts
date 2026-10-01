import { ChangeDetectionStrategy, Component, ElementRef, booleanAttribute, input, output, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfTooltipDirective } from '../../directives/sf-tooltip.directive';
import { SfIconComponent } from '../sf-icon.component';

export type SfTagTone = 'neutral' | 'accent';

/**
 * A chip (M35.6): a `label` with an optional leading `icon`, in a `neutral` or `accent` tone.
 *
 * `removable` adds an icon-only remove button named "Remove {label}" (`shared.tag.remove`); clicking it — or pressing
 * `Backspace`/`Delete` while it has focus — emits `removed`. The host removes the tag; `sf-combobox` uses it for the
 * values of a multi-select.
 */
@Component({
  selector: 'sf-tag',
  standalone: true,
  imports: [SfIconComponent, SfTooltipDirective, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="sf-tag" [class.sf-tag--accent]="tone() === 'accent'" [class.sf-tag--removable]="removable()">
      @if (icon()) {
        <sf-icon class="sf-tag__icon" [name]="icon()!" />
      }
      <span class="sf-tag__label">{{ label() }}</span>
      @if (removable()) {
        @let removeLabel = 'shared.tag.remove' | transloco: { label: label() };
        <button
          #remove
          type="button"
          class="sf-tag__remove"
          [disabled]="disabled()"
          [attr.aria-label]="removeLabel"
          [sfTooltip]="removeLabel"
          [sfTooltipDescribes]="false"
          (click)="removed.emit()"
          (keydown)="onRemoveKeydown($event)"
        >
          <sf-icon name="close" />
        </button>
      }
    </span>
  `,
  styleUrl: './sf-tag.component.scss',
})
export class SfTagComponent {
  readonly label = input.required<string>();
  readonly icon = input<string | null>(null);
  readonly tone = input<SfTagTone>('neutral');
  readonly removable = input(false, { transform: booleanAttribute });
  /** Disables the remove button. */
  readonly disabled = input(false, { transform: booleanAttribute });

  readonly removed = output<void>();

  private readonly removeButton = viewChild<ElementRef<HTMLButtonElement>>('remove');

  /** Focuses the remove button (keyboard navigation between chips). */
  focus(): void {
    this.removeButton()?.nativeElement.focus();
  }

  protected onRemoveKeydown(event: KeyboardEvent): void {
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      this.removed.emit();
    }
  }
}
