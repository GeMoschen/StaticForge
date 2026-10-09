import { Injectable, signal } from '@angular/core';

/**
 * Whether the Build now dialog is open (M35.24, gate decision 198). The dialog itself lives in the app frame, so the
 * Publishing header, the *Alt+Shift+B* shortcut and the palette open the same dialog from any screen of a project.
 */
@Injectable({ providedIn: 'root' })
export class BuildDialogService {
  readonly isOpen = signal(false);

  open(): void {
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }
}
