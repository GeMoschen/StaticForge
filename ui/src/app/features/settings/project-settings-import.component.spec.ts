import '@angular/compiler';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
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

    expect(api.analyzeImport).toHaveBeenCalledWith('proj', expect.any(File), false, 'KEEP', true);
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

  it('drops a loaded archive when the (reused) screen switches to another project', async () => {
    const api = makeApiStub({ analyzeImport: vi.fn().mockReturnValue(of(cleanReport)) });
    const { fixture } = await render(ProjectSettingsImportComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ImportExportService, useValue: api },
      ],
    });
    selectFile(document.querySelector('input[type="file"]') as HTMLInputElement, zipFile());
    await waitFor(() => expect(screen.getByText('No conflicts found')).toBeTruthy());

    fixture.componentRef.setInput('projectKey', 'other');
    fixture.detectChanges();

    // The report was checked against `proj`: nothing may be committed into `other` with it.
    await waitFor(() => expect(screen.getByText('Choose file…')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
    selectFile(document.querySelector('input[type="file"]') as HTMLInputElement, zipFile());
    await waitFor(() => expect(api.analyzeImport).toHaveBeenLastCalledWith('other', expect.any(File), false, 'KEEP', true));
    expect(api.commitImport).not.toHaveBeenCalled();
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

    expect(api.commitImport).toHaveBeenCalledWith('proj', expect.any(File), false, 'KEEP', true);
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
    expect(api.analyzeImport).toHaveBeenCalledWith('proj', expect.any(File), false, 'KEEP', true);

    const toggle = screen.getByText('Skip ancestor folders that already exist').closest('label')!.querySelector('input')!;
    (toggle as HTMLInputElement).click();
    await vi.advanceTimersByTimeAsync(300);

    await waitFor(() => expect(api.analyzeImport).toHaveBeenCalledWith('proj', expect.any(File), true, 'KEEP', true));

    screen.getByRole('button', { name: 'Import' }).click();
    expect(api.commitImport).toHaveBeenCalledWith('proj', expect.any(File), true, 'KEEP', true);
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
    expect(api.commitImport).toHaveBeenCalledWith('proj', expect.any(File), false, 'KEEP', true);
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

  describe('release state (M27.5.2)', () => {
    // Shapes of the real `POST …/import/analyze` response (`ConflictReportView`): every field the server sends.
    const protocol8Report = (releaseMode: 'KEEP' | 'DRAFT'): ConflictReportView => ({
      conflicts:
        releaseMode === 'KEEP'
          ? [
              {
                severity: 'WARNING',
                type: 'RELEASE_LOCALE_MISSING',
                elementUuid: '0199a0f2-6c1e-7c11-9a3b-1d2e3f405061',
                elementLabel: 'About',
                detail: "Released in 'en', which this project doesn't have: imported as not released there.",
                explicit: true,
                blocksImport: false,
              },
            ]
          : [],
      hasBlocking: false,
      blocksImport: false,
      releaseState: true,
      releaseMode,
    });
    const protocol7Report: ConflictReportView = {
      conflicts: [
        {
          severity: 'INFO',
          type: 'ARCHIVE_WITHOUT_RELEASE_STATE',
          detail: 'This archive has no release state — everything is imported as draft.',
          explicit: true,
          blocksImport: false,
        },
      ],
      hasBlocking: false,
      blocksImport: false,
      releaseState: false,
      releaseMode: 'DRAFT',
    };

    async function renderWith(api: ReturnType<typeof makeApiStub>) {
      await render(ProjectSettingsImportComponent, {
        componentInputs: { projectKey: 'proj' },
        providers: [provideHttpClient(), provideHttpClientTesting(), { provide: ImportExportService, useValue: api }],
      });
      selectFile(document.querySelector('input[type="file"]') as HTMLInputElement, zipFile());
    }

    it('keeps the release state by default and sends KEEP; a missing language is listed with the warnings', async () => {
      const api = makeApiStub({
        analyzeImport: vi.fn().mockReturnValue(of(protocol8Report('KEEP'))),
        commitImport: vi.fn().mockReturnValue(of({ ...importResult, releasedCount: 4 })),
      });
      await renderWith(api);

      const keep = (await screen.findByRole('radio', { name: /Keep release state from the archive/ })) as HTMLInputElement;
      expect(keep.checked).toBe(true);
      expect((screen.getByRole('radio', { name: /Import everything as draft/ }) as HTMLInputElement).checked).toBe(false);
      expect(api.analyzeImport).toHaveBeenCalledWith('proj', expect.any(File), false, 'KEEP', true);
      expect(screen.getByText('About').closest('section')!.textContent).toContain('Warnings');
      expect(screen.getByText('About').closest('li')!.querySelector('sf-icon')!.textContent!.trim()).toBe('translate');

      fireEvent.click(screen.getByRole('button', { name: 'Import' }));
      expect(api.commitImport).toHaveBeenCalledWith('proj', expect.any(File), false, 'KEEP', true);
      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Kept 4 release(s).'));
    });

    it('re-analyzes with DRAFT when switched, and imports as DRAFT', async () => {
      const api = makeApiStub({
        analyzeImport: vi.fn((_key: string, _file: File, _skip: boolean, mode: 'KEEP' | 'DRAFT') => of(protocol8Report(mode))),
        commitImport: vi.fn().mockReturnValue(of(importResult)),
      });
      await renderWith(api);

      fireEvent.click(await screen.findByRole('radio', { name: /Import everything as draft/ }));

      await waitFor(() => expect(api.analyzeImport).toHaveBeenLastCalledWith('proj', expect.any(File), false, 'DRAFT', true));
      // Only a kept release state can miss a language: the warning goes with the switch.
      await waitFor(() => expect(screen.getByText('No conflicts found')).toBeTruthy());
      expect((screen.getByRole('radio', { name: /Import everything as draft/ }) as HTMLInputElement).checked).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: 'Import' }));
      expect(api.commitImport).toHaveBeenCalledWith('proj', expect.any(File), false, 'DRAFT', true);
    });

    it('replaces the choice with a note for an archive without release state and imports it as DRAFT', async () => {
      const api = makeApiStub({
        analyzeImport: vi.fn().mockReturnValue(of(protocol7Report)),
        commitImport: vi.fn().mockReturnValue(of(importResult)),
      });
      await renderWith(api);

      await waitFor(() =>
        expect(screen.getByText('This archive has no release state — everything is imported as draft.')).toBeTruthy(),
      );
      expect(screen.queryByRole('radio')).toBeNull();
      // The info entry is no warning: the archive is still clean.
      expect(screen.getByText('No conflicts found')).toBeTruthy();
      expect(screen.queryByText('Warnings')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Import' }));
      expect(api.commitImport).toHaveBeenCalledWith('proj', expect.any(File), false, 'DRAFT', true);
    });
  });

  describe('schedules (M27.8.2)', () => {
    // Shapes of the real `POST …/import/analyze` and `POST …/import` responses: every field the server sends.
    const ownerReplaced = {
      severity: 'WARNING',
      type: 'SCHEDULE_OWNER_REPLACED',
      elementUuid: '0199a0f2-6c1e-7c11-9a3b-1d2e3f405099',
      elementLabel: 'Release at 2026-10-01T07:00:00Z (2 items): launch',
      detail: "Owned by 'ana' in the archive, but there is no user 'ana' here: the importing user owns it.",
      explicit: true,
      blocksImport: false,
    };
    const overdue = {
      ...ownerReplaced,
      type: 'SCHEDULE_OVERDUE',
      elementUuid: '0199a0f2-6c1e-7c11-9a3b-1d2e3f405098',
      elementLabel: 'Generation at 2026-09-01T03:00:00Z',
      detail: 'Not imported: its time (2026-09-01T03:00:00Z) has passed.',
    };
    const reportWith = (scheduleCount: number, importSchedules: boolean): ConflictReportView => ({
      conflicts: importSchedules && scheduleCount > 0 ? [ownerReplaced] : [],
      hasBlocking: false,
      blocksImport: false,
      releaseState: true,
      releaseMode: 'KEEP',
      scheduleCount,
    });
    const resultWithSchedules: ImportResultView = {
      ...importResult,
      releasedCount: 0,
      importedScheduleCount: 2,
      updatedScheduleCount: 1,
      scheduleWarnings: [overdue],
    };

    async function renderWith(api: ReturnType<typeof makeApiStub>) {
      await render(ProjectSettingsImportComponent, {
        componentInputs: { projectKey: 'proj' },
        providers: [provideHttpClient(), provideHttpClientTesting(), { provide: ImportExportService, useValue: api }],
      });
      selectFile(document.querySelector('input[type="file"]') as HTMLInputElement, zipFile());
    }

    it('offers no schedule choice for an archive without schedules', async () => {
      const api = makeApiStub({ analyzeImport: vi.fn().mockReturnValue(of(reportWith(0, true))) });
      await renderWith(api);

      await screen.findByRole('radio', { name: /Keep release state from the archive/ });
      expect(screen.queryByText('Schedules')).toBeNull();
      expect(screen.queryByRole('radio', { name: /schedule/i })).toBeNull();
    });

    it('imports the schedules by default, lists their warnings, and shows what the import did with them', async () => {
      const api = makeApiStub({
        analyzeImport: vi.fn().mockReturnValue(of(reportWith(3, true))),
        commitImport: vi.fn().mockReturnValue(of(resultWithSchedules)),
      });
      await renderWith(api);

      const importThem = (await screen.findByRole('radio', { name: /Import the archive's 3 schedule\(s\)/ })) as HTMLInputElement;
      expect(importThem.checked).toBe(true);
      expect(api.analyzeImport).toHaveBeenCalledWith('proj', expect.any(File), false, 'KEEP', true);
      const warning = screen.getByText(ownerReplaced.elementLabel).closest('li')!;
      expect(warning.closest('section')!.textContent).toContain('Warnings');
      expect(warning.querySelector('sf-icon')!.textContent!.trim()).toBe('person');
      expect(warning.textContent).not.toContain('explicit');

      fireEvent.click(screen.getByRole('button', { name: 'Import' }));
      expect(api.commitImport).toHaveBeenCalledWith('proj', expect.any(File), false, 'KEEP', true);
      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Imported 2 schedule(s), replaced 1.'));
      const skipped = screen.getByText(overdue.elementLabel).closest('li')!;
      expect(skipped.closest('section')!.textContent).toContain('Schedules');
      expect(skipped.textContent).toContain('its time (2026-09-01T03:00:00Z) has passed');
      expect(skipped.querySelector('sf-icon')!.textContent!.trim()).toBe('event_busy');
    });

    it("re-analyzes without schedules when switched to 'Don't import', commits that, and resets for a new archive", async () => {
      const api = makeApiStub({
        analyzeImport: vi.fn((_key: string, _file: File, _skip: boolean, _mode: 'KEEP' | 'DRAFT', schedules: boolean) =>
          of(reportWith(3, schedules)),
        ),
        commitImport: vi.fn().mockReturnValue(of({ ...importResult, importedScheduleCount: 0, updatedScheduleCount: 0, scheduleWarnings: [] })),
      });
      await renderWith(api);

      fireEvent.click(await screen.findByRole('radio', { name: /Don't import schedules/ }));

      await waitFor(() => expect(api.analyzeImport).toHaveBeenLastCalledWith('proj', expect.any(File), false, 'KEEP', false));
      await waitFor(() => expect(screen.getByText('No conflicts found')).toBeTruthy());
      expect((screen.getByRole('radio', { name: /Don't import schedules/ }) as HTMLInputElement).checked).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: 'Import' }));
      expect(api.commitImport).toHaveBeenCalledWith('proj', expect.any(File), false, 'KEEP', false);
      await waitFor(() => expect(screen.getByText('Choose file…')).toBeTruthy());
      expect(screen.getByRole('status').textContent).not.toContain('schedule');

      selectFile(document.querySelector('input[type="file"]') as HTMLInputElement, zipFile('next.zip'));
      await waitFor(() => expect(api.analyzeImport).toHaveBeenLastCalledWith('proj', expect.any(File), false, 'KEEP', true));
      expect(((await screen.findByRole('radio', { name: /Import the archive's 3 schedule/ })) as HTMLInputElement).checked).toBe(true);
    });
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
