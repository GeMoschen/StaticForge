import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { SfSaveState, SfSaveStatusComponent } from '../../../../shared/components/layout/sf-save-status.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { AccountState } from './account-state';

/**
 * An account page's one save area (decisions 11, 47): the save status in a polite live region, a ghost *Discard* while
 * there are unsaved changes, and a primary *Save* that is enabled only while there are. Projected into the page
 * header's actions.
 */
@Component({
  selector: 'sf-sample-account-save',
  standalone: true,
  imports: [SfButtonComponent, SfSaveStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-account-save.component.scss',
  template: `
    <sf-save-status [state]="state()" [errorCount]="errors()" />
    @if (dirty()) {
      <sf-button variant="ghost" (click)="discard.emit()">{{ t('save.discard') }}</sf-button>
    }
    <sf-button icon="save" [disabled]="!dirty()" [disabledReason]="dirty() ? null : t('save.nothing')" (click)="save.emit()">{{
      t('save.save')
    }}</sf-button>
  `,
})
export class SampleAccountSaveComponent {
  protected readonly t = inject(AccountState).t;

  readonly dirty = input.required<boolean>();
  /** The number of errors that refused the last save (0: none). */
  readonly errors = input(0);
  readonly save = output<void>();
  readonly discard = output<void>();

  protected state(): SfSaveState {
    return this.errors() > 0 ? 'error' : this.dirty() ? 'dirty' : 'saved';
  }
}
