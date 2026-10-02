import '@angular/compiler';
import { render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../core/api/api.client';
import { SfMediaThumbComponent } from './sf-media-thumb.component';

afterEach(() => vi.restoreAllMocks());

describe('SfMediaThumbComponent', () => {
  it('shows the fetched thumbnail as an image and gives the object URL back when it goes away', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumb');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const mediaThumbnailBlob = vi.fn().mockReturnValue(of(new Blob(['x'])));
    const { fixture } = await render(SfMediaThumbComponent, {
      componentInputs: { projectKey: 'acme', uuid: 'm-1', alt: 'Beans' },
      providers: [{ provide: ApiClient, useValue: { mediaThumbnailBlob } }],
    });

    const image = await screen.findByRole('img', { name: 'Beans' });
    expect(image.getAttribute('src')).toBe('blob:thumb');
    expect(mediaThumbnailBlob).toHaveBeenCalledWith('acme', 'm-1');
    expect(create).toHaveBeenCalledTimes(1);

    fixture.destroy();
    expect(revoke).toHaveBeenCalledWith('blob:thumb');
  });

  it('falls back to an icon when the thumbnail cannot be fetched', async () => {
    await render(SfMediaThumbComponent, {
      componentInputs: { projectKey: 'acme', uuid: 'm-1' },
      providers: [{ provide: ApiClient, useValue: { mediaThumbnailBlob: () => throwError(() => new Error('404')) } }],
    });
    await waitFor(() => expect(document.querySelector('.sf-media-thumb__fallback')).not.toBeNull());
    expect(screen.queryByRole('img')).toBeNull();
  });
});
