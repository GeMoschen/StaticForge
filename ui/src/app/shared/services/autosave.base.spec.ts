import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutosaveService } from './autosave.base';

interface View {
  revision?: number | null;
}

@Injectable()
class TestAutosave extends AutosaveService<{ title: string }, View> {
  readonly persisted: unknown[] = [];
  failNext = false;

  protected persist(payload: { title: string }): Observable<View> {
    this.persisted.push(payload);
    if (this.failNext) {
      this.failNext = false;
      return throwError(() => new HttpErrorResponse({ status: 500 }));
    }
    return of({ revision: 2 });
  }

  protected reload(): Observable<View> {
    return of({ revision: 5 });
  }
}

describe('AutosaveService — nothing pending', () => {
  let autosave: TestAutosave;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [TestAutosave] });
    autosave = TestBed.inject(TestAutosave);
    autosave.configure('proj', 'record-1', 1, 100);
    autosave.setPayloadProvider(() => ({ title: 'T' }));
  });

  afterEach(() => vi.useRealTimers());

  it('does not write when an asset is opened and left again (no edit, no revision)', () => {
    autosave.flush();
    // Ctrl+S with nothing to save is not a save either.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    autosave.ngOnDestroy();
    expect(autosave.persisted).toEqual([]);
  });

  it('writes an edit once, and a repeated flush writes nothing more', () => {
    autosave.markDirty();
    autosave.flush();
    autosave.flush();
    expect(autosave.persisted).toHaveLength(1);
    expect(autosave.saveState()).toBe('saved');
  });

  it('keeps a failed edit pending so the next flush retries it', () => {
    autosave.setErrorHandler(() => undefined);
    autosave.failNext = true;
    autosave.markDirty();
    autosave.flush();
    expect(autosave.saveState()).toBe('error');

    autosave.flush();
    expect(autosave.persisted).toHaveLength(2);
    expect(autosave.saveState()).toBe('saved');
  });

  it('forgets local edits when a conflict is resolved with the server\'s content', () => {
    autosave.markDirty();
    autosave.resolveConflict('theirs');
    autosave.flush();
    expect(autosave.persisted).toEqual([]);
  });

  it('configure() starts the next asset without a pending edit', () => {
    autosave.markDirty();
    autosave.configure('proj', 'record-2', 1, 100);
    autosave.flush();
    expect(autosave.persisted).toEqual([]);
  });
});
