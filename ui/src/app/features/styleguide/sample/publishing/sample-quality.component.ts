import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../../shared/components/forms/sf-segmented.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import {
  LAST_FINISHED_RUN,
  QUALITY_CATEGORIES,
  QUALITY_LEVELS,
  QUALITY_RULES,
  QualityLevel,
  QualityRule,
  findingCounts,
} from './publishing-data';
import { PublishingState } from './publishing-state';
import { LEVEL_ICONS } from './publishing-status';

/**
 * Publishing › Quality: a summary first (rules on and off, how many hold pages back, the last run's results), then
 * the rules grouped by category with the Off / Warning / Error segmented control. The long explanations are a
 * one-line hint with the full text in a tooltip. Changes apply at once here (a prototype: nothing is saved).
 */
@Component({
  selector: 'sf-sample-quality',
  standalone: true,
  imports: [SfBadgeComponent, SfButtonComponent, SfIconComponent, SfSegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-quality.component.html',
  styleUrl: './sample-quality.component.scss',
})
export class SampleQualityComponent {
  protected readonly state = inject(PublishingState);
  protected readonly t = this.state.t;
  protected readonly last = LAST_FINISHED_RUN;
  protected readonly lastCounts = findingCounts(LAST_FINISHED_RUN);

  /** Level per rule code. */
  protected readonly levels = signal<Readonly<Record<string, QualityLevel>>>(
    Object.fromEntries(QUALITY_RULES.map((r) => [r.code, r.level])),
  );

  protected readonly summary = computed(() => {
    const levels = Object.values(this.levels());
    return {
      on: levels.filter((l) => l !== 'off').length,
      off: levels.filter((l) => l === 'off').length,
      errors: levels.filter((l) => l === 'error').length,
    };
  });

  protected readonly groups = computed(() =>
    QUALITY_CATEGORIES.map((category) => {
      const rules = QUALITY_RULES.filter((r) => r.category === category);
      return { category, rules, on: rules.filter((r) => this.levels()[r.code] !== 'off').length };
    }),
  );

  protected options(rule: QualityRule): SfSegmentedOption<QualityLevel>[] {
    return QUALITY_LEVELS.map((level) => ({
      value: level,
      label: this.t(`quality.levels.${level}`),
      icon: LEVEL_ICONS[level],
      disabled: rule.max === 'warning' && level === 'error',
    }));
  }

  protected setLevel(code: string, level: QualityLevel | null): void {
    if (level) {
      this.levels.update((all) => ({ ...all, [code]: level }));
    }
  }
}
