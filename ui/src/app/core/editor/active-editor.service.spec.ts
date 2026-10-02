import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/angular';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provideTranslocoTesting } from '../i18n/transloco-testing';
import { ToastService } from '../ui/toast.service';
import type { SaveResult } from '../../shared/components/dialog/unsaved-changes.service';
import { ActiveEditorService } from './active-editor.service';
import type { EditorError, EditorStateService } from './editor-state';
import { saveStateOf } from './editor-state';

function editor(over: Partial<{ name: string; dirty: boolean; autosave: boolean; error: EditorError | null; save: () => Promise<SaveResult> }> = {}) {
  const dirty = signal(over.dirty ?? false);
  const saving = signal(false);
  const error = signal<EditorError | null>(over.error ?? null);
  const state: EditorStateService = {
    name: signal(over.name ?? 'Spring harvest arrives'),
    dirty,
    saving,
    lastSaved: signal(null),
    error,
    autosave: over.autosave ?? false,
    save: vi.fn(over.save ?? (async () => ({ ok: true }) as SaveResult)),
    discard: vi.fn(async () => dirty.set(false)),
  };
  return { state, dirty, error };
}

const ctrlS = (extra: KeyboardEventInit = {}) =>
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true, ...extra }));

function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideTranslocoTesting()] });
  return TestBed.inject(ActiveEditorService);
}

describe('ActiveEditorService', () => {
  let service: ActiveEditorService;
  beforeEach(() => {
    service = setup();
    TestBed.inject(ToastService).clear();
  });

  describe('Ctrl/Cmd+S', () => {
    it('saves the active editor — the one registered last — once, and keeps the browser from saving the page', () => {
      const first = editor({ dirty: true });
      const second = editor({ dirty: true });
      service.register(first.state);
      service.register(second.state);
      const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(second.state.save).toHaveBeenCalledTimes(1);
      expect(first.state.save).not.toHaveBeenCalled();
    });

    it('also works with ⌘, inside an input, and is not Ctrl+Shift+S', () => {
      const e = editor({ dirty: true });
      service.register(e.state);
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
      expect(e.state.save).toHaveBeenCalledTimes(1);
      ctrlS({ shiftKey: true });
      expect(e.state.save).toHaveBeenCalledTimes(1);
      input.remove();
    });

    it('saves nothing when the active editor has nothing unsaved, and says why when a save is refused', async () => {
      const clean = editor();
      const unregister = service.register(clean.state);
      ctrlS();
      expect(clean.state.save).not.toHaveBeenCalled();
      unregister();

      const refused = editor({ dirty: true, save: async () => ({ ok: false, message: '2 errors' }) });
      service.register(refused.state);
      ctrlS();
      await waitFor(() => expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toBe('2 errors'));
    });

    it('does nothing without an editor, and stops after the editor is unregistered', () => {
      ctrlS();
      const e = editor({ dirty: true });
      service.register(e.state)();
      ctrlS();
      expect(e.state.save).not.toHaveBeenCalled();
    });
  });

  describe('leaving', () => {
    it('lets the person go when nothing is unsaved', async () => {
      service.register(editor().state);
      expect(await service.canLeave()).toBe(true);
      expect(service.hasUnsaved()).toBe(false);
    });

    it('flushes an autosave editor silently, without asking', async () => {
      const e = editor({ dirty: true, autosave: true });
      service.register(e.state);
      expect(await service.canLeave()).toBe(true);
      expect(e.state.save).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('asks when an autosave editor cannot write, and keeps the person on the page on Cancel', async () => {
      const e = editor({ dirty: true, autosave: true, error: { message: '1 error', count: 1 }, save: async () => ({ ok: false, message: '1 error' }) });
      service.register(e.state);
      const left = service.canLeave();
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/Spring harvest arrives/)).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(await left).toBe(false);
    });

    it('asks for an explicit-save editor, and saves, discards or stays', async () => {
      const e = editor({ dirty: true });
      service.register(e.state);

      let left = service.canLeave();
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }));
      expect(await left).toBe(true);
      expect(e.state.save).toHaveBeenCalledTimes(1);

      left = service.canLeave();
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard' }));
      expect(await left).toBe(true);
      expect(e.state.discard).toHaveBeenCalledTimes(1);
    });

    it('keeps the person on the page when the dialog save is refused, and Discard still lets them go', async () => {
      const e = editor({ dirty: true, save: async () => ({ ok: false, message: '2 compile errors' }) });
      service.register(e.state);
      const left = service.canLeave();
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(await within(dialog).findByText(/2 compile errors/)).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
      expect(await left).toBe(true);
    });

    it('counts a refused save as unsaved even when the content is not dirty', () => {
      const e = editor({ error: { message: 'x' } });
      service.register(e.state);
      expect(service.hasUnsaved()).toBe(true);
    });
  });

  describe('closing the tab', () => {
    it('prompts while something is unsaved, and writes what an autosave editor still holds', () => {
      const e = editor({ dirty: true, autosave: true });
      service.register(e.state);
      const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(e.state.save).toHaveBeenCalledTimes(1);
    });

    it('does not prompt when everything is saved', () => {
      service.register(editor().state);
      const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });
  });
});

describe('saveStateOf', () => {
  it('says error before saving before unsaved before saved', () => {
    const e = editor({ dirty: true });
    expect(saveStateOf(e.state)).toBe('dirty');
    (e.state.saving as ReturnType<typeof signal<boolean>>).set(true);
    expect(saveStateOf(e.state)).toBe('saving');
    e.error.set({ message: 'x' });
    expect(saveStateOf(e.state)).toBe('error');
    e.error.set(null);
    (e.state.saving as ReturnType<typeof signal<boolean>>).set(false);
    e.dirty.set(false);
    expect(saveStateOf(e.state)).toBe('saved');
  });
});
