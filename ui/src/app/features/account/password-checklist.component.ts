import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import type { PasswordCheck, PasswordRuleState } from './password-rules.util';

const ICONS: Readonly<Record<PasswordRuleState, string>> = {
  idle: 'radio_button_unchecked',
  met: 'check_circle',
  unmet: 'cancel',
};

/**
 * The live password checklist (M35.16): plain-language rules that stay neutral while the field is empty, turn into a ✓
 * when met and a ✗ only after the person typed. The length limit is a separate line that shows only once it is
 * exceeded; it keeps its space, so the form does not jump, and is one polite live region so a screen reader hears it.
 */
@Component({
  selector: 'sf-password-checklist',
  standalone: true,
  imports: [SfIconComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './password-checklist.component.scss',
  template: `
    @if (check().rules.length > 0) {
      <ul class="rules" [attr.aria-label]="'auth.rules.label' | transloco">
        @for (rule of check().rules; track rule.id) {
          <li class="rule" [class]="'rule is-' + rule.state">
            <sf-icon class="rule__icon" [name]="icons[rule.state]" />
            <span class="rule__text">{{ 'auth.rules.' + rule.id | transloco: { min: rule.min } }}</span>
            <span class="sf-sr-only">— {{ 'auth.rules.state.' + rule.state | transloco }}</span>
          </li>
        }
      </ul>
      <p class="limit" role="status">
        @if (check().overLimit; as over) {
          <sf-icon class="limit__icon" name="error" />
          {{ (over.wide ? 'auth.rules.overWide' : 'auth.rules.over') | transloco: { count: over.characters, max: over.max } }}
        }
      </p>
    }
  `,
})
export class PasswordChecklistComponent {
  readonly check = input.required<PasswordCheck>();

  protected readonly icons = ICONS;
}
