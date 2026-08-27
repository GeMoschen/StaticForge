import { render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ProjectSettingsExportComponent } from './project-settings-export.component';
import { ImportExportService } from './import-export.service';

// `pageFolderTree` always has exactly one top-level entry now — the fixed, protected "All
// Pages" wrapper root (mirrors NAVIGATION/TEMPLATES' own fixed roots) — unwrapped by the
// component for display (`topLevelFolders`), so "Root"/"Child" below are the real top-level
// tree the tests actually interact with.
const pageTree = [
  {
    uuid: 'folder-wrapper',
    uid: 'pages_root',
    displayName: 'All Pages',
    path: '/pages_root/',
    scope: 'PAGES',
    protectedFolder: true,
    children: [
      {
        uuid: 'folder-root',
        uid: 'root',
        displayName: 'Root',
        path: '/pages_root/root/',
        scope: 'PAGES',
        children: [
          {
            uuid: 'folder-child',
            uid: 'child',
            displayName: 'Child',
            path: '/pages_root/root/child/',
            scope: 'PAGES',
            children: [],
          },
        ],
      },
    ],
  },
];

function makeStoreStub(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    loadFor: vi.fn().mockReturnValue(of(undefined)),
    loading: vi.fn().mockReturnValue(false),
    error: vi.fn().mockReturnValue(null),
    pageFolderTree: vi.fn().mockReturnValue(pageTree),
    mediaFolderTree: vi.fn().mockReturnValue([]),
    navigationFolderTree: vi.fn().mockReturnValue([]),
    templateFolderTree: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}

function makeApiStub(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    listAssets: vi.fn().mockReturnValue(
      of({
        content: [{ uuid: 'asset-1', uid: 'home', displayName: 'Home', type: 'PAGE' }],
        totalElements: 1,
        totalPages: 1,
      }),
    ),
    ...overrides,
  };
}

function makeImportExportStub(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    exportSelection: vi.fn().mockReturnValue(of(new Blob(['zip'], { type: 'application/zip' }))),
    ...overrides,
  };
}

describe('ProjectSettingsExportComponent', () => {
  it('selecting a folder visually selects its full current subtree', async () => {
    const store = makeStoreStub();
    const api = makeApiStub();
    await render(ProjectSettingsExportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: ProjectContextStore, useValue: store },
        { provide: ApiClient, useValue: api },
        { provide: ImportExportService, useValue: makeImportExportStub() },
      ],
    });

    await waitFor(() => expect(screen.getByText('Root')).toBeTruthy());

    // Expand the root folder so its child folder row renders.
    const expandButtons = screen.getAllByLabelText('Expand folder');
    expandButtons[0].click();
    await waitFor(() => expect(screen.getByText('Child')).toBeTruthy());

    // Check the root folder.
    const rootCheckbox = document.getElementById('export-node-folder-root') as HTMLInputElement;
    rootCheckbox.click();

    await waitFor(() => {
      const childCheckbox = document.getElementById('export-node-folder-child') as HTMLInputElement;
      expect(childCheckbox.checked).toBe(true);
      expect(childCheckbox.disabled).toBe(true);
    });
  });

  it('disables export with nothing selected and enables it once a toggle or item is picked', async () => {
    const store = makeStoreStub();
    const api = makeApiStub();
    await render(ProjectSettingsExportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: ProjectContextStore, useValue: store },
        { provide: ApiClient, useValue: api },
        { provide: ImportExportService, useValue: makeImportExportStub() },
      ],
    });
    await waitFor(() => expect(screen.getByText('Root')).toBeTruthy());

    const exportButton = screen.getByRole('button', { name: /Export/ }) as HTMLButtonElement;
    expect(exportButton.disabled).toBe(true);

    const channelsToggle = screen.getByText('Include output channels').closest('label')!.querySelector('input')!;
    (channelsToggle as HTMLInputElement).click();

    await waitFor(() => expect(exportButton.disabled).toBe(false));
  });

  it('enables export once a tree item is checked', async () => {
    const store = makeStoreStub();
    const api = makeApiStub();
    await render(ProjectSettingsExportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: ProjectContextStore, useValue: store },
        { provide: ApiClient, useValue: api },
        { provide: ImportExportService, useValue: makeImportExportStub() },
      ],
    });
    await waitFor(() => expect(screen.getByText('Root')).toBeTruthy());

    const exportButton = screen.getByRole('button', { name: /Export/ }) as HTMLButtonElement;
    expect(exportButton.disabled).toBe(true);

    const rootCheckbox = document.getElementById('export-node-folder-root') as HTMLInputElement;
    rootCheckbox.click();

    await waitFor(() => expect(exportButton.disabled).toBe(false));
  });

  it('triggers a file download on a successful export', async () => {
    const store = makeStoreStub();
    const api = makeApiStub();
    const importExport = makeImportExportStub();
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await render(ProjectSettingsExportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: ProjectContextStore, useValue: store },
        { provide: ApiClient, useValue: api },
        { provide: ImportExportService, useValue: importExport },
      ],
    });
    await waitFor(() => expect(screen.getByText('Root')).toBeTruthy());

    const rootCheckbox = document.getElementById('export-node-folder-root') as HTMLInputElement;
    rootCheckbox.click();

    const exportButton = screen.getByRole('button', { name: /Export/ }) as HTMLButtonElement;
    await waitFor(() => expect(exportButton.disabled).toBe(false));
    exportButton.click();

    await waitFor(() =>
      expect(importExport.exportSelection).toHaveBeenCalledWith('proj', {
        assetUuids: ['folder-root'],
        includeChannels: false,
        includeGenerationTargets: false,
        fullStores: [],
      }),
    );
    await waitFor(() => expect(createObjectURLSpy).toHaveBeenCalled());
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalled();

    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it('selecting "whole store" exports fullStores without requiring the tree to be expanded', async () => {
    const store = makeStoreStub();
    const api = makeApiStub();
    const importExport = makeImportExportStub();
    await render(ProjectSettingsExportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: ProjectContextStore, useValue: store },
        { provide: ApiClient, useValue: api },
        { provide: ImportExportService, useValue: importExport },
      ],
    });
    await waitFor(() => expect(screen.getByText('Root')).toBeTruthy());

    screen.getByText('Select all pages').click();

    const exportButton = screen.getByRole('button', { name: /Export/ }) as HTMLButtonElement;
    await waitFor(() => expect(exportButton.disabled).toBe(false));
    exportButton.click();

    await waitFor(() =>
      expect(importExport.exportSelection).toHaveBeenCalledWith('proj', {
        assetUuids: [],
        includeChannels: false,
        includeGenerationTargets: false,
        fullStores: ['PAGES'],
      }),
    );
  });

  it('unchecking one item while its store is fully-selected keeps everything else selected', async () => {
    const store = makeStoreStub();
    const api = makeApiStub();
    await render(ProjectSettingsExportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: ProjectContextStore, useValue: store },
        { provide: ApiClient, useValue: api },
        { provide: ImportExportService, useValue: makeImportExportStub() },
      ],
    });
    await waitFor(() => expect(screen.getByText('Root')).toBeTruthy());

    screen.getByText('Select all pages').click();
    await waitFor(() => {
      const rootCheckbox = document.getElementById('export-node-folder-root') as HTMLInputElement;
      expect(rootCheckbox.checked).toBe(true);
    });

    const rootCheckbox = document.getElementById('export-node-folder-root') as HTMLInputElement;
    rootCheckbox.click();

    // The single root was the only top-level node, so excluding it from the exploded
    // full-store pick leaves nothing selected — "Select all pages" is no longer active and
    // the uncheck "won".
    await waitFor(() => {
      const rootAfter = document.getElementById('export-node-folder-root') as HTMLInputElement;
      expect(rootAfter.checked).toBe(false);
    });
  });

  it('shows an inline error when the export request fails', async () => {
    const store = makeStoreStub();
    const api = makeApiStub();
    const importExport = makeImportExportStub({
      exportSelection: vi.fn().mockReturnValue(throwError(() => new Error('boom'))),
    });

    await render(ProjectSettingsExportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: ProjectContextStore, useValue: store },
        { provide: ApiClient, useValue: api },
        { provide: ImportExportService, useValue: importExport },
      ],
    });
    await waitFor(() => expect(screen.getByText('Root')).toBeTruthy());

    const rootCheckbox = document.getElementById('export-node-folder-root') as HTMLInputElement;
    rootCheckbox.click();

    const exportButton = screen.getByRole('button', { name: /Export/ }) as HTMLButtonElement;
    await waitFor(() => expect(exportButton.disabled).toBe(false));
    exportButton.click();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/Could not export/);
  });
});
