import { DOCUMENT } from '@angular/common';
import {
  ApplicationRef,
  DestroyRef,
  EnvironmentInjector,
  Injectable,
  Injector,
  Type,
  createComponent,
  inject,
} from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';
import { SF_DIALOG_DATA, SfDialogRef } from './dialog-ref';

export interface DialogOpenOptions {
  /**
   * The injector the dialog component resolves its dependencies from — pass the opener's (`inject(Injector)`) when the
   * dialog needs services provided below the root, such as a project's stores.
   */
  injector?: Injector;
}

/**
 * Opens a component as a dialog (M35.7). The component renders `<sf-dialog>` as its root (title, body, footer) and
 * injects {@link SfDialogRef} to close with a result and {@link injectDialogData} for its input:
 *
 * ```ts
 * const ref = this.dialogs.open<MoveResult>(MoveDialogComponent, { items }, { injector: this.injector });
 * const result = await ref.result; // undefined when dismissed
 * ```
 *
 * `sf-dialog` does the overlay work (focus trap and restore, `inert` background, Escape, stacking), so a dialog opened
 * here and one written inline with `@if` behave the same.
 *
 * A dialog never outlives its context: a route change closes it, and so does the destruction of the component whose
 * `injector` opened it — both resolve `undefined`, so a confirmation can't act for a screen that is gone.
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly appRef = inject(ApplicationRef);
  private readonly environmentInjector = inject(EnvironmentInjector);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router, { optional: true });

  open<R = unknown, D = unknown>(component: Type<unknown>, data?: D, options: DialogOpenOptions = {}): SfDialogRef<R> {
    const ref = new SfDialogRef<R>();
    const elementInjector = Injector.create({
      providers: [
        { provide: SF_DIALOG_DATA, useValue: data },
        { provide: SfDialogRef, useValue: ref },
      ],
      parent: options.injector ?? this.injector,
    });
    const componentRef = createComponent(component, {
      environmentInjector: this.environmentInjector,
      elementInjector,
    });
    const host = componentRef.location.nativeElement as HTMLElement;
    this.document.body.appendChild(host);
    this.appRef.attachView(componentRef.hostView);
    componentRef.changeDetectorRef.detectChanges();
    const navigation = this.router?.events
      .pipe(filter((event) => event instanceof NavigationStart))
      .subscribe(() => ref.close());
    const unregisterOpener = options.injector?.get(DestroyRef, null)?.onDestroy(() => ref.close());
    ref.attach(() => {
      navigation?.unsubscribe();
      unregisterOpener?.();
      this.appRef.detachView(componentRef.hostView);
      componentRef.destroy();
      host.remove();
    });
    return ref;
  }
}
