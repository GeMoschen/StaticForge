import '@angular/compiler';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { PageEditorComponent } from './page-editor.component';

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
  };
  TestBed.overrideComponent(PageEditorComponent, {
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
  return result;
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

  it('does not stay open on the next page', async () => {
    const { rerender } = await renderEditor();

    await rerender({ componentInputs: { projectKey: 'proj', uuid: 'page-2' } });

    await screen.findByRole('button', { name: 'Contact' });
    expect(screen.queryByText('Display name')).toBeNull();
  });
});
