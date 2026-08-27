import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
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
      type: 'DUPLICATE_UUID',
      elementUuid: 'a-1',
      elementLabel: 'Home page',
      detail: 'An element with this UUID already exists.',
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
  importedBlobCount: 2,
};

describe('ProjectSettingsImportComponent', () => {
  it('disables Import and shows the blocking section first when analysis finds a blocking conflict', async () => {
    const api = makeApiStub({ analyzeImport: vi.fn().mockReturnValue(of(blockingReport)) });
    await render(ProjectSettingsImportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [{ provide: ImportExportService, useValue: api }],
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

    const importBtn = screen.getByText('Import').closest('button') as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
  });

  it('shows the success state and an enabled Import button for a clean archive', async () => {
    const api = makeApiStub({ analyzeImport: vi.fn().mockReturnValue(of(cleanReport)) });
    await render(ProjectSettingsImportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [{ provide: ImportExportService, useValue: api }],
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    selectFile(input, zipFile());

    await waitFor(() => expect(screen.getByText('No conflicts found')).toBeTruthy());
    const importBtn = screen.getByText('Import').closest('button') as HTMLButtonElement;
    expect(importBtn.disabled).toBe(false);
  });

  it('clears the file/report on Cancel with no additional network calls', async () => {
    const api = makeApiStub({ analyzeImport: vi.fn().mockReturnValue(of(cleanReport)) });
    await render(ProjectSettingsImportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [{ provide: ImportExportService, useValue: api }],
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
      providers: [{ provide: ImportExportService, useValue: api }],
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    selectFile(input, zipFile());
    await waitFor(() => expect(screen.getByText('No conflicts found')).toBeTruthy());

    screen.getByText('Import').click();

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
      providers: [{ provide: ImportExportService, useValue: api }],
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    selectFile(input, zipFile());
    await waitFor(() => expect(screen.getByText('implicit')).toBeTruthy());
    expect(api.analyzeImport).toHaveBeenCalledWith('proj', expect.any(File), false);

    const toggle = screen.getByText('Skip ancestor folders that already exist').closest('label')!.querySelector('input')!;
    (toggle as HTMLInputElement).click();
    await vi.advanceTimersByTimeAsync(300);

    await waitFor(() => expect(api.analyzeImport).toHaveBeenCalledWith('proj', expect.any(File), true));

    screen.getByText('Import').click();
    expect(api.commitImport).toHaveBeenCalledWith('proj', expect.any(File), true);
    vi.useRealTimers();
  });

  it('shows a distinct message rather than a generic error on a 409-on-commit', async () => {
    const freshConflicts = [
      {
        severity: 'BLOCKING' as const,
        type: 'DUPLICATE_UUID' as const,
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
      providers: [{ provide: ImportExportService, useValue: api }],
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    selectFile(input, zipFile());
    await waitFor(() => expect(screen.getByText('No conflicts found')).toBeTruthy());

    screen.getByText('Import').click();

    await waitFor(() =>
      expect(
        screen.getByText(/Conflicts changed since you last checked this archive/),
      ).toBeTruthy(),
    );
    expect(screen.queryByText('Generic error')).toBeNull();
    expect(screen.getByText('Blocking issues')).toBeTruthy();
    const importBtn = screen.getByText('Import').closest('button') as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
  });
});
