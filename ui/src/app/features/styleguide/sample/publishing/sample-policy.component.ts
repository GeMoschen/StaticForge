import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfSwitchComponent } from '../../../../shared/components/forms/sf-switch.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { EDITOR_POLICY, EditorPolicy, POLICY_ACTIONS, POLICY_IMPACT, PolicyAction } from './publishing-data';
import { PublishingState } from './publishing-state';

/** What an action needs first: scheduling needs releasing, full builds need incremental ones. */
const REQUIRES: Partial<Record<PolicyAction, PolicyAction>> = { schedule: 'release', full: 'incremental' };
/** Taking these away makes scheduled items of editors fail. */
const SCHEDULED: readonly PolicyAction[] = ['release', 'schedule'];

/**
 * Publishing › Policy: what **editors** may do to put content online — one settings card "Publishing by editors" with four
 * switches (developers and admins can always do all of it). Turning a base permission off turns what needs it off and
 * disables it ("Needs “…”"). The save UX: a status (Saved / Unsaved changes), Discard and Save, enabled only when
 * something changed; Save asks first when schedules of editors would fail (`pdialog=impact` opens that dialog). Only
 * project admins can change it (`role=editor`: read-only with a note).
 */
@Component({
  selector: 'sf-sample-policy',
  standalone: true,
  imports: [SfButtonComponent, SfDialogComponent, SfDialogFooterDirective, SfIconComponent, SfSwitchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-policy.component.html',
  styleUrl: './sample-policy.component.scss',
})
export class SamplePolicyComponent {
  protected readonly state = inject(PublishingState);
  protected readonly t = this.state.t;
  protected readonly actions = POLICY_ACTIONS;
  protected readonly impact = POLICY_IMPACT;
  protected readonly readonly = computed(() => this.state.role() === 'editor');

  private readonly saved = signal<EditorPolicy>(EDITOR_POLICY);
  protected readonly policy = signal<EditorPolicy>(EDITOR_POLICY);
  protected readonly dirty = computed(() => POLICY_ACTIONS.some((a) => this.policy()[a] !== this.saved()[a]));

  /** The permission the switch needs while that one is off, else null. */
  protected needs(action: PolicyAction): PolicyAction | null {
    const base = REQUIRES[action];
    return base && !this.policy()[base] ? base : null;
  }

  protected checked(action: PolicyAction): boolean {
    return this.policy()[action] && !this.needs(action);
  }

  protected set(action: PolicyAction, on: boolean): void {
    this.policy.update((p) => {
      const next = { ...p, [action]: on };
      // Turning a base off turns its dependents off (they stay off when it comes back on).
      for (const dependent of POLICY_ACTIONS) {
        if (!on && REQUIRES[dependent] === action) {
          next[dependent] = false;
        }
      }
      return next;
    });
  }

  /** Saving asks first when it takes away what scheduled items of editors need. */
  protected save(): void {
    if (SCHEDULED.some((a) => this.saved()[a] && !this.policy()[a])) {
      this.state.policyImpact.set(true);
      return;
    }
    this.commit();
  }

  protected saveAnyway(): void {
    this.state.policyImpact.set(false);
    this.commit();
  }

  protected discard(): void {
    this.policy.set(this.saved());
  }

  private commit(): void {
    this.saved.set(this.policy());
    this.state.notice();
  }
}
