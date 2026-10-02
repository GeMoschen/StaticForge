import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SfSaveState, SfSaveStatusComponent } from '../../shared/components/layout/sf-save-status.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { AccountDraftStore } from './account-draft.store';
import type { AccountSection } from './account-sections';

/**
 * An account page's one save area (decisions 11, 47): the save status in a polite live region, a ghost *Discard* while
 * there are unsaved changes, and a primary *Save* that is enabled only while there are. Projected into the page
 * header's actions.
 */
@Component({
  selector: 'sf-account-save',
  standalone: true,
  imports: [SfButtonComponent, SfSaveStatusComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './account-save.component.scss',
  template: `
    <sf-save-status [state]="state()" [errorCount]="errors()" />
    @if (dirty()) {
      <sf-button variant="ghost" [disabled]="store.saving()" (click)="store.discardSection(section())">{{ 'account.save.discard' | transloco }}</sf-button>
    }
    <sf-button
      icon="save"
      [loading]="store.saving()"
      [disabled]="!dirty()"
      [disabledReason]="dirty() ? null : nothing()"
      (click)="save()"
      >{{ 'account.save.save' | transloco }}</sf-button
    >
  `,
})
export class AccountSaveComponent {
  protected readonly store = inject(AccountDraftStore);
  private readonly transloco = inject(TranslocoService);

  readonly section = input.required<AccountSection>();

  protected readonly dirty = computed(() => this.store.dirtyOf(this.section()));
  protected readonly errors = computed(() => this.store.errorCountOf(this.section()));
  protected readonly nothing = computed(() => this.transloco.translate('account.save.nothing'));
  protected readonly state = computed<SfSaveState>(() =>
    this.errors() > 0 ? 'error' : this.store.saving() ? 'saving' : this.dirty() ? 'dirty' : 'saved',
  );

  protected save(): void {
    void this.store.saveSection(this.section());
  }
}
