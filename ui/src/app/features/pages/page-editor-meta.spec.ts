import '@angular/compiler';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { PageEditorComponent } from './page-editor.component';
import { PageEditorHeaderComponent } from './page-editor-header.component';

type PageView = components['schemas']['PageView'];

function page(uuid: string, name: string): PageView {
  return {
    uuid,
    uid: name.toLowerCase(),
    displayName: name,
    revision: 1,
    folderPath: '/',
    template: { uuid: 'tpl-1', uid: 'standard', displayName: 'Standard' },
    content: {} as PageView['content'],
    bodies: {} as PageView['bodies'],
    nav: { visible: true, position: 0, noIndex: false } as unknown as PageView['nav'],
    output: {} as PageView['output'],
    meta: {} as PageView['meta'],
  };
}

async function renderEditor() {
  const pages: Record<string, PageView> = { 'page-1': page('page-1', 'About'), 'page-2': page('page-2', 'Contact') };
  const api = {
    pageDetail: vi.fn().mockImplementation((_key: string, uuid: string) => of(pages[uuid])),
    evaluateRules: vi.fn().mockReturnValue(of({ findings: [], fills: [], fieldStates: [] })),
    templateDetail: vi.fn().mockReturnValue(of({ uuid: 'tpl-1', effectiveDefinition: { editors: [], bodies: [] } })),
    translationStatus: vi.fn().mockReturnValue(of({ locales: [] })),
    renameAsset: vi.fn().mockReturnValue(of({ displayName: 'Renamed', revision: 2 })),
  };
  // Only the header is real here: the popover lives in it.
  TestBed.overrideComponent(PageEditorComponent, {
    set: { imports: [PageEditorHeaderComponent], schemas: [NO_ERRORS_SCHEMA] },
  });
  TestBed.overrideComponent(PageEditorHeaderComponent, {
    set: { imports: [SfButtonComponent], schemas: [NO_ERRORS_SCHEMA] },
  });
  const result = await render(PageEditorComponent, {
    componentInputs: { projectKey: 'proj', uuid: 'page-1' },
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: TimeTravelStore, useValue: new TimeTravelStore() },
      { provide: ProjectAccessStore, useValue: { readOnly: signal(false) } },
      { provide: EditingLocaleStore, useValue: { binding: signal(null) } },
      { provide: LocalesStore, useValue: { locales: signal([]) } },
      {
        provide: ProjectContextStore,
        useValue: {
          loadFor: () => of(undefined),
          setActivePage: vi.fn(),
          notifyPageChanged: vi.fn(),
          pageMutated: signal<string | null>(null),
        },
      },
    ],
  });
  fireEvent.click(await screen.findByRole('button', { name: 'About' }));
  await screen.findByText('Display name');
  return { ...result, api };
}

describe('PageEditorComponent: page meta popover', () => {
  it('closes on Escape', async () => {
    await renderEditor();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByText('Display name')).toBeNull());
  });

  it('closes on a press outside, but not on a press inside', async () => {
    await renderEditor();

    fireEvent.mouseDown(screen.getByText('Display name'));
    expect(screen.queryByText('Display name')).not.toBeNull();

    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByText('Display name')).toBeNull());
  });

  it('a rename offers Undo, which renames back on top of the page\'s current revision', async () => {
    const { fixture, api } = await renderEditor();
    const toasts = fixture.debugElement.injector.get(ToastService);

    // The server's copy after the rename (the editor re-reads the page when it changes).
    api.pageDetail.mockReturnValue(of({ ...page('page-1', 'Renamed'), revision: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.input(await screen.findByDisplayValue('About'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.renameAsset).toHaveBeenCalledWith('proj', 'page-1', { displayName: 'Renamed' }, 1));
    expect(toasts.toasts().at(-1)?.message).toBe('Renamed “About” to “Renamed”.');

    api.renameAsset.mockReturnValue(of({ displayName: 'About', revision: 3 }));
    toasts.toasts().at(-1)!.action!.run();
    await waitFor(() => expect(api.renameAsset).toHaveBeenLastCalledWith('proj', 'page-1', { displayName: 'About' }, 2));
  });

  it('shows the error toast when the rename back fails', async () => {
    const { fixture, api } = await renderEditor();
    const toasts = fixture.debugElement.injector.get(ToastService);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.input(await screen.findByDisplayValue('About'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toasts.toasts().at(-1)?.action).toBeDefined());
    api.renameAsset.mockReturnValue(throwError(() => new Error('412')));

    toasts.toasts().at(-1)!.action!.run();

    await waitFor(() => expect(toasts.toasts().at(-1)?.kind).toBe('error'));
  });

  it('does not stay open on the next page', async () => {
    const { rerender } = await renderEditor();

    await rerender({ componentInputs: { projectKey: 'proj', uuid: 'page-2' } });

    await screen.findByRole('button', { name: 'Contact' });
    expect(screen.queryByText('Display name')).toBeNull();
  });
});
