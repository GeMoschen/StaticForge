import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { sfUniqueId } from '../forms/sf-field-context';
import { SfPopoverComponent, SfPopoverTriggerDirective } from '../popover/sf-popover.component';
import { SfButtonComponent } from '../sf-button.component';
import { SfIconComponent } from '../sf-icon.component';

export interface SfFilterOption {
  readonly value: string;
  /** Translated. */
  readonly label: string;
  /** Shown before the label (a type's icon). */
  readonly icon?: string;
}

/** One group of the popover: a title and the options that toggle on and off. */
export interface SfFilterGroup {
  /** Unique; names the group in `toggled`. */
  readonly id: string;
  /** Translated. */
  readonly label: string;
  readonly options: readonly SfFilterOption[];
}

/**
 * The filter control of list headers (M35.24, gate decision 209): one **Filters** button that opens a popover with a
 * group per filter and one toggle tag per option — click to turn it on or off, `aria-pressed` tells which are on. The
 * host owns the state: it passes what is `picked` per group and applies `toggled` and `cleared`.
 */
@Component({
  selector: 'sf-filter-popover',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfIconComponent, SfPopoverComponent, SfPopoverTriggerDirective, TranslocoPipe],
  templateUrl: './sf-filter-popover.component.html',
  styleUrl: './sf-filter-popover.component.scss',
})
export class SfFilterPopoverComponent {
  readonly groups = input.required<readonly SfFilterGroup[]>();
  /** The picked option values per group id. */
  readonly picked = input<Readonly<Record<string, readonly string[]>>>({});
  readonly toggled = output<{ readonly group: string; readonly value: string }>();
  /** "Clear filters" inside the popover (shown while anything is picked). */
  readonly cleared = output<void>();

  protected readonly idPrefix = `${sfUniqueId('sf-filter')}-`;
  protected readonly anyPicked = computed(() => Object.values(this.picked()).some((values) => values.length > 0));

  protected isPicked(group: string, value: string): boolean {
    return (this.picked()[group] ?? []).includes(value);
  }
}
