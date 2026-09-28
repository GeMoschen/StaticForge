import { Signal, computed } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl } from '@angular/forms';
import { map, startWith, switchMap } from 'rxjs';

/**
 * A signal that changes whenever a form control's value, status, touched or pristine state changes — read it first in
 * a `computed` that reads the control. Reactive-form controls are not signals: a `computed` over `control.errors` or
 * `control.value` alone runs once and keeps its first answer, so an editor went on showing "This field is required"
 * under a field after it was filled. Follows the control when the input hands over another one. Call it in an injection
 * context (a field initializer).
 */
export function controlChanges(control: () => AbstractControl): Signal<number> {
  let changes = 0;
  return toSignal(
    toObservable(computed(control)).pipe(
      switchMap((current) => current.events.pipe(startWith(null))),
      map(() => ++changes),
    ),
    { initialValue: 0 },
  );
}
