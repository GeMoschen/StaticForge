import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provideTranslocoTesting } from '../i18n/transloco-testing';
import { ToastService } from './toast.service';
import { UndoService } from './undo.service';

function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideTranslocoTesting()] });
  return { undo: TestBed.inject(UndoService), toasts: TestBed.inject(ToastService) };
}

const last = (toasts: ToastService) => toasts.toasts().at(-1)!;

describe('UndoService', () => {
  let undo: UndoService;
  let toasts: ToastService;
  beforeEach(() => ({ undo, toasts } = setup()));

  it('offers a toast with Undo, which runs the inverse and says it is done', async () => {
    const inverse = vi.fn().mockResolvedValue(undefined);
    undo.offer('Deleted “Spring campaign”.', inverse);
    expect(last(toasts).message).toBe('Deleted “Spring campaign”.');
    expect(last(toasts).action).toBeDefined();
    expect(inverse).not.toHaveBeenCalled();

    last(toasts).action!.run();
    await vi.waitFor(() => expect(inverse).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(last(toasts).message).toBe('Undone.'));
  });

  it('accepts an observable inverse', async () => {
    const calls: string[] = [];
    undo.offer('Moved.', () => {
      calls.push('moved back');
      return of(null);
    });
    last(toasts).action!.run();
    await vi.waitFor(() => expect(calls).toEqual(['moved back']));
    await vi.waitFor(() => expect(last(toasts).message).toBe('Undone.'));
  });

  it('says so in an error toast when the inverse fails', async () => {
    undo.offer('Renamed.', () => Promise.reject(new Error('conflict')));
    last(toasts).action!.run();
    await vi.waitFor(() => expect(last(toasts).kind).toBe('error'));
    expect(last(toasts).message).toMatch(/Could not undo/);
  });

  it('says so when an observable inverse errors', async () => {
    undo.offer('Deleted.', () => throwError(() => new Error('403')));
    last(toasts).action!.run();
    await vi.waitFor(() => expect(last(toasts).kind).toBe('error'));
  });

  it('undoes a group as one, last operation first, one after the other', async () => {
    const order: string[] = [];
    const step = (name: string) => async () => {
      order.push(`${name} start`);
      await Promise.resolve();
      order.push(`${name} end`);
    };
    undo.offerGroup('Deleted 3 pages.', [step('folder'), step('child 1'), step('child 2')]);
    last(toasts).action!.run();
    await vi.waitFor(() => expect(last(toasts).message).toBe('Undone.'));
    expect(order).toEqual(['child 2 start', 'child 2 end', 'child 1 start', 'child 1 end', 'folder start', 'folder end']);
  });

  it('stops a group at the first failure', async () => {
    const later = vi.fn();
    undo.offerGroup('Deleted 2 pages.', [later, () => Promise.reject(new Error('gone'))]);
    last(toasts).action!.run();
    await vi.waitFor(() => expect(last(toasts).kind).toBe('error'));
    expect(later).not.toHaveBeenCalled();
  });
});
