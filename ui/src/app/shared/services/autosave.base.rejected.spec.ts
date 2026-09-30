import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutosaveService, rejectedByRules } from './autosave.base';

interface View {
  revision?: number | null;
}

@Injectable()
class TestAutosave extends AutosaveService<{ title: string }, View> {
  readonly answers: Subject<View>[] = [];

  protected persist(): Observable<View> {
    const answer = new Subject<View>();
    this.answers.push(answer);
    return answer;
  }

  protected reload(): Observable<View> {
    return of({ revision: 1 });
  }
}

const RULE_REJECTION = new HttpErrorResponse({
  status: 422,
  error: {
    code: 'SF-API-0422',
    issues: [
      { path: 'content.title', code: 'rule', severity: 'ERROR', kind: 'COMPLETENESS', message: 'Replace the placeholder', rule: 'no-tbd' },
      { path: 'content.title', code: 'rule', severity: 'WARNING', kind: 'COMPLETENESS', message: 'Long title', rule: 'short' },
    ],
  },
});

describe('AutosaveService — rule rejections (M33.8)', () => {
  let autosave: TestAutosave;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [TestAutosave] });
    autosave = TestBed.inject(TestAutosave);
    autosave.configure('proj', 'page-1', 3, 100);
    autosave.setPayloadProvider(() => ({ title: 'TBD' }));
  });

  afterEach(() => vi.useRealTimers());

  it('keeps the edits, reports the findings and saves again after the next change', () => {
    const errors: unknown[] = [];
    autosave.setErrorHandler((err) => errors.push(err));

    autosave.markDirty();
    vi.advanceTimersByTime(100);
    autosave.answers[0].error(RULE_REJECTION);

    expect(autosave.saveState()).toBe('rejected');
    expect(autosave.rejected().map((f) => f.rule)).toEqual(['no-tbd', 'short']);
    expect(autosave.revision()).toBe(3);
    expect(errors).toEqual([]);

    autosave.markDirty();
    expect(autosave.saveState()).toBe('dirty');
    vi.advanceTimersByTime(100);
    autosave.answers[1].next({ revision: 4 });

    expect(autosave.saveState()).toBe('saved');
    expect(autosave.rejected()).toEqual([]);
    expect(autosave.revision()).toBe(4);
  });

  it('tells a rule rejection from a structural one', () => {
    expect(rejectedByRules(RULE_REJECTION)).toBe(true);
    const structural = new HttpErrorResponse({
      status: 422,
      error: { issues: [{ path: 'content.count', code: 'type', severity: 'ERROR', kind: 'STRUCTURAL' }] },
    });
    expect(rejectedByRules(structural)).toBe(false);
    expect(rejectedByRules(new HttpErrorResponse({ status: 409 }))).toBe(false);
  });
});
