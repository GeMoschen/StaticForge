import { Injectable, Injector, inject } from '@angular/core';
import { DialogService } from './dialog.service';
import { SfUnsavedDialogComponent } from './sf-unsaved-dialog.component';

/** What a save attempt came to: done, or refused with a reason a person can read ("2 errors", "someone else edited it"). */
export type SaveResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** How the dialog ended. `cancel` also stands for Escape and ×. */
export type UnsavedOutcome = 'saved' | 'discarded' | 'cancel';

export interface UnsavedChangesOptions {
  /** What has the changes — the item's name ("Spring harvest arrives", "Settings › General"). */
  name: string;
  /** Saves the changes. A refusal keeps the dialog open with its message. */
  save: () => Promise<SaveResult>;
  /** Gives the changes up (reload from the server, reset the form) before the dialog closes. */
  discard?: () => void | Promise<void>;
  /** The opener's injector, so the dialog goes away with the screen that asked. */
  injector?: Injector;
}

/**
 * "Leave with unsaved changes?" (M35.13): one dialog for every editor — Save, Discard or Cancel; a failed save keeps
 * the person on the page. Resolves `true` when they may leave (saved or discarded), `false` when they stay.
 */
@Injectable({ providedIn: 'root' })
export class UnsavedChangesService {
  private readonly dialogs = inject(DialogService);

  async confirmLeave(options: UnsavedChangesOptions): Promise<boolean> {
    const { injector, ...data } = options;
    const outcome = await this.dialogs.open<UnsavedOutcome>(SfUnsavedDialogComponent, data, { injector }).result;
    return outcome === 'saved' || outcome === 'discarded';
  }
}
