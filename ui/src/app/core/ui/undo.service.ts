import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Observable, firstValueFrom, isObservable } from 'rxjs';
import { ToastService } from './toast.service';

/** What undoes an operation: a promise or an observable of the inverse call. */
export type UndoStep = () => Promise<unknown> | Observable<unknown>;

/**
 * Undo for delete, move, rename and their bulk variants (M35.13, decision 10): after the operation, `offer` shows a toast
 * with **Undo**. Pressing it runs the inverse; if that fails, an error toast says so (and where to go instead). A bulk
 * operation offers one Undo for the group: its steps run in the reverse of the order they were done in, one after the
 * other, so a child is put back after its parent. The group stops at the first failure.
 */
@Injectable({ providedIn: 'root' })
export class UndoService {
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  /** Offers Undo for one operation. `message` says what was done ("Deleted “Spring campaign”."). */
  offer(message: string, undo: UndoStep): void {
    this.offerGroup(message, [undo]);
  }

  /** Offers one Undo for a group; `steps` are in the order the operations were done, undone last to first. */
  offerGroup(message: string, steps: readonly UndoStep[]): void {
    this.toasts.undo(message, () => void this.run(steps));
  }

  private async run(steps: readonly UndoStep[]): Promise<void> {
    try {
      for (const step of [...steps].reverse()) {
        const result = step();
        await (isObservable(result) ? firstValueFrom(result, { defaultValue: undefined }) : result);
      }
      this.toasts.show(this.transloco.translate('shared.undo.done'), 'info');
    } catch {
      this.toasts.show(this.transloco.translate('shared.undo.failed'), 'error');
    }
  }
}
