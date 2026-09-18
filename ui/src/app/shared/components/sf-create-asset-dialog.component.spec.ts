import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { SfCreateAssetDialogComponent, type CreateAssetFormValue } from './sf-create-asset-dialog.component';

function apiStub() {
  return {
    listAssets: vi.fn(),
    createFolder: vi.fn(),
    createPage: vi.fn(),
  };
}

describe('SfCreateAssetDialogComponent', () => {
  it('shows only the name field for FOLDER', async () => {
    await render(SfCreateAssetDialogComponent, {
      componentInputs: { kind: 'FOLDER', open: true, projectKey: 'proj' },
      providers: [{ provide: ApiClient, useValue: apiStub() }],
    });

    expect(screen.getByText('New folder')).toBeTruthy();
    expect(screen.queryByText('Template')).toBeFalsy();
    expect(screen.queryByText('Target page')).toBeFalsy();
    expect(screen.queryByText('Label')).toBeFalsy();
  });

  it('shows the name and template fields for PAGE', async () => {
    await render(SfCreateAssetDialogComponent, {
      componentInputs: {
        kind: 'PAGE',
        open: true,
        projectKey: 'proj',
        templates: [{ uuid: 'tpl-1', displayName: 'Landing' }],
      },
      providers: [{ provide: ApiClient, useValue: apiStub() }],
    });

    expect(screen.getByText('New page')).toBeTruthy();
    expect(screen.getByText('Template')).toBeTruthy();
    expect(screen.getByText('Landing')).toBeTruthy();
    expect(screen.queryByText('Target page')).toBeFalsy();
  });

  it('never offers an abstract page template for a new page (M20)', async () => {
    await render(SfCreateAssetDialogComponent, {
      componentInputs: {
        kind: 'PAGE',
        open: true,
        projectKey: 'proj',
        templates: [
          { uuid: 'tpl-base', displayName: 'Base layout', abstract: true },
          { uuid: 'tpl-article', displayName: 'Article', abstract: false },
        ],
      },
      providers: [{ provide: ApiClient, useValue: apiStub() }],
    });

    expect(screen.getByText('Article')).toBeTruthy();
    expect(screen.queryByText('Base layout')).toBeFalsy();
  });

  it('shows the name, target, and label fields for PAGE_REFERENCE', async () => {
    await render(SfCreateAssetDialogComponent, {
      componentInputs: { kind: 'PAGE_REFERENCE', open: true, projectKey: 'proj' },
      providers: [{ provide: ApiClient, useValue: apiStub() }],
    });

    expect(screen.getByText('New reference')).toBeTruthy();
    expect(screen.getByText('Target page')).toBeTruthy();
    expect(screen.getByText('Label')).toBeTruthy();
    expect(screen.queryByText('Template')).toBeFalsy();
  });

  it('blocks submit and shows an inline error when displayName is blank', async () => {
    const create = vi.fn();
    await render(SfCreateAssetDialogComponent, {
      componentInputs: { kind: 'FOLDER', open: true, projectKey: 'proj' },
      providers: [{ provide: ApiClient, useValue: apiStub() }],
      on: { create },
    });

    screen.getByRole('button', { name: 'Create' }).click();

    expect(create).not.toHaveBeenCalled();
    expect(await screen.findByText('A name is required')).toBeTruthy();
  });

  it('emits create with exactly {displayName, templateUuid} for PAGE', async () => {
    const create = vi.fn();
    await render(SfCreateAssetDialogComponent, {
      componentInputs: {
        kind: 'PAGE',
        open: true,
        projectKey: 'proj',
        templates: [{ uuid: 'tpl-1', displayName: 'Landing' }],
      },
      providers: [{ provide: ApiClient, useValue: apiStub() }],
      on: { create },
    });

    // `fireEvent` from @testing-library/angular runs change detection after the event, so the
    // template sees the filled-in form before Create is clicked.
    fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'My Page' } });
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'tpl-1' } });

    screen.getByRole('button', { name: 'Create' }).click();

    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0][0] as CreateAssetFormValue;
    expect(payload).toEqual({ displayName: 'My Page', templateUuid: 'tpl-1' });
  });

  it('closes on Escape without emitting create', async () => {
    const create = vi.fn();
    const closed = vi.fn();
    await render(SfCreateAssetDialogComponent, {
      componentInputs: { kind: 'FOLDER', open: true, projectKey: 'proj' },
      providers: [{ provide: ApiClient, useValue: apiStub() }],
      on: { create, closed },
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(create).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('makes zero HTTP/API calls of its own', async () => {
    const api = apiStub();
    await render(SfCreateAssetDialogComponent, {
      componentInputs: { kind: 'FOLDER', open: true, projectKey: 'proj' },
      providers: [{ provide: ApiClient, useValue: api }],
    });

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    nameInput.value = 'A folder';
    nameInput.dispatchEvent(new Event('input'));
    screen.getByRole('button', { name: 'Create' }).click();

    expect(api.listAssets).not.toHaveBeenCalled();
    expect(api.createFolder).not.toHaveBeenCalled();
    expect(api.createPage).not.toHaveBeenCalled();
  });
});
