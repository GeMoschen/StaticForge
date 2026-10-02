import '@angular/compiler';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { render, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ContentService } from './content.service';
import { RecordEditorComponent } from './record-editor.component';

const RECORD = {
  uuid: 'rec-1',
  uid: 'jane',
  displayName: 'Jane',
  revision: 3,
  datasetUuid: 'ds-1',
  content: { name: 'Jane' },
  folderPath: '/staff/',
};

const DATASET = {
  uuid: 'ds-1',
  uid: 'staff',
  titleEditor: 'name',
  compiledDefinition: { editors: [{ name: 'name', type: 'TEXT' }], bodies: [] },
};

async function openRecord() {
  const content = {
    getRecord: vi.fn().mockReturnValue(of(RECORD)),
    getDataset: vi.fn().mockReturnValue(of(DATASET)),
    updateRecord: vi.fn().mockReturnValue(of({ ...RECORD, revision: 4 })),
  };
  const api = {
    assetHistory: vi.fn().mockReturnValue(of([])),
    assetUsages: vi.fn().mockReturnValue(of([])),
    evaluateRules: vi.fn().mockReturnValue(of({ findings: [], fills: [], fieldStates: [] })),
  };
  // The form's widgets, the release bar and the dialogs are out of scope: only the editor's own save behaviour is.
  TestBed.overrideComponent(RecordEditorComponent, { set: { imports: [], schemas: [NO_ERRORS_SCHEMA] } });
  const { fixture } = await render(RecordEditorComponent, {
    componentInputs: { projectKey: 'proj', recordUuid: 'rec-1' },
    providers: [
      { provide: ContentService, useValue: content },
      { provide: ApiClient, useValue: api },
      { provide: EditingLocaleStore, useValue: { binding: signal(null) } },
      { provide: FrameContextStore, useValue: { setItem: vi.fn() } },
      { provide: LocalesStore, useValue: { locales: signal([]) } },
      provideProjectPermissions({ role: () => 'EDITOR', readOnly: () => false }),
    ],
  });
  await waitFor(() => expect(content.getDataset).toHaveBeenCalled());
  return { fixture, content };
}

describe('RecordEditorComponent autosave', () => {
  it('appends no revision when a record is only opened and left again', async () => {
    const { fixture, content } = await openRecord();

    fixture.destroy();

    expect(content.updateRecord).not.toHaveBeenCalled();
  });

  it('saves an unsaved edit when the record is left before the debounce ran', async () => {
    const { fixture, content } = await openRecord();
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
    const { fixture } = await openRecord();
    const editors = TestBed.inject(ActiveEditorService);
    expect(editors.active()?.name()).toBe('Jane');
    expect(editors.active()?.autosave).toBe(true);
    fixture.destroy();
    expect(editors.active()).toBeNull();
  });

  it('is unsaved from the first edit; save() writes it and says so', async () => {
    const { fixture, content } = await openRecord();
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
