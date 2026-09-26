import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { components } from '../../core/api/generated/schema.d.ts';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { formatInstant } from '../schedules/zoned-time.util';
import {
  type ReleaseBlock,
  scheduledFor,
  scheduledTypeLabel,
  statusFor,
  statusIcon,
  statusLabel,
  statusSummary,
  statusTone,
} from './release-status.util';

type ScheduledRefView = components['schemas']['ScheduledRefView'];

/**
 * The release status of an asset for the editing locale (M27.6.1): icon and text (compact: icon only, with the text
 * for screen readers), never colour alone (§24.7), plus a clock when a schedule touches it. The tooltip lists every
 * locale ("DE published · EN changed"). Renders nothing for an asset without a release state.
 */
@Component({
  selector: 'sf-release-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfIconComponent],
  template: `
    @if (status(); as s) {
      <span
        class="badge"
        [class]="'badge badge--' + tone()"
        [class.badge--compact]="compact()"
        [attr.title]="tooltip()"
        role="img"
        [attr.aria-label]="ariaLabel()"
      >
        <sf-icon class="badge__icon" [name]="icon()" />
        @if (!compact()) {
          <span class="badge__text" aria-hidden="true">{{ label() }}</span>
        }
        @if (schedules().length > 0) {
          <sf-icon class="badge__clock" name="schedule" />
        }
      </span>
    }
  `,
  styleUrl: './release-badge.component.scss',
})
export class ReleaseBadgeComponent {
  private readonly editingLocale = inject(EditingLocaleStore);

  readonly release = input<ReleaseBlock>(null);
  readonly scheduled = input<ScheduledRefView[] | null | undefined>(null);
  /** Icon only — for tree rows; the full text stays in the accessible name and the tooltip. */
  readonly compact = input(false);
  /** Shows this locale instead of the editing locale (the Changes view's rows). */
  readonly locale = input<string | null | undefined>(undefined);

  private readonly shownLocale = computed(() => (this.locale() !== undefined ? this.locale() : this.editingLocale.locale()));

  protected readonly status = computed(() => statusFor(this.release(), this.shownLocale()));
  protected readonly label = computed(() => statusLabel(this.status()));
  protected readonly icon = computed(() => statusIcon(this.status()));
  protected readonly tone = computed(() => statusTone(this.status()));
  protected readonly schedules = computed(() => scheduledFor(this.scheduled(), this.shownLocale()));

  private readonly scheduleText = computed(() =>
    this.schedules()
      .map((ref) => `${scheduledTypeLabel(ref.type)} scheduled for ${formatInstant(ref.nextRunAt ?? ref.runAt)}`)
      .join('; '),
  );

  protected readonly tooltip = computed(() => [statusSummary(this.release()), this.scheduleText()].filter(Boolean).join(' — '));

  protected readonly ariaLabel = computed(() => {
    const scheduled = this.schedules().length > 0 ? ', scheduled' : '';
    return `Status: ${this.label()}${scheduled}`;
  });
}
