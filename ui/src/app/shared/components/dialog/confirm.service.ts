import { Injectable, Injector, inject } from '@angular/core';
import { DialogService } from './dialog.service';
import { SfConfirmDialogComponent } from './sf-confirm-dialog.component';

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** The verb that names the action: "Delete 12 pages", not "OK". Defaults to `shared.confirm.confirm`. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` for destructive actions: a danger confirm button, and focus starts on Cancel. */
  tone?: 'default' | 'danger';
  /** The user must type this text (e.g. the folder name) before the action is allowed — for large deletes. */
  typeToConfirm?: string;
  /** A list shown under the message: what will be affected. */
  details?: readonly string[];
  /** Adds "This cannot be undone." — only for actions without an undo. */
  irreversible?: boolean;
  /** The opener's injector, when the confirmation is shown from inside a scoped feature. */
  injector?: Injector;
}

/**
 * The one confirmation API (M35.7), replacing `window.confirm` and per-screen confirm markup:
 *
 * ```ts
 * if (await this.confirms.confirm({ title: 'Delete 12 pages?', confirmLabel: 'Delete 12 pages', tone: 'danger' })) { … }
 * ```
 *
 * Resolves `true` only when the user pressed the confirm button; Escape, the backdrop, × and Cancel resolve `false`.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly dialogs = inject(DialogService);

  confirm(options: ConfirmOptions): Promise<boolean> {
    const { injector, ...data } = options;
    const ref = this.dialogs.open<boolean>(SfConfirmDialogComponent, data, { injector });
    return ref.result.then((result) => result === true);
  }
}
