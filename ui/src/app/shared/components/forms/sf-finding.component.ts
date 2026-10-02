import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SfIconComponent } from '../sf-icon.component';

/** How serious a finding is; `error` blocks, `warning` asks for a look, `info` and `hint` only tell. */
export type SfFindingLevel = 'hint' | 'info' | 'warning' | 'error';

/** One finding of a field (M35.17): a rule or a check says something about its value. */
export interface SfFinding {
  readonly level: SfFindingLevel;
  readonly message: string;
}

const ICONS: Readonly<Record<SfFindingLevel, string>> = {
  hint: 'lightbulb',
  info: 'info',
  warning: 'warning',
  error: 'error',
};

/**
 * An inline finding under a field (M35.17): an icon and a message in the colour of its level — hint (muted), info,
 * warning, error. The level is also said in words for assistive technology (`sf-sr-only`), so it never rests on colour
 * or the icon alone; an error is announced assertively (`role="alert"`), the others politely (`role="status"`).
 */
@Component({
  selector: 'sf-finding',
  standalone: true,
  imports: [SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sf-finding.component.scss',
  host: {
    class: 'sf-finding',
    '[class]': '"sf-finding sf-finding--" + level()',
    '[attr.role]': 'level() === "error" ? "alert" : "status"',
  },
  template: `
    <sf-icon class="sf-finding__icon" [name]="icon()" />
    <span><span class="sf-sr-only">{{ levelWord() }}: </span>{{ message() }}</span>
  `,
})
export class SfFindingComponent {
  readonly level = input<SfFindingLevel>('hint');
  readonly message = input.required<string>();
  /** The level in words for screen readers; defaults to English, pass a translated one. */
  readonly levelLabel = input<string | null>(null);

  protected readonly icon = computed(() => ICONS[this.level()]);
  protected readonly levelWord = computed(() => this.levelLabel() ?? this.level());
}
