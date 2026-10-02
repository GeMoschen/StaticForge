import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { ActiveEditorService } from './active-editor.service';

/**
 * Leaving an editor's route (or switching to another item on the same route) with unsaved changes asks first
 * (M35.13): see {@link ActiveEditorService.canLeave}. Put it on every route that hosts an editor.
 */
export const unsavedChangesGuard: CanDeactivateFn<unknown> = () => inject(ActiveEditorService).canLeave();
