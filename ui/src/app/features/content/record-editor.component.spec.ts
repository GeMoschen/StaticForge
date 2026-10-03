import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfSaveStatusComponent } from '../../shared/components/layout/sf-save-status.component';
import { SfSectionComponent } from '../../shared/components/layout/sf-section.component';
import { SfSkeletonComponent } from '../../shared/components/layout/sf-skeleton.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { HistoryDrawerStore } from '../history/history-drawer.store';
import { ContentService, type DatasetDetailView, type RecordDetailView } from './content.service';
import { RecordEditorHeaderComponent } from './record-editor-header.component';
import { RecordEditorComponent } from './record-editor.component';

/** A record as `GET /records/{uuid}` sends it: the folder store-relative, the set as a reference. */
const RECORD: RecordDetailView = {
  uuid: 'rec-1',
  uid: 'jane',
  displayName: 'Jane',
  revision: 3,
  datasetUuid: 'ds-1',
  datasetUid: 'staff',
  recordSet: { uuid: 'set-1', uid: 'leads', displayName: 'Leads' },
  folderUuid: 'folder-1',
  folderPath: '/staff/',
  content: { name: 'Jane' } as unknown as RecordDetailView['content'],
};

const DATASET = {
  uuid: 'ds-1',
  uid: 'staff',
  displayName: 'Staff',
  titleEditor: 'name',
  compiledDefinition: { editors: [{ name: 'name', type: 'TEXT' }], bodies: [] },
} as unknown as DatasetDetailView;

type Issue = components['schemas']['ContentIssue'];

interface Options {
  record?: RecordDetailView;
  getRecord?: ReturnType<typeof vi.fn>;
  /** Render the real header (without the release group, which has its own spec) instead of leaving it out. */
  header?: boolean;
  /** What the live rules find in the form. */
  findings?: Issue[];
}

async function openRecord(options: Options = {}) {
  const content = {
    getRecord: options.getRecord ?? vi.fn().mockReturnValue(of(options.record ?? RECORD)),
    getDataset: vi.fn().mockReturnValue(of(DATASET)),
    updateRecord: vi.fn().mockReturnValue(of({ ...RECORD, revision: 4 })),
  };
  const api = {
    assetHistory: vi.fn().mockReturnValue(of([])),
    assetUsages: vi.fn().mockReturnValue(of([])),
    evaluateRules: vi.fn().mockReturnValue(of({ findings: options.findings ?? [], fills: [], fieldStates: [] })),
  };
  const frame = { setItem: vi.fn() };
  // The form's widgets, the release group and the dialogs are out of scope: only the editor's own behaviour is.
  TestBed.overrideComponent(RecordEditorComponent, {
    set: {
      imports: [
        TranslocoPipe,
        SfEmptyStateComponent,
        SfSectionComponent,
        SfSkeletonComponent,
        ...(options.header ? [RecordEditorHeaderComponent] : []),
      ],
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  TestBed.overrideComponent(RecordEditorHeaderComponent, {
    set: {
      imports: [SfBadgeComponent, SfButtonComponent, SfPageHeaderComponent, SfSaveStatusComponent, TranslocoPipe],
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const { fixture } = await render(RecordEditorComponent, {
    componentInputs: { projectKey: 'proj', recordUuid: 'rec-1' },
    providers: [
      provideRouter([]),
      { provide: ContentService, useValue: content },
      { provide: ApiClient, useValue: api },
      { provide: EditingLocaleStore, useValue: { binding: signal(null) } },
      { provide: FrameContextStore, useValue: frame },
      { provide: DeveloperModeService, useValue: { enabled: signal(false) } },
      { provide: LocalesStore, useValue: { locales: signal([]) } },
      provideProjectPermissions({ role: () => 'EDITOR', readOnly: () => false }),
    ],
  });
  await waitFor(() => expect(content.getRecord).toHaveBeenCalled());
  return { fixture, content, api, frame };
}

describe('RecordEditorComponent autosave', () => {
  it('appends no revision when a record is only opened and left again', async () => {
    const { fixture, content } = await openRecord();
    await waitFor(() => expect(content.getDataset).toHaveBeenCalled());

    fixture.destroy();

    expect(content.updateRecord).not.toHaveBeenCalled();
  });

  it('saves an unsaved edit when the record is left before the debounce ran', async () => {
    const { fixture, content } = await openRecord();
    await waitFor(() => expect(content.getDataset).toHaveBeenCalled());
    const form = (fixture.componentInstance as unknown as { form: () => FormGroup }).form();
    form.get('name')!.setValue('Janet');

    fixture.destroy();

    expect(content.updateRecord).toHaveBeenCalledTimes(1);
    expect(content.updateRecord.mock.calls[0][2]).toEqual({ content: { name: 'Janet' } });
  });
});

describe('RecordEditorComponent as an editor of the frame (M35.13)', () => {
  const nameField = (fixture: Awaited<ReturnType<typeof openRecord>>['fixture']) =>
    (fixture.componentInstance as unknown as { form: () => FormGroup }).form().get('name')!;

  it('registers while it is open, named by the record, and goes away with it', async () => {
    const { fixture, content } = await openRecord();
    await waitFor(() => expect(content.getDataset).toHaveBeenCalled());
    const editors = TestBed.inject(ActiveEditorService);
    expect(editors.active()?.name()).toBe('Jane');
    expect(editors.active()?.autosave).toBe(true);
    fixture.destroy();
    expect(editors.active()).toBeNull();
  });

  it('is unsaved from the first edit; save() writes it and says so', async () => {
    const { fixture, content } = await openRecord();
    await waitFor(() => expect(content.getDataset).toHaveBeenCalled());
    const editor = TestBed.inject(ActiveEditorService).active()!;
    expect(editor.dirty()).toBe(false);

    nameField(fixture).setValue('Janet');
    expect(editor.dirty()).toBe(true);
    expect(await editor.save()).toEqual({ ok: true });
    expect(content.updateRecord).toHaveBeenCalledTimes(1);
    expect(editor.dirty()).toBe(false);
    expect(editor.lastSaved()).toMatch(/\d/);
  });

  it('keeps the edit unsaved, with a reason, when the write fails; leaving then asks', async () => {
    const { fixture, content } = await openRecord();
    await waitFor(() => expect(content.getDataset).toHaveBeenCalled());
    content.updateRecord.mockReturnValue(throwError(() => new Error('offline')));
    const editor = TestBed.inject(ActiveEditorService).active()!;
    nameField(fixture).setValue('Janet');

    expect(await editor.save()).toEqual({ ok: false, message: 'the server could not save it' });
    expect(editor.dirty()).toBe(true);
    expect(editor.error()).toEqual({ message: 'the server could not save it' });
    expect(TestBed.inject(ActiveEditorService).hasUnsaved()).toBe(true);
  });

  it('discard() gives the waiting edit up: nothing is written and the record is read again', async () => {
    const { fixture, content } = await openRecord();
    await waitFor(() => expect(content.getDataset).toHaveBeenCalled());
    const editor = TestBed.inject(ActiveEditorService).active()!;
    nameField(fixture).setValue('Janet');
    const reads = content.getRecord.mock.calls.length;

    await editor.discard();

    expect(editor.dirty()).toBe(false);
    expect(content.updateRecord).not.toHaveBeenCalled();
    expect(content.getRecord.mock.calls.length).toBeGreaterThan(reads);
    fixture.destroy();
    expect(content.updateRecord).not.toHaveBeenCalled();
  });
});

describe('RecordEditorComponent header (M35.20)', () => {
  it("names the record in the one h1 and says which dataset it is when developer mode shows it", async () => {
    await openRecord({ header: true });

    expect(await screen.findByRole('heading', { level: 1, name: 'Jane' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('never shows the UUID a nameless record is named by: a label with the dataset takes its place', async () => {
    await openRecord({ header: true, record: { ...RECORD, displayName: '3f2b8c1e-5a47-4d0e-9b21-0c6a1f7e8d92' } });

    expect(await screen.findByRole('heading', { level: 1, name: 'Untitled Staff record' })).toBeTruthy();
    expect(TestBed.inject(ActiveEditorService).active()?.name()).toBe('Untitled Staff record');
  });

  it('reports the record to the frame: the folder and the set above it, and the record as the item with history', async () => {
    const { frame } = await openRecord({ header: true });

    await waitFor(() => expect(frame.setItem).toHaveBeenCalledWith(expect.objectContaining({ label: 'Jane' })));
    const item = frame.setItem.mock.calls.map((call) => call[0]).find((value) => value?.label === 'Jane');
    expect(item.asset).toEqual({ uuid: 'rec-1' });
    expect(item.trail).toEqual([
      expect.objectContaining({ label: 'staff', link: ['/p', 'proj', 'content'], queryParams: { folder: 'folder-1' } }),
      expect.objectContaining({ label: 'Leads', link: ['/p', 'proj', 'content', 'sets', 'set-1'] }),
    ]);
  });

  it('opens the History drawer with its button', async () => {
    await openRecord({ header: true });
    const history = TestBed.inject(HistoryDrawerStore);
    history.close();

    fireEvent.click(await screen.findByRole('button', { name: 'History' }));

    await waitFor(() => expect(history.isOpen()).toBe(true));
  });

  it('counts the errors and warnings of the form on the Checks button and opens the drawer with it', async () => {
    const issue: Issue = { path: 'name', severity: 'ERROR', message: 'Required' };
    await openRecord({ header: true, findings: [issue] });

    const button = await screen.findByRole('button', { name: /^Checks/ });
    await waitFor(() => expect(button.textContent).toMatch(/1/));
    expect(button.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('true'));
  });

  it('puts Delete, Move, Used by and Copy link in the ⋮ menu', async () => {
    await openRecord({ header: true });

    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }));

    for (const name of ['Save now', 'Move…', 'Copy link', 'Used by…', 'Delete…']) {
      expect(await screen.findByRole('menuitem', { name })).toBeTruthy();
    }
  });
});

describe('RecordEditorComponent load states (M35.20)', () => {
  it('shows a skeleton while the record loads', async () => {
    const getRecord = vi.fn().mockReturnValue(new Subject<RecordDetailView>());
    await openRecord({ header: true, getRecord });

    expect(document.querySelector('sf-skeleton [aria-busy="true"]')).toBeTruthy();
    expect(screen.getByText('Loading record…')).toBeTruthy();
  });

  it('says so when the record is not found, and leads back to the content', async () => {
    const getRecord = vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    await openRecord({ getRecord });
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    expect(await screen.findByRole('heading', { level: 2, name: 'Record not found' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to content' }));

    expect(navigate).toHaveBeenCalledWith(['/p', 'proj', 'content']);
  });

  it('offers a retry when the record cannot be read, and shows it once the read works', async () => {
    const getRecord = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
      .mockReturnValue(of(RECORD));
    await openRecord({ header: true, getRecord });

    expect(await screen.findByRole('heading', { level: 2, name: 'Could not load the record' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Jane' })).toBeTruthy();
  });
});
