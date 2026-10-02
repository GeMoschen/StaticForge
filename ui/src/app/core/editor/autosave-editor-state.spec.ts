import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutosaveService } from '../../shared/services/autosave.base';
import { provideTranslocoTesting } from '../i18n/transloco-testing';
import { autosaveEditorState, autosaveStatus } from './autosave-editor-state';

@Injectable()
class TestAutosave extends AutosaveService<{ title: string }, { revision?: number | null }> {
  result: () => Observable<{ revision?: number | null }> = () => of({ revision: 2 });
  protected persist(): Observable<{ revision?: number | null }> {
    return this.result();
  }
  protected reload(): Observable<{ revision?: number | null }> {
    return of({ revision: 5 });
  }
}

describe('autosaveEditorState', () => {
  let autosave: TestAutosave;
  let reload: ReturnType<typeof vi.fn>;
  let editor: ReturnType<typeof autosaveEditorState>;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [TestAutosave, provideTranslocoTesting()] });
    autosave = TestBed.inject(TestAutosave);
    autosave.configure('proj', 'page-1', 1, 100);
    autosave.setPayloadProvider(() => ({ title: 'T' }));
    reload = vi.fn();
    editor = TestBed.runInInjectionContext(() =>
      autosaveEditorState({ name: () => 'Spring harvest arrives', autosave: autosave as never, reload }),
    );
  });

  afterEach(() => vi.useRealTimers());

  it('is an autosave editor named by the item', () => {
    expect(editor.autosave).toBe(true);
    expect(editor.name()).toBe('Spring harvest arrives');
  });

  it('is clean until the first edit, unsaved from then on, and clean again once written', async () => {
    expect(editor.dirty()).toBe(false);
    autosave.markDirty();
    expect(editor.dirty()).toBe(true);
    expect(editor.saving()).toBe(false);
    expect(await editor.save()).toEqual({ ok: true });
    expect(editor.dirty()).toBe(false);
    expect(editor.lastSaved()).toMatch(/\d/);
    expect(editor.error()).toBeNull();
  });

  it('says why a failed write is not saved, and stays unsaved', async () => {
    autosave.result = () => throwError(() => new HttpErrorResponse({ status: 500 }));
    autosave.markDirty();
    expect(await editor.save()).toEqual({ ok: false, message: 'the server could not save it' });
    expect(editor.dirty()).toBe(true);
    expect(editor.error()).toEqual({ message: 'the server could not save it' });
  });

  it('says a conflict is a conflict', async () => {
    autosave.result = () => throwError(() => new HttpErrorResponse({ status: 409, error: { currentRevision: 7 } }));
    autosave.markDirty();
    expect(await editor.save()).toEqual({ ok: false, message: 'someone else changed it in the meantime' });
    // Saving again while the conflict is open writes nothing and still says why.
    expect(await editor.save()).toEqual({ ok: false, message: 'someone else changed it in the meantime' });
  });

  it('counts the findings that refused a save', async () => {
    autosave.result = () =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 422,
            error: { issues: [{ kind: 'COMPLETENESS', severity: 'ERROR' }, { kind: 'COMPLETENESS', severity: 'ERROR' }, { kind: 'COMPLETENESS', severity: 'WARNING' }] },
          }),
      );
    autosave.markDirty();
    const result = await editor.save();
    expect(result).toEqual({ ok: false, message: '2 errors to fix' });
    expect(editor.error()).toEqual({ message: '2 errors to fix', count: 2 });
    expect(autosaveStatus(autosave)).toEqual({ state: 'error', errorCount: 2 });
  });

  it('discard() gives the edit up — no write — and asks the editor to show the server’s version', async () => {
    autosave.markDirty();
    await editor.discard();
    expect(editor.dirty()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(autosave.saveState()).toBe('idle');
  });
});

describe('autosaveStatus', () => {
  it('maps every state of the autosave to what the header shows', () => {
    const status = (state: string, findings = 0) =>
      autosaveStatus({
        saveState: (() => state) as never,
        rejected: (() => Array.from({ length: findings }, () => ({ severity: 'ERROR' }))) as never,
      });
    expect(status('idle')).toEqual({ state: 'saved', errorCount: 0 });
    expect(status('saved')).toEqual({ state: 'saved', errorCount: 0 });
    expect(status('dirty')).toEqual({ state: 'dirty', errorCount: 0 });
    expect(status('saving')).toEqual({ state: 'saving', errorCount: 0 });
    expect(status('error')).toEqual({ state: 'error', errorCount: 0 });
    expect(status('rejected', 3)).toEqual({ state: 'error', errorCount: 3 });
  });
});
