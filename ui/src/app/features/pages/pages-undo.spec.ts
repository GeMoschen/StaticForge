import '@angular/compiler';
import { provideFavoritesStub } from '../../core/assets/testing/favorites.testing';
import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { PageEditorSectionsService } from './page-editor-sections.service';
import { PageEditorStore } from './page-editor.store';
import { SectionPaletteService } from './section-palette.service';
import { restoreSection } from './section-undo.util';
import type { SectionInstance } from './types';

/** The undo of the destructive page-area operations (M35.13): folders, sections, paste. */

const FOLDER = { uuid: 'folder-a', uid: 'alpha', displayName: 'Alpha', path: '/a/', revision: 4 };
const HERO: SectionInstance = { instanceId: 'inst-1', templateRef: 'tpl-hero', content: { title: 'Welcome' } };

function apiStub(overrides: Record<string, unknown> = {}) {
  return {
    deleteFolder: vi.fn().mockReturnValue(of(undefined)),
    restoreFolder: vi.fn().mockReturnValue(of({})),
    renameFolder: vi.fn().mockReturnValue(of({ revision: 5 })),
    moveAsset: vi.fn().mockReturnValue(of({})),
    pageDetail: vi.fn().mockReturnValue(of({ uuid: 'page-1', revision: 12, bodies: { main: [HERO] }, template: {} })),
    templateDetail: vi.fn().mockReturnValue(of({ effectiveDefinition: { editors: [], bodies: [{ name: 'main' }] } })),
    deleteSection: vi.fn().mockReturnValue(of({ revision: 11 })),
    addSection: vi.fn().mockReturnValue(of({ revision: 13 })),
    ...overrides,
  };
}

const lastToast = (toasts: ToastService) => toasts.toasts().at(-1)!;

describe('page sections', () => {
  it('restoreSection re-inserts the section identically at its index, with the page revision read now as etag', async () => {
    const api = apiStub();

    await new Promise<void>((done) =>
      restoreSection(api as never, 'proj', 'page-1', 'main', HERO, 2).subscribe({ complete: done }),
    );

    expect(api.addSection).toHaveBeenCalledWith(
      'proj',
      'page-1',
      'main',
      { templateUuid: 'tpl-hero', position: 2, instanceId: 'inst-1', content: { title: 'Welcome' } },
      12,
    );
  });
});

describe('page editor sections: remove', () => {
  function setup(api: ReturnType<typeof apiStub>) {
    const editor = {
      readOnly: () => false,
      projectKey: () => 'proj',
      uuid: () => 'page-1',
      sectionsFor: () => [{ instanceId: 'inst-0', templateRef: 'tpl-hero', content: {} }, HERO],
      autosave: { revision: () => 6, flush: vi.fn().mockResolvedValue(true) },
      applyServerPage: vi.fn(),
    };
    const project = { sectionTemplates: signal([{ uuid: 'tpl-hero', displayName: 'Hero' }]), notifyPageChanged: vi.fn() };
    TestBed.configureTestingModule({
      providers: [provideFavoritesStub(), 
        PageEditorSectionsService,
        { provide: ApiClient, useValue: api },
        { provide: ProjectContextStore, useValue: project },
        { provide: PageEditorStore, useValue: editor },
        { provide: SectionPaletteService, useValue: {} },
      ],
    });
    return { editor, service: TestBed.inject(PageEditorSectionsService), toasts: TestBed.inject(ToastService) };
  }

  it('offers Undo, which puts the section back identically at its index and applies the restored page', async () => {
    const api = apiStub({ addSection: vi.fn().mockReturnValue(of({ revision: 14, uuid: 'page-1' })) });
    const { editor, service, toasts } = setup(api);

    service.remove('main', 'inst-1');

    expect(api.deleteSection).toHaveBeenCalledWith('proj', 'page-1', 'main', 'inst-1', 6);
    expect(lastToast(toasts).message).toBe('Removed the section “Hero”.');
    editor.applyServerPage.mockClear();

    lastToast(toasts).action!.run();

    await waitFor(() =>
      expect(api.addSection).toHaveBeenCalledWith(
        'proj',
        'page-1',
        'main',
        { templateUuid: 'tpl-hero', position: 1, instanceId: 'inst-1', content: { title: 'Welcome' } },
        12,
      ),
    );
    // Pending edits were written first, then the page re-read for its current revision.
    expect(editor.autosave.flush).toHaveBeenCalled();
    await waitFor(() => expect(editor.applyServerPage).toHaveBeenCalledWith({ revision: 14, uuid: 'page-1' }));
  });

  it('shows the error toast when the section cannot be put back', async () => {
    const api = apiStub({ addSection: vi.fn().mockReturnValue(throwError(() => new Error('422'))) });
    const { service, toasts } = setup(api);
    service.remove('main', 'inst-1');

    lastToast(toasts).action!.run();

    await waitFor(() => expect(lastToast(toasts).kind).toBe('error'));
  });
});
