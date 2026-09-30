import { InjectionToken, Signal } from '@angular/core';
import type { FormGroup } from '@angular/forms';
import type { ContentDefinition } from './form.model';
import type { RuleHub } from './rules/rule-hub';

/**
 * Shared context provided by {@link SfContentFormComponent} and injected by
 * editor components. It exposes the live form value (as a signal, so
 * `visibleWhen` expressions re-evaluate reactively) and an optional project key
 * used by the MEDIA/REFERENCE pickers.
 *
 * <p>For editor rules (M33) it also carries what a catalog editor needs to hand its cards their live fills, field
 * states and findings: the asset's {@link RuleHub}, the findings with their path prefix, the form and its definition
 * (to find the catalog's own path), and `filled` to report a card filled without an event.
 */
export interface SfFormContext {
  formValue: Signal<Record<string, unknown>>;
  projectKey: Signal<string | undefined>;
  ruleHub?: Signal<RuleHub | null>;
  issues?: Signal<ReadonlyArray<{ path?: string; message?: string; severity?: string; locale?: string }>>;
  issuePrefix?: Signal<string>;
  definition?: Signal<ContentDefinition>;
  formGroup?: Signal<FormGroup>;
  filled?: () => void;
}

export const SF_FORM_CONTEXT = new InjectionToken<SfFormContext>('SF_FORM_CONTEXT');
