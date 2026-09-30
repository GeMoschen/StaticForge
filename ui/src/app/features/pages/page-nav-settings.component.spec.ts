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
import { PageEditorHeaderComponent } from './page-editor-header.component';
import { PageNavSettingsComponent } from './page-nav-settings.component';

type PageView = components['schemas']['PageView'];

describe('PageNavSettingsComponent', () => {
  it('shows the defaults for a page saved before the settings existed', async () => {
    await render(PageNavSettingsComponent, { componentInputs: { nav: { position: 3 } } });

    expect((screen.getByRole('switch', { name: 'Show in navigation' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('switch', { name: 'Hide from search engines' }) as HTMLInputElement).checked).toBe(false);
  });

  it('emits the whole nav with the toggled member, keeping the others', async () => {
    const navChange = vi.fn();
    await render(PageNavSettingsComponent, {
      componentInputs: { nav: { visible: true, position: 30, label: 'Autumn', noIndex: false } },
      on: { navChange },
    });

    fireEvent.click(screen.getByRole('switch', { name: 'Hide from search engines' }));

    expect(navChange).toHaveBeenCalledWith({ visible: true, position: 30, label: 'Autumn', noIndex: true });
  });

  it('is disabled when read-only', async () => {
    await render(PageNavSettingsComponent, { componentInputs: { nav: { noIndex: true }, disabled: true } });

    const noIndex = screen.getByRole('switch', { name: 'Hide from search engines' }) as HTMLInputElement;
    expect(noIndex.checked).toBe(true);
    expect(noIndex.disabled).toBe(true);
    expect((screen.getByRole('switch', { name: 'Show in navigation' }) as HTMLInputElement).disabled).toBe(true);
  });
});

/** The page as `GET /pages/{uuid}` sends it: `nav` as the page service creates it. */
const PAGE: PageView = {
  uuid: 'page-1',
  uid: 'about',
  displayName: 'About',
  revision: 7,
  folderPath: '/',
  template: { uuid: 'tpl-1', uid: 'standard', displayName: 'Standard' },
  content: {} as PageView['content'],
  bodies: {} as PageView['bodies'],
  nav: { visible: true, position: 0, noIndex: false } as unknown as PageView['nav'],
  output: {} as PageView['output'],
  meta: {} as PageView['meta'],
};

async function renderEditor(readOnly = false) {
  const api = {
    pageDetail: vi.fn().mockReturnValue(of(PAGE)),
    evaluateRules: vi.fn().mockReturnValue(of({ findings: [], fills: [], fieldStates: [] })),
    templateDetail: vi.fn().mockReturnValue(of({ uuid: 'tpl-1', effectiveDefinition: { editors: [], bodies: [] } })),
    translationStatus: vi.fn().mockReturnValue(of({ locales: [] })),
    updatePage: vi.fn().mockImplementation((_key: string, _uuid: string, payload: Record<string, unknown>) =>
      of({ ...PAGE, nav: payload['nav'], revision: 8 }),
    ),
  };
  // The editor's heavy children (preview, release bar, impact, forms) are out of scope here.
  TestBed.overrideComponent(PageEditorComponent, {
    set: { imports: [PageEditorHeaderComponent], schemas: [NO_ERRORS_SCHEMA] },
  });
  TestBed.overrideComponent(PageEditorHeaderComponent, {
    set: { imports: [PageNavSettingsComponent, SfButtonComponent], schemas: [NO_ERRORS_SCHEMA] },
  });
  await render(PageEditorComponent, {
    componentInputs: { projectKey: 'proj', uuid: 'page-1' },
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: TimeTravelStore, useValue: new TimeTravelStore() },
      { provide: ProjectAccessStore, useValue: { readOnly: signal(readOnly) } },
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
  await waitFor(() => expect(api.pageDetail).toHaveBeenCalled());
  fireEvent.click(await screen.findByRole('button', { name: 'About' }));
  return api;
}

describe('PageEditorComponent: navigation and search settings', () => {
  it('saves "Hide from search engines" as nav.noIndex with the page', async () => {
    const api = await renderEditor();

    fireEvent.click(await screen.findByRole('switch', { name: 'Hide from search engines' }));

    await waitFor(() => expect(api.updatePage).toHaveBeenCalledTimes(1));
    const [key, uuid, payload, revision] = api.updatePage.mock.calls[0];
    expect([key, uuid, revision]).toEqual(['proj', 'page-1', 7]);
    expect(payload).toMatchObject({ templateRef: 'tpl-1', nav: { visible: true, position: 0, noIndex: true } });
    await waitFor(() =>
      expect((screen.getByRole('switch', { name: 'Hide from search engines' }) as HTMLInputElement).checked).toBe(true),
    );
  });

  it('saves "Show in navigation" as nav.visible', async () => {
    const api = await renderEditor();

    fireEvent.click(await screen.findByRole('switch', { name: 'Show in navigation' }));

    await waitFor(() => expect(api.updatePage).toHaveBeenCalledTimes(1));
    expect(api.updatePage.mock.calls[0][2]).toMatchObject({ nav: { visible: false, position: 0, noIndex: false } });
  });

  it('offers no change while read-only', async () => {
    const api = await renderEditor(true);

    const noIndex = (await screen.findByRole('switch', { name: 'Hide from search engines' })) as HTMLInputElement;
    expect(noIndex.disabled).toBe(true);
    fireEvent.click(noIndex);
    expect(api.updatePage).not.toHaveBeenCalled();
  });
});
