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

  it('asks for no thumbnail of a file that is not a raster image — the server refuses it with 422 — and shows its icon', async () => {
    const mediaThumbnailBlob = vi.fn().mockReturnValue(of(new Blob(['x'])));
    await render(SfMediaThumbComponent, {
      componentInputs: { projectKey: 'acme', uuid: 'm-2', fileName: 'price-list.pdf' },
      providers: [{ provide: ApiClient, useValue: { mediaThumbnailBlob } }],
    });
    expect(mediaThumbnailBlob).not.toHaveBeenCalled();
    expect(document.querySelector('.sf-media-thumb__fallback')).not.toBeNull();
  });

  it('asks for the thumbnail of a raster image by its name', async () => {
    const mediaThumbnailBlob = vi.fn().mockReturnValue(of(new Blob(['x'])));
    await render(SfMediaThumbComponent, {
      componentInputs: { projectKey: 'acme', uuid: 'm-3', fileName: 'beans.JPG' },
      providers: [{ provide: ApiClient, useValue: { mediaThumbnailBlob } }],
    });
    await waitFor(() => expect(mediaThumbnailBlob).toHaveBeenCalledWith('acme', 'm-3'));
  });

  it('trusts an explicit image flag over the file name', async () => {
    const mediaThumbnailBlob = vi.fn();
    await render(SfMediaThumbComponent, {
      componentInputs: { projectKey: 'acme', uuid: 'm-4', fileName: 'beans.jpg', image: false },
      providers: [{ provide: ApiClient, useValue: { mediaThumbnailBlob } }],
    });
    expect(mediaThumbnailBlob).not.toHaveBeenCalled();
  });
});
