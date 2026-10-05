import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NO_ERRORS_SCHEMA, Type, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of } from 'rxjs';
import { expect, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfSaveStatusComponent } from '../../shared/components/layout/sf-save-status.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { FolderTrailService } from './folder-trail.service';
import { PageDeleteDialogComponent } from './page-delete-dialog.component';
import { PageEditorComponent } from './page-editor.component';
import { PageEditorHeaderComponent } from './page-editor-header.component';
import { PageSettingsComponent } from './page-settings.component';

type PageView = components['schemas']['PageView'];

/** A page as `GET /pages/{uuid}` sends it. */
export function testPage(uuid: string, name: string, extra: Partial<PageView> = {}): PageView {
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
    ...extra,
  };
}

export interface PageEditorHarnessOptions {
  readOnly?: boolean;
  developerMode?: boolean;
  /** The pages `GET /pages/{uuid}` knows, by uuid; `page-1` About and `page-2` Contact by default. */
  pages?: Record<string, PageView>;
}

/**
 * Renders the page editor with only its header and the Page settings drawer real: the heavy children (form, outline,
 * issues, preview, palette, conflict drawer, release bar) are out of scope for the specs of the header and the drawer,
 * which drive the editor through its store.
 */
export async function renderPageEditorShell(options: PageEditorHarnessOptions = {}) {
  const pages = options.pages ?? { 'page-1': testPage('page-1', 'About', { revision: 7 }), 'page-2': testPage('page-2', 'Contact') };
  const api = {
    pageDetail: vi.fn().mockImplementation((_key: string, uuid: string) => of(pages[uuid])),
    evaluateRules: vi.fn().mockReturnValue(of({ findings: [], fills: [], fieldStates: [] })),
    templateDetail: vi.fn().mockReturnValue(of({ uuid: 'tpl-1', effectiveDefinition: { editors: [], bodies: [] } })),
    translationStatus: vi.fn().mockReturnValue(of({ locales: [] })),
    renameAsset: vi.fn().mockReturnValue(of({ displayName: 'Renamed', revision: 2 })),
    duplicateAsset: vi.fn().mockReturnValue(of(testPage('page-3', 'About copy'))),
    deleteAsset: vi.fn().mockReturnValue(of(undefined)),
    updatePage: vi.fn().mockImplementation((_key: string, _uuid: string, payload: Record<string, unknown>) =>
      of({ ...pages['page-1'], nav: payload['nav'], revision: 8 }),
    ),
  };
  TestBed.overrideComponent(PageEditorComponent, {
    set: { imports: [PageEditorHeaderComponent, PageSettingsComponent, TranslocoPipe], schemas: [NO_ERRORS_SCHEMA] },
  });
  TestBed.overrideComponent(PageEditorHeaderComponent, {
    set: {
      imports: [PageDeleteDialogComponent, SfBadgeComponent, SfButtonComponent, SfPageHeaderComponent, SfSaveStatusComponent, TranslocoPipe],
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const result = await render(PageEditorComponent as Type<PageEditorComponent>, {
    componentInputs: { projectKey: 'proj', uuid: 'page-1' },
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ApiClient, useValue: api },
      { provide: TimeTravelStore, useValue: new TimeTravelStore() },
      { provide: ProjectAccessStore, useValue: { readOnly: signal(options.readOnly ?? false), archived: signal(false) } },
      { provide: EditingLocaleStore, useValue: { binding: signal(null) } },
      { provide: LocalesStore, useValue: { locales: signal([]) } },
      { provide: DeveloperModeService, useValue: { enabled: signal(options.developerMode ?? false) } },
      { provide: FolderTrailService, useValue: { trailFor: () => of([]) } },
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
  await screen.findByRole('heading', { level: 1, name: 'About' });
  return { ...result, api, router: TestBed.inject(Router) };
}

/** Opens the Page settings drawer with the header's settings button. */
export async function openSettings(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Page settings' }));
  await screen.findByRole('dialog', { name: 'Page settings' });
}
