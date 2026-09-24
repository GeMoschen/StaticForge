import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { passwordRuleChecks } from './password-rules.util';

type PasswordPolicyView = components['schemas']['PasswordPolicyView'];

/** The password policy as live checks against what is typed (M26). */
@Component({
  selector: 'sf-password-rules',
  standalone: true,
  imports: [SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="rules" aria-label="Password rules">
      @for (check of checks(); track check.label) {
        <li class="rules__item" [class.rules__item--met]="check.met">
          <sf-icon [name]="check.met ? 'check_circle' : 'radio_button_unchecked'" />
          <span>{{ check.label }}</span>
          <span class="sf-sr-only">{{ check.met ? '(met)' : '(not met)' }}</span>
        </li>
      }
    </ul>
  `,
  styles: `
    .rules {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: var(--sf-1);
      font-size: var(--sf-text-xs);
      color: var(--sf-slate);
    }
    .rules__item {
      display: inline-flex;
      align-items: center;
      gap: var(--sf-1);
    }
    .rules__item--met {
      color: var(--sf-jade);
    }
  `,
})
export class PasswordRulesComponent {
  readonly policy = input<PasswordPolicyView | null>(null);
  readonly password = input('');

  protected readonly checks = computed(() => passwordRuleChecks(this.policy(), this.password()));
}
