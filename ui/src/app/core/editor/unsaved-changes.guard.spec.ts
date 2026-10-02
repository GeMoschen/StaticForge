import '@angular/compiler';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { fireEvent, screen, within } from '@testing-library/angular';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app.routes';
import { provideTranslocoTesting } from '../i18n/transloco-testing';
import type { SaveResult } from '../../shared/components/dialog/unsaved-changes.service';
import { ActiveEditorService } from './active-editor.service';
import type { EditorStateService } from './editor-state';
import { unsavedChangesGuard } from './unsaved-changes.guard';

@Component({ standalone: true, template: 'page' })
class PageComponent {}

function dirtyEditor(save: () => Promise<SaveResult> = async () => ({ ok: true })) {
  const dirty = signal(true);
  const state: EditorStateService = {
    name: signal('Spring harvest arrives'),
    dirty,
    saving: signal(false),
    lastSaved: signal(null),
    error: signal(null),
    autosave: false,
    save: vi.fn(save),
    discard: vi.fn(async () => dirty.set(false)),
  };
  return state;
}

describe('unsavedChangesGuard', () => {
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideTranslocoTesting(),
        provideRouter([
          { path: 'editor/:id', component: PageComponent, canDeactivate: [unsavedChangesGuard] },
          { path: 'elsewhere', component: PageComponent },
        ]),
      ],
    });
    harness = await RouterTestingHarness.create();
  });

  const url = () => TestBed.inject(Router).url;

  it('lets the person leave an editor with nothing unsaved', async () => {
    await harness.navigateByUrl('/editor/1');
    await harness.navigateByUrl('/elsewhere');
    expect(url()).toBe('/elsewhere');
  });

  it('asks before leaving with unsaved changes; Cancel keeps the person on the page', async () => {
    await harness.navigateByUrl('/editor/1');
    TestBed.inject(ActiveEditorService).register(dirtyEditor());
    const navigation = harness.navigateByUrl('/elsewhere');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Spring harvest arrives/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await navigation;
    expect(url()).toBe('/editor/1');
  });

  it('saves and then leaves', async () => {
    await harness.navigateByUrl('/editor/1');
    const editor = dirtyEditor();
    TestBed.inject(ActiveEditorService).register(editor);
    const navigation = harness.navigateByUrl('/elsewhere');
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }));
    await navigation;
    expect(editor.save).toHaveBeenCalledTimes(1);
    expect(url()).toBe('/elsewhere');
  });

  it('discards and then leaves', async () => {
    await harness.navigateByUrl('/editor/1');
    const editor = dirtyEditor();
    TestBed.inject(ActiveEditorService).register(editor);
    const navigation = harness.navigateByUrl('/elsewhere');
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard' }));
    await navigation;
    expect(editor.discard).toHaveBeenCalledTimes(1);
    expect(url()).toBe('/elsewhere');
  });

  it('asks as well when only the item changes inside the same route (another page, another record)', async () => {
    await harness.navigateByUrl('/editor/1');
    TestBed.inject(ActiveEditorService).register(dirtyEditor());
    const navigation = harness.navigateByUrl('/editor/2');
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await navigation;
    expect(url()).toBe('/editor/1');
  });

  it('does not ask for a change of the query only', async () => {
    await harness.navigateByUrl('/editor/1');
    TestBed.inject(ActiveEditorService).register(dirtyEditor());
    await harness.navigateByUrl('/editor/1?body=main');
    expect(url()).toBe('/editor/1?body=main');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the real route table', () => {
  const find = (path: string, list = routes): (typeof routes)[number] | undefined => {
    for (const route of list) {
      if (route.path === path) {
        return route;
      }
      const inner = route.children ? find(path, route.children) : undefined;
      if (inner) {
        return inner;
      }
    }
    return undefined;
  };

  it('guards every route that hosts an editor: pages, records, templates', () => {
    for (const path of ['pages', 'content', 'templates']) {
      expect(find(path)).toBeDefined();
    }
    expect(find(':uuid')?.canDeactivate).toContain(unsavedChangesGuard);
    expect(find('records/:recordUuid')?.canDeactivate).toContain(unsavedChangesGuard);
    expect(find('templates')?.canDeactivate).toContain(unsavedChangesGuard);
  });
});
