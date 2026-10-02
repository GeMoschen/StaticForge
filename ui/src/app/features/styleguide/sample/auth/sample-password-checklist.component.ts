import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { injectSampleText } from '../changes/sample-area.util';
import { PASSWORD_MAX, PASSWORD_MIN, PasswordCheck, PasswordRuleState } from './auth-password.util';

const ICONS: Readonly<Record<PasswordRuleState, string>> = {
  idle: 'radio_button_unchecked',
  met: 'check_circle',
  unmet: 'cancel',
};

/**
 * The live password checklist (M35.16): plain-language rules that stay neutral while the field is empty, turn into a
 * ✓ when met and a ✗ only after the person typed. The length limit is a separate line, in characters, that shows only
 * once it is exceeded. One polite live region, so a screen reader hears the limit message when it appears.
 */
@Component({
  selector: 'sf-sample-password-checklist',
  standalone: true,
  imports: [SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-password-checklist.component.scss',
  template: `
    <ul class="rules" [attr.aria-label]="t('rules.label')">
      @for (rule of check().rules; track rule.id) {
        <li class="rule" [class]="'rule is-' + rule.state">
          <sf-icon class="rule__icon" [name]="icons[rule.state]" />
          <span class="rule__text">{{ t('rules.' + rule.id, { min: min }) }}</span>
          <span class="sf-sr-only">— {{ t('rules.state.' + rule.state) }}</span>
        </li>
      }
    </ul>
    <p class="limit" role="status">
      @if (check().overLimit; as count) {
        <sf-icon class="limit__icon" name="error" />
        {{ t('rules.over', { count, max }) }}
      }
    </p>
  `,
})
export class SamplePasswordChecklistComponent {
  readonly check = input.required<PasswordCheck>();

  protected readonly t = injectSampleText('styleguide.sample.auth');
  protected readonly icons = ICONS;
  protected readonly min = PASSWORD_MIN;
  protected readonly max = PASSWORD_MAX;
}
