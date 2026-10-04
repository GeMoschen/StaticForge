import '@angular/compiler';
import { EnvironmentInjector, createComponent } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import type { DeletedDataset } from './dataset-editor.component';
import { TemplateEditorComponent } from './template-editor.component';
import { TemplatesSaveCoordinator } from './templates-save.coordinator';
import { TemplatesComponent } from './templates.component';
import { TemplatesStore } from './templates.store';

/** The undo of the templates screen's deletes and moves (M35.13, M35.21). */

const BASE = '/api/v1/projects/proj1';

describe('Templates undo', () => {
  let fixture: ComponentFixture<TemplatesComponent>;
  let http: HttpTestingController;
  let store: TemplatesStore;
  let toasts: ToastService;
  const confirm = vi.fn().mockResolvedValue(true);
  const lastToast = () => toasts.toasts().at(-1)!;

  /** Answers every read the screen makes (the lists are bare arrays or pages), leaving mutating calls alone. */
  function answerReads(): void {
    for (const req of http.match((r) => r.method === 'GET')) {
      req.flush(req.request.url.endsWith('/channels') || req.request.url.endsWith('/datasets') || req.request.url.endsWith('/usages') ? [] : { content: [] });
    }
  }

  beforeEach(() => {
    confirm.mockClear();
    TestBed.configureTestingModule({
      imports: [TemplatesComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideProjectPermissions({ role: () => 'DEVELOPER', readOnly: () => false }),
        { provide: ConfirmService, useValue: { confirm } },
      ],
    });
    fixture = TestBed.createComponent(TemplatesComponent);
    http = TestBed.inject(HttpTestingController);
    store = fixture.debugElement.injector.get(TemplatesStore);
    toasts = TestBed.inject(ToastService);
    // Deleting from the open template leaves it for its folder; the routes are not under test here.
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.componentRef.setInput('projectKey', 'proj1');
    fixture.detectChanges();
    answerReads();
  });

  describe('deleting a template', () => {
    async function deleteTemplate(): Promise<void> {
      store.detail.set({ uuid: 'tpl-1', uid: 'landing', displayName: 'Landing', assetType: 'PAGE_TEMPLATE', revision: 4 } as never);
      store.selectedUuid.set('tpl-1');
      answerReads();
      const deleting = fixture.debugElement.injector.get(TemplatesSaveCoordinator).requestDelete();
      // The confirmation asks what uses the template first.
      (await vi.waitFor(() => http.expectOne({ method: 'GET', url: `${BASE}/assets/tpl-1/usages` }))).flush([]);
      (await vi.waitFor(() => http.expectOne({ method: 'DELETE', url: `${BASE}/page-templates/tpl-1` }))).flush(null);
      await deleting;
    }

    it('offers Undo, and Undo restores the template through its own restore endpoint', async () => {
      await deleteTemplate();
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(lastToast().message).toBe('Deleted “Landing”.');
      expect(lastToast().action).toBeDefined();
      answerReads();

      lastToast().action!.run();

      const restore = await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${BASE}/page-templates/tpl-1/restore` }));
      restore.flush({ uuid: 'tpl-1' });
      await vi.waitFor(() => expect(lastToast().message).toBe('Undone.'));
      // The tree and the list read themselves again.
      await vi.waitFor(() => expect(http.match((r) => r.method === 'GET').length).toBeGreaterThan(0));
    });

    it('shows the error toast when the restore is refused', async () => {
      await deleteTemplate();
      answerReads();

      lastToast().action!.run();
      const restore = await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${BASE}/page-templates/tpl-1/restore` }));
      restore.flush({ detail: 'folder deleted' }, { status: 409, statusText: 'Conflict' });

      await vi.waitFor(() => expect(lastToast().kind).toBe('error'));
      expect(lastToast().message).toMatch(/Could not undo/);
    });

    it('deletes nothing when the confirmation is declined', async () => {
      confirm.mockResolvedValueOnce(false);
      store.detail.set({ uuid: 'tpl-1', uid: 'landing', displayName: 'Landing', assetType: 'PAGE_TEMPLATE', revision: 4 } as never);
      store.selectedUuid.set('tpl-1');
      answerReads();
      const deleting = fixture.debugElement.injector.get(TemplatesSaveCoordinator).requestDelete();
      (await vi.waitFor(() => http.expectOne({ method: 'GET', url: `${BASE}/assets/tpl-1/usages` }))).flush([]);
      await deleting;

      http.expectNone({ method: 'DELETE', url: `${BASE}/page-templates/tpl-1` });
    });
  });

  it('a deleted dataset is brought back through the dataset restore, which the editor offers', async () => {
    const deleted: DeletedDataset = { uuid: 'ds-1', name: 'Team' };
    const editor = createComponent(TemplateEditorComponent, {
      environmentInjector: TestBed.inject(EnvironmentInjector),
      elementInjector: fixture.debugElement.injector,
    });

    (editor.instance as unknown as { onDatasetDeleted(d: DeletedDataset): void }).onDatasetDeleted(deleted);
    answerReads();
    expect(lastToast().message).toBe('Deleted “Team”.');

    lastToast().action!.run();
    const restore = await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${BASE}/datasets/ds-1/restore` }));
    expect(restore.request.body).toEqual({});
    restore.flush({ uuid: 'ds-1' });
    await vi.waitFor(() => expect(lastToast().message).toBe('Undone.'));
    editor.destroy();
  });

  describe('moving in the tree', () => {
    const TREE = [
      {
        uuid: 'root',
        uid: 'templates_root',
        path: '/templates_root/',
        displayName: 'All Templates',
        protectedFolder: true,
        type: 'FOLDER',
        children: [
          {
            uuid: 'f-pages',
            uid: 'page_templates',
            path: '/templates_root/page_templates/',
            displayName: 'Page Templates',
            protectedFolder: true,
            type: 'FOLDER',
            children: [
              { uuid: 'f-sub', uid: 'sub', path: '/templates_root/page_templates/sub/', displayName: 'Sub', type: 'FOLDER', children: [] },
              { uuid: 'f-other', uid: 'other', path: '/templates_root/page_templates/other/', displayName: 'Other', type: 'FOLDER', children: [] },
            ],
          },
        ],
      },
    ];

    function move(source: string, target: string): void {
      const component = fixture.componentInstance as unknown as {
        index(): { entries: Map<string, unknown> };
        onMove(request: unknown): void;
      };
      const entry = component.index().entries.get(source);
      component.onMove({
        nodes: [{ id: source, label: source, data: entry }],
        target: { id: target },
        copy: false,
        via: 'drag',
        completed: (undo?: () => void) => undo && toasts.undo('Moved', undo),
      });
    }

    beforeEach(() => {
      TestBed.inject(ProjectContextStore).templateFolderTree.set(TREE as never);
      store.templates.set([
        { uuid: 'tpl-1', uid: 'landing', assetType: 'PAGE_TEMPLATE', displayName: 'Landing', folderPath: '/templates_root/page_templates/sub/' },
      ] as never);
      store.loaded.set(true);
      fixture.detectChanges();
    });

    it('a template move offers Undo, which moves it back into the folder it came from', async () => {
      move('tpl-1', 'f-other');
      const forward = await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${BASE}/assets/tpl-1/move` }));
      expect(forward.request.body).toEqual({ folderUuid: 'f-other' });
      forward.flush({});
      answerReads();
      await vi.waitFor(() => expect(lastToast().action).toBeDefined());

      lastToast().action!.run();
      const back = await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${BASE}/assets/tpl-1/move` }));
      expect(back.request.body).toEqual({ folderUuid: 'f-sub' });
      back.flush({});
    });

    it('a folder move is undone into its former parent, and the error toast shows when that fails', async () => {
      move('f-sub', 'f-other');
      (await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${BASE}/assets/f-sub/move` }))).flush({});
      answerReads();
      await vi.waitFor(() => expect(lastToast().action).toBeDefined());

      lastToast().action!.run();
      const back = await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${BASE}/assets/f-sub/move` }));
      expect(back.request.body).toEqual({ folderUuid: 'f-pages' });
      back.flush({}, { status: 422, statusText: 'Unprocessable Entity' });

      await vi.waitFor(() => expect(lastToast().kind).toBe('error'));
    });
  });
});
