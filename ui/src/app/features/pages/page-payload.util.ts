import { FormGroup } from '@angular/forms';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ContentDefinition, FormBuilderService } from '../forms';
import type { PagePayload } from './autosave.service';

type PageView = components['schemas']['PageView'];

/**
 * Builds the full page payload persisted on autosave flush: the page's own
 * top-level fields (from its content definition + form, when both are
 * loaded) plus the bodies/nav/output/meta already held on the current page
 * view. `templateRef` is required by the backend's PUT validator (see
 * `PagePayload`).
 */
export function composePagePayload(
  fb: FormBuilderService,
  def: ContentDefinition | null,
  form: FormGroup | null,
  page: PageView | null,
): PagePayload {
  const content = def && form ? fb.valueOf(def, form) : (page?.content ?? {});
  return {
    templateRef: page?.template?.uuid,
    content,
    bodies: page?.bodies ?? {},
    nav: page?.nav,
    output: page?.output,
    meta: page?.meta,
  };
}
