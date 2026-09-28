import '@angular/compiler';
import { FormControl, FormGroup } from '@angular/forms';
import { fireEvent, render, screen } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../core/api/api.client';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { ContentService } from '../../content/content.service';
import type { EditorDefinition } from '../form.model';
import { SfMediaEditor } from './media-editor.component';

const definition: EditorDefinition = { name: 'image', type: 'MEDIA', label: 'Image' };

/**
 * "Choose" read `GET /media` as an array, but the endpoint returns a page (`{content: […]}`): the list threw and never
 * showed anything, so a media field could only be filled by typing a uuid (found by the M30 journey). It opens the
 * shared asset picker now, limited to media.
 */
describe('SfMediaEditor', () => {
  it('picks the media from the shared asset picker', async () => {
    const listAssets = vi.fn().mockReturnValue(
      of({ content: [{ uuid: 'media-1', uid: 'harbour_png', displayName: 'harbour.png', type: 'MEDIA' }] }),
    );
    const control = new FormGroup({ type: new FormControl('MEDIA_REF'), uuid: new FormControl<string | null>(null), altOverride: new FormControl(null) });
    await render(SfMediaEditor, {
      componentInputs: { definition, control, projectKey: 'acme' },
      providers: [
        { provide: ApiClient, useValue: { listAssets } },
        { provide: ContentService, useValue: {} },
        { provide: ProjectContextStore, useValue: { pageFolderTree: () => [], mediaFolderTree: () => [] } },
      ],
    });

    fireEvent.click(screen.getByText('Choose'));

    fireEvent.click(await screen.findByRole('button', { name: /harbour\.png/ }));
    expect(listAssets).toHaveBeenCalledWith('acme', expect.objectContaining({ type: 'MEDIA' }));
    expect(control.value.uuid).toBe('media-1');
    expect(control.dirty).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
