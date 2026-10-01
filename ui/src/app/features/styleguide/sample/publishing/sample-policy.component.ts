import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SfCheckboxComponent } from '../../../../shared/components/forms/sf-checkbox.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { POLICY, POLICY_ACTIONS, POLICY_ROLES, PolicyAction, PolicyGrid, PolicyRole } from './publishing-data';
import { PublishingState } from './publishing-state';

/** What an action needs first: scheduling needs releasing, full builds need incremental ones. */
const REQUIRES: Partial<Record<PolicyAction, PolicyAction>> = { schedule: 'release', full: 'incremental' };

/**
 * Publishing › Policy: who may release, schedule and build, per role, as a settings form with the save UX — a save
 * status, Save and Discard enabled only when something changed. Project admins can always do everything (fixed on).
 */
@Component({
  selector: 'sf-sample-policy',
  standalone: true,
  imports: [SfButtonComponent, SfCheckboxComponent, SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-policy.component.html',
  styleUrl: './sample-policy.component.scss',
})
export class SamplePolicyComponent {
  protected readonly state = inject(PublishingState);
  protected readonly t = this.state.t;
  protected readonly actions = POLICY_ACTIONS;
  protected readonly roles = POLICY_ROLES;

  private readonly saved = signal<PolicyGrid>(POLICY);
  protected readonly grid = signal<PolicyGrid>(POLICY);
  protected readonly dirty = computed(() =>
    POLICY_ACTIONS.some((a) => POLICY_ROLES.some((r) => this.grid()[a][r] !== this.saved()[a][r])),
  );

  /** Whether the cell is off because what it needs is off for that role. */
  protected blocked(action: PolicyAction, role: PolicyRole): PolicyAction | null {
    const needs = REQUIRES[action];
    return needs && !this.grid()[needs][role] ? needs : null;
  }

  protected checked(action: PolicyAction, role: PolicyRole): boolean {
    return role === 'admin' || (this.grid()[action][role] && !this.blocked(action, role));
  }

  protected set(action: PolicyAction, role: PolicyRole, on: boolean): void {
    this.grid.update((g) => ({ ...g, [action]: { ...g[action], [role]: on } }));
  }

  protected save(): void {
    this.saved.set(this.grid());
    this.state.notice();
  }

  protected discard(): void {
    this.grid.set(this.saved());
  }
}
