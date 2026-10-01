import { InjectionToken, inject } from '@angular/core';

/** The data a dialog was opened with (`DialogService.open(component, data)`). */
export const SF_DIALOG_DATA = new InjectionToken<unknown>('SF_DIALOG_DATA');

/** The data of the dialog this component was opened as. */
export function injectDialogData<T>(): T {
  return inject(SF_DIALOG_DATA) as T;
}

/**
 * A dialog opened by `DialogService` (M35.7). The dialog's component injects it to close itself with a result; the
 * opener awaits {@link result}. Closing without a result (Escape, backdrop, the × button) resolves `undefined`.
 */
export class SfDialogRef<R = unknown> {
  /** Settles once, with the result the dialog closed with. */
  readonly result: Promise<R | undefined>;

  private resolve!: (result: R | undefined) => void;
  private dispose: (() => void) | null = null;
  private closed = false;

  constructor() {
    this.result = new Promise((resolve) => (this.resolve = resolve));
  }

  close(result?: R): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.dispose?.();
    this.resolve(result);
  }

  /** @internal Set by `DialogService`: tears the dialog's component down. */
  attach(dispose: () => void): void {
    this.dispose = dispose;
  }
}
