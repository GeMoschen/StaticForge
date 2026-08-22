import { InjectionToken, Signal } from '@angular/core';

/**
 * Shared context provided by {@link SfContentFormComponent} and injected by
 * editor components. It exposes the live form value (as a signal, so
 * `visibleWhen` expressions re-evaluate reactively) and an optional project key
 * used by the MEDIA/REFERENCE pickers.
 */
export interface SfFormContext {
  formValue: Signal<Record<string, unknown>>;
  projectKey: Signal<string | undefined>;
}

export const SF_FORM_CONTEXT = new InjectionToken<SfFormContext>('SF_FORM_CONTEXT');
