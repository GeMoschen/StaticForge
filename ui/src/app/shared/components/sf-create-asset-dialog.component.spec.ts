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

  describe('record sets and records (M25)', () => {
    const DATASETS = [
      { uuid: 'ds-team', displayName: 'Team' },
      { uuid: 'ds-product', displayName: 'Products' },
    ];

    function renderSetDialog(create: (value: CreateAssetFormValue) => void, initialDatasetUuid: string | null = null) {
      return render(SfCreateAssetDialogComponent, {
        componentInputs: { kind: 'RECORD_SET', open: true, projectKey: 'proj', datasets: DATASETS, initialDatasetUuid },
        providers: [{ provide: ApiClient, useValue: apiStub() }],
        on: { create },
      });
    }

    /**
     * The dataset a set is created with is the one the select shows: the default is written into the
     * control, never left to the browser's fallback display of an unmatched value.
     */
    it('submits the dataset the select shows by default, and no uid while it follows the name', async () => {
      const create = vi.fn();
      await renderSetDialog(create);

      fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Team leads' } });
      screen.getByRole('button', { name: 'Create' }).click();

      expect((screen.getByLabelText(/^Dataset/) as HTMLSelectElement).value).toBe('ds-team');
      expect(create).toHaveBeenCalledWith({ displayName: 'Team leads', datasetUuid: 'ds-team' });
    });

    it('preselects the dataset the store is filtered to', async () => {
      const create = vi.fn();
      await renderSetDialog(create, 'ds-product');

      fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Featured' } });
      screen.getByRole('button', { name: 'Create' }).click();

      expect(create.mock.calls[0][0]).toMatchObject({ datasetUuid: 'ds-product' });
    });

    it('derives the uid from the name and says the dataset is permanent', async () => {
      await renderSetDialog(vi.fn());

      fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Team Leads' } });

      expect((screen.getByLabelText(/^UID/) as HTMLInputElement).value).toBe('team_leads');
      expect(screen.getByText(/can't be changed after the set is created/)).toBeTruthy();
    });

    it('sends a uid the user typed, and keeps it when the name changes afterwards', async () => {
      const create = vi.fn();
      await renderSetDialog(create);

      fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Team Leads' } });
      fireEvent.input(screen.getByLabelText(/^UID/), { target: { value: 'leadership' } });
      fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Leadership team' } });
      fireEvent.change(screen.getByLabelText(/^Dataset/), { target: { value: 'ds-product' } });
      screen.getByRole('button', { name: 'Create' }).click();

      expect(create).toHaveBeenCalledWith({ displayName: 'Leadership team', datasetUuid: 'ds-product', uid: 'leadership' });
    });

    it('refuses a uid with characters a uid cannot have', async () => {
      const create = vi.fn();
      await renderSetDialog(create);

      fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Team' } });
      fireEvent.input(screen.getByLabelText(/^UID/), { target: { value: 'Team Leads!' } });
      screen.getByRole('button', { name: 'Create' }).click();

      expect(create).not.toHaveBeenCalled();
      expect(await screen.findByText('Use lowercase letters, numbers, and underscores only')).toBeTruthy();
    });

    /** A record's dataset is its set's: the record dialog asks for a name only. */
    it('asks a new record for its name only', async () => {
      const create = vi.fn();
      await render(SfCreateAssetDialogComponent, {
        componentInputs: { kind: 'RECORD', open: true, projectKey: 'proj', datasets: DATASETS },
        providers: [{ provide: ApiClient, useValue: apiStub() }],
        on: { create },
      });

      expect(screen.queryByLabelText(/^Dataset/)).toBeNull();
      expect(screen.queryByLabelText(/^UID/)).toBeNull();
      fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
      screen.getByRole('button', { name: 'Create' }).click();

      expect(create).toHaveBeenCalledWith({ displayName: 'Ada' });
    });
  });
});
