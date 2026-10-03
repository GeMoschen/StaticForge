import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { ToastService } from '../../../../core/ui/toast.service';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfCheckboxComponent } from '../../../../shared/components/forms/sf-checkbox.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { injectSampleText } from '../changes/sample-area.util';
import { SampleState } from '../sample-state';
import { REDIRECT_TARGETS } from './pages-data';

/**
 * Deleting the open page (M35.18, gate round 12): a confirmation that says what happens. A page that is online (released in some
 * language) **stays online until the deletion is released** — the dialog says so — and offers, to whoever may unpublish,
 * **Redirect the old address to…** with a page to choose; the redirect is written after the delete and takes effect once a
 * build no longer contains the page. With "redirect" ticked, **Delete** waits for a target and says why. A page that was never
 * released has no address to redirect: the dialog is only the question. Deleting shows a toast with **Undo** (the app's dialog
 * is the old plain one with English text; this is the proposed design). Nothing is deleted.
 */
@Component({
  selector: 'sf-sample-page-delete-dialog',
  standalone: true,
  imports: [SfButtonComponent, SfCheckboxComponent, SfDialogComponent, SfDialogFooterDirective, SfFieldComponent, SfSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-page-delete-dialog.component.scss',
  template: `
    <sf-dialog size="md" [title]="t('delete.title', { name: page().name })" (closed)="closed.emit()">
      <p class="delete__question">{{ online() ? t('delete.questionOnline') : t('delete.question') }}</p>

      @if (online()) {
        <div class="delete__redirect">
          <sf-checkbox [value]="redirect()" (valueChange)="redirect.set($event)">{{ t('delete.redirect') }}</sf-checkbox>
          @if (redirect()) {
            <sf-field [label]="t('delete.target')" [hint]="t('delete.targetHint', { url: page().url })">
              <sf-select
                [options]="targets()"
                [value]="target()"
                [placeholder]="t('delete.choosePage')"
                (valueChange)="target.set($event)"
              />
            </sf-field>
          }
        </div>
      }

      <ng-container sfDialogFooter>
        <sf-button variant="ghost" (click)="closed.emit()">{{ t('delete.cancel') }}</sf-button>
        <sf-button
          variant="danger"
          [disabled]="!ready()"
          [disabledReason]="ready() ? null : t('delete.chooseTarget')"
          (click)="submit()"
          >{{ t('delete.confirm') }}</sf-button
        >
      </ng-container>
    </sf-dialog>
  `,
})
export class SamplePageDeleteDialogComponent {
  private readonly state = inject(SampleState);
  private readonly toasts = inject(ToastService);
  protected readonly t = injectSampleText('styleguide.sample.pages');

  readonly closed = output<void>();

  protected readonly page = computed(() => this.state.page());
  /** Released in some language: the page is on the live site. */
  protected readonly online = computed(() => Object.values(this.page().status).some((status) => status === 'released' || status === 'changed'));
  protected readonly redirect = signal(false);
  protected readonly target = signal<string | null>(null);
  protected readonly targets = computed<SfSelectOption<string>[]>(() =>
    REDIRECT_TARGETS.filter((entry) => entry.id !== this.page().id).map((entry) => ({ value: entry.id, label: `${entry.name} · ${entry.url}` })),
  );
  protected readonly ready = computed(() => !this.redirect() || this.target() !== null);

  protected submit(): void {
    if (!this.ready()) {
      return;
    }
    const name = this.page().name;
    const message = this.online() ? this.t('delete.doneOnline', { name }) : this.t('delete.done', { name });
    this.closed.emit();
    this.toasts.undo(message, () => this.toasts.show(this.t('delete.restored'), 'info'));
  }
}
