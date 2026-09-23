import '@angular/compiler';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  ConflictReportView,
  ImportExportService,
  ImportResultView,
} from './import-export.service';
import { ProjectSettingsImportComponent } from './project-settings-import.component';

function makeApiStub(overrides: Partial<Record<keyof ImportExportService, unknown>> = {}) {
  return {
    analyzeImport: vi.fn(),
    commitImport: vi.fn(),
    exportSelection: vi.fn(),
    ...overrides,
  };
}

function zipFile(name = 'archive.zip'): File {
  return new File(['zip bytes'], name, { type: 'application/zip' });
}

/**
 * jsdom's `DataTransfer`/`FileList` construction is unreliable, so file selection is
 * simulated the way this codebase's other upload flows are exercised: dispatch a
 * `change` event on the hidden `<input type="file">` after stubbing its `.files`
 * property directly (`Object.defineProperty`), since `HTMLInputElement.files` is
 * otherwise read-only.
 */
function selectFile(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

const cleanReport: ConflictReportView = { conflicts: [], hasBlocking: false };

const blockingReport: ConflictReportView = {
  hasBlocking: true,
  conflicts: [
    {
      severity: 'BLOCKING',
      type: 'DUPLICATE_UUID_TYPE_MISMATCH',
      elementUuid: 'a-1',
      elementLabel: 'Home page',
      detail: 'An element with this UUID already exists as a different type.',
    },
    {
      severity: 'WARNING',
      type: 'MISSING_TEMPLATE_REFERENCE',
      elementUuid: 'a-2',
      elementLabel: 'About page',
      detail: 'Referenced template not found; will fall back to default.',
    },
  ],
};

const importResult: ImportResultView = {
  sourceProjectKey: 'other-proj',
  importedAssetCount: 5,
  updatedAssetCount: 1,
  importedBlobCount: 2,
};

describe('ProjectSettingsImportComponent', () => {
  it('disables Import and shows the blocking section first when analysis finds a blocking conflict', async () => {
    const api = makeApiStub({ analyzeImport: vi.fn().mockReturnValue(of(blockingReport)) });
    await render(ProjectSettingsImportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ImportExportService, useValue: api },
      ],
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    selectFile(input, zipFile());

    expect(api.analyzeImport).toHaveBeenCalledWith('proj', expect.any(File), false);
    await waitFor(() => expect(screen.getByText('Blocking issues')).toBeTruthy());
    expect(screen.getByText('Warnings')).toBeTruthy();

    const sections = screen.getAllByRole('heading', { level: 2 });
    const blockingIdx = sections.findIndex((h) => h.textContent?.includes('Blocking issues'));
    const warningIdx = sections.findIndex((h) => h.textContent?.includes('Warnings'));
    expect(blockingIdx).toBeLessThan(warningIdx);

    const importBtn = screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
  });

  it('shows the success state and an enabled Import button for a clean archive', async () => {
    const api = makeApiStub({ analyzeImport: vi.fn().mockReturnValue(of(cleanReport)) });
    await render(ProjectSettingsImportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ImportExportService, useValue: api },
      ],
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    selectFile(input, zipFile());

    await waitFor(() => expect(screen.getByText('No conflicts found')).toBeTruthy());
    const importBtn = screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(false);
  });

  it('clears the file/report on Cancel with no additional network calls', async () => {
    const api = makeApiStub({ analyzeImport: vi.fn().mockReturnValue(of(cleanReport)) });
    await render(ProjectSettingsImportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ImportExportService, useValue: api },
      ],
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    selectFile(input, zipFile());
    await waitFor(() => expect(screen.getByText('No conflicts found')).toBeTruthy());

    screen.getByText('Cancel').click();

    await waitFor(() => expect(screen.getByText('Choose file…')).toBeTruthy());
    expect(api.analyzeImport).toHaveBeenCalledTimes(1);
    expect(api.commitImport).not.toHaveBeenCalled();
  });

  it('shows the result counts and resets the panel after a successful Import', async () => {
    const api = makeApiStub({
      analyzeImport: vi.fn().mockReturnValue(of(cleanReport)),
      commitImport: vi.fn().mockReturnValue(of(importResult)),
    });
    await render(ProjectSettingsImportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ImportExportService, useValue: api },
      ],
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    selectFile(input, zipFile());
    await waitFor(() => expect(screen.getByText('No conflicts found')).toBeTruthy());

    screen.getByRole('button', { name: 'Import' }).click();

    expect(api.commitImport).toHaveBeenCalledWith('proj', expect.any(File), false);
    await waitFor(() => expect(screen.getByText(/Imported 5 asset/)).toBeTruthy());
    // Panel resets back toward its initial state — ready for another import.
    expect(screen.getByText('Choose file…')).toBeTruthy();
    expect(screen.queryByText('No conflicts found')).toBeNull();
  });

  it('re-analyzes live with skipExistingImplicit when the toggle changes, and passes it through to commit', async () => {
    vi.useFakeTimers();
    const conflictWithProvenance: ConflictReportView = {
      hasBlocking: false,
      conflicts: [
        {
          severity: 'WARNING',
          type: 'MISSING_PARENT_FOLDER',
          elementUuid: 'a-9',
          elementLabel: 'Implicit folder',
          detail: 'Ancestor folder already exists.',
          explicit: false,
        },
      ],
    };
    const api = makeApiStub({
      analyzeImport: vi.fn().mockReturnValue(of(conflictWithProvenance)),
      commitImport: vi.fn().mockReturnValue(of(importResult)),
    });
    await render(ProjectSettingsImportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ImportExportService, useValue: api },
      ],
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    selectFile(input, zipFile());
    await waitFor(() => expect(screen.getByText('implicit')).toBeTruthy());
    expect(api.analyzeImport).toHaveBeenCalledWith('proj', expect.any(File), false);

    const toggle = screen.getByText('Skip ancestor folders that already exist').closest('label')!.querySelector('input')!;
    (toggle as HTMLInputElement).click();
    await vi.advanceTimersByTimeAsync(300);

    await waitFor(() => expect(api.analyzeImport).toHaveBeenCalledWith('proj', expect.any(File), true));

    screen.getByRole('button', { name: 'Import' }).click();
    expect(api.commitImport).toHaveBeenCalledWith('proj', expect.any(File), true);
    vi.useRealTimers();
  });

  it('shows a distinct message rather than a generic error on a 409-on-commit', async () => {
    const freshConflicts = [
      {
        severity: 'BLOCKING' as const,
        type: 'DUPLICATE_UUID_TYPE_MISMATCH' as const,
        elementUuid: 'a-3',
        elementLabel: 'New conflict',
        detail: 'Appeared since analysis.',
      },
    ];
    const api = makeApiStub({
      analyzeImport: vi.fn().mockReturnValue(of(cleanReport)),
      commitImport: vi
        .fn()
        .mockReturnValue(
          throwError(
            () =>
              new HttpErrorResponse({ status: 409, error: { conflicts: freshConflicts } }),
          ),
        ),
    });
    await render(ProjectSettingsImportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ImportExportService, useValue: api },
      ],
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    selectFile(input, zipFile());
    await waitFor(() => expect(screen.getByText('No conflicts found')).toBeTruthy());

    screen.getByRole('button', { name: 'Import' }).click();

    await waitFor(() =>
      expect(
        screen.getByText(/Conflicts changed since you last checked this archive/),
      ).toBeTruthy(),
    );
    expect(screen.queryByText('Generic error')).toBeNull();
    expect(screen.getByText('Blocking issues')).toBeTruthy();
    const importBtn = screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
  });

  /** M25: a pre-record-set archive — its records are rejected on their own, everything else imports. */
  it('lists records outside a record set as not imported and still lets the import proceed', async () => {
    const report: ConflictReportView = {
      hasBlocking: true,
      blocksImport: false,
      conflicts: [
        {
          severity: 'BLOCKING',
          type: 'RECORD_OUTSIDE_RECORD_SET',
          elementUuid: 'r-ada',
          elementLabel: 'Ada',
          detail: 'Not imported: records from before record sets are not migrated.',
          blocksImport: false,
        },
        {
          severity: 'WARNING',
          type: 'RECORD_SET_QUERY_INVALID',
          elementUuid: 's-leads',
          elementLabel: 'Leads',
          detail: 'The set query does not fit the schema.',
          blocksImport: false,
        },
      ],
    };
    const api = makeApiStub({
      analyzeImport: vi.fn().mockReturnValue(of(report)),
      commitImport: vi.fn().mockReturnValue(of(importResult)),
    });
    await render(ProjectSettingsImportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: ImportExportService, useValue: api }],
    });

    selectFile(document.querySelector('input[type="file"]') as HTMLInputElement, zipFile());

    await waitFor(() => expect(screen.getByRole('heading', { name: /Not imported/ })).toBeTruthy());
    expect(screen.queryByText('Blocking issues')).toBeNull();
    const ada = screen.getByText('Ada').closest('li')!;
    expect(ada.textContent).toContain('Record will not be imported');
    expect(screen.getByText('Leads').closest('li')!.querySelector('sf-icon')!.textContent!.trim()).toBe('filter_alt_off');

    const importBtn = screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(false);
    importBtn.click();
    expect(api.commitImport).toHaveBeenCalledWith('proj', expect.any(File), false);
  });

  it('keeps Import disabled when a conflict refuses the whole import next to rejected records', async () => {
    const report: ConflictReportView = {
      hasBlocking: true,
      blocksImport: true,
      conflicts: [
        { severity: 'BLOCKING', type: 'RECORD_OUTSIDE_RECORD_SET', elementLabel: 'Ada', detail: '', blocksImport: false },
        { severity: 'BLOCKING', type: 'RECORD_SET_MISSING', elementLabel: 'Bob', detail: '', blocksImport: true },
      ],
    };
    const api = makeApiStub({ analyzeImport: vi.fn().mockReturnValue(of(report)) });
    await render(ProjectSettingsImportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: ImportExportService, useValue: api }],
    });

    selectFile(document.querySelector('input[type="file"]') as HTMLInputElement, zipFile());

    await waitFor(() => expect(screen.getByText('Blocking issues')).toBeTruthy());
    expect(screen.getByText('Bob').closest('section')!.textContent).toContain('Blocking issues');
    expect(screen.getByText('Ada').closest('section')!.textContent).toContain('Not imported');
    expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('gives each record-set conflict (M25) its own icon', async () => {
    const types = [
      'RECORD_SET_DATASET_MISSING',
      'RECORD_SET_MISSING',
      'RECORD_SET_DATASET_MISMATCH',
      'RECORD_OUTSIDE_RECORD_SET',
      'RECORD_SET_QUERY_INVALID',
    ];
    const report: ConflictReportView = {
      hasBlocking: true,
      conflicts: types.map((type, i) => ({ severity: 'BLOCKING', type, elementUuid: `r-${i}`, elementLabel: type, detail: '' })),
    };
    const api = makeApiStub({ analyzeImport: vi.fn().mockReturnValue(of(report)) });
    await render(ProjectSettingsImportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: ImportExportService, useValue: api }],
    });

    selectFile(document.querySelector('input[type="file"]') as HTMLInputElement, zipFile());
    await waitFor(() => expect(screen.getByText('RECORD_OUTSIDE_RECORD_SET')).toBeTruthy());

    const icons = types.map((type) => screen.getByText(type).closest('li')!.querySelector('sf-icon')!.textContent!.trim());
    expect(icons).toEqual(['dataset_linked', 'table_rows', 'rule', 'move_item', 'filter_alt_off']);
  });
});
