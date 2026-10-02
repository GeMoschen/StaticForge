import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfBannerComponent } from '../layout/sf-banner.component';
import { SfButtonComponent } from '../sf-button.component';
import type { UnsavedChangesOptions, UnsavedOutcome } from './unsaved-changes.service';
import { SfDialogRef, injectDialogData } from './dialog-ref';
import { SfDialogComponent, SfDialogFooterDirective } from './sf-dialog.component';

/**
 * The dialog behind `UnsavedChangesService` (M35.13): "{name} has changes that are not saved yet" with **Discard**,
 * **Cancel** and **Save**. A failed save keeps the person here: the dialog says why, and *Save* becomes *Try again* —
 * they can fix the errors (Cancel), or give the changes up (Discard). Closing it any other way (Escape, ×) is Cancel.
 */
@Component({
  selector: 'sf-unsaved-dialog',
  standalone: true,
  imports: [SfBannerComponent, SfButtonComponent, SfDialogComponent, SfDialogFooterDirective, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sf-dialog size="sm" [title]="'shared.unsaved.title' | transloco">
      <p class="sf-unsaved__message">{{ 'shared.unsaved.message' | transloco: { name: options.name } }}</p>
      @if (failure(); as message) {
        <sf-banner tone="danger" live="assertive">{{ 'shared.unsaved.failed' | transloco: { message: message } }}</sf-banner>
      }
      <ng-container sfDialogFooter>
        <sf-button variant="danger-ghost" [disabled]="saving()" (click)="discard()">{{ 'shared.unsaved.discard' | transloco }}</sf-button>
        <sf-button variant="secondary" [disabled]="saving()" (click)="ref.close('cancel')">{{ 'shared.unsaved.cancel' | transloco }}</sf-button>
        <sf-button data-sf-autofocus [loading]="saving()" (click)="save()">{{
          (failure() ? 'shared.unsaved.retry' : 'shared.unsaved.save') | transloco
        }}</sf-button>
      </ng-container>
    </sf-dialog>
  `,
  styles: `
    .sf-unsaved__message {
      margin: 0 0 var(--sf-space-3);
    }
  `,
})
export class SfUnsavedDialogComponent {
  protected readonly options = injectDialogData<Omit<UnsavedChangesOptions, 'injector'>>();
  protected readonly ref = inject<SfDialogRef<UnsavedOutcome>>(SfDialogRef);

  protected readonly saving = signal(false);
  /** Why the last save failed; `null` before the first try. */
  protected readonly failure = signal<string | null>(null);

  protected async save(): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    this.failure.set(null);
    const result = await this.options.save();
    this.saving.set(false);
    if (result.ok) {
      this.ref.close('saved');
    } else {
      this.failure.set(result.message);
    }
  }

  protected async discard(): Promise<void> {
    await this.options.discard?.();
    this.ref.close('discarded');
  }
}
