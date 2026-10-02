import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { TemplatesComponent } from './templates.component';
import { TemplatesSaveCoordinator } from './templates-save.coordinator';
import { TemplatesStore } from './templates.store';
import { TemplatesTreePaneComponent } from './templates-tree-pane.component';
import type { DeletedDataset } from '../content/dataset-schema-editor.component';

/** The undo of the templates screen's deletes and moves (M35.13). */

const BASE = '/api/v1/projects/proj1';

describe('Templates undo', () => {
  let fixture: ComponentFixture<TemplatesComponent>;
  let http: HttpTestingController;
  let store: TemplatesStore;
  let toasts: ToastService;
  const lastToast = () => toasts.toasts().at(-1)!;

  /** Answers every read the screen makes (the lists are bare arrays or pages), leaving mutating calls alone. */
  function answerReads(): void {
    for (const req of http.match((r) => r.method === 'GET')) {
      req.flush(req.request.url.endsWith('/channels') || req.request.url.endsWith('/datasets') || req.request.url.endsWith('/usages') ? [] : { content: [] });
    }
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TemplatesComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(TemplatesComponent);
    http = TestBed.inject(HttpTestingController);
    store = fixture.debugElement.injector.get(TemplatesStore);
    toasts = TestBed.inject(ToastService);
    fixture.componentRef.setInput('projectKey', 'proj1');
    fixture.detectChanges();
    answerReads();
  });

  describe('deleting a template', () => {
    function deleteTemplate(): void {
      store.detail.set({ uuid: 'tpl-1', uid: 'landing', displayName: 'Landing', revision: 4 } as never);
      store.selectedUuid.set('tpl-1');
      answerReads();
      fixture.debugElement.injector.get(TemplatesSaveCoordinator).confirmDeleteAction();
      http.expectOne({ method: 'DELETE', url: `${BASE}/page-templates/tpl-1` }).flush(null);
    }

    it('offers Undo, and Undo restores the template through its own restore endpoint', async () => {
      deleteTemplate();
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
      deleteTemplate();
      answerReads();

      lastToast().action!.run();
      const restore = await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${BASE}/page-templates/tpl-1/restore` }));
      restore.flush({ detail: 'folder deleted' }, { status: 409, statusText: 'Conflict' });

      await vi.waitFor(() => expect(lastToast().kind).toBe('error'));
      expect(lastToast().message).toMatch(/Could not undo/);
    });
  });

  it('a deleted dataset is brought back through the dataset restore, which the screen offers', async () => {
    const deleted: DeletedDataset = { uuid: 'ds-1', name: 'Team' };

    (fixture.componentInstance as unknown as { onDatasetDeleted(d: DeletedDataset): void }).onDatasetDeleted(deleted);
    answerReads();
    expect(lastToast().message).toBe('Deleted “Team”.');

    lastToast().action!.run();
    const restore = await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${BASE}/datasets/ds-1/restore` }));
    expect(restore.request.body).toEqual({});
    restore.flush({ uuid: 'ds-1' });
    await vi.waitFor(() => expect(lastToast().message).toBe('Undone.'));
  });

  describe('moving in the tree', () => {
    const TREE = [
      {
        uuid: 'root',
        path: '/',
        displayName: 'All Templates',
        protectedFolder: true,
        children: [
          { uuid: 'f-pages', path: '/page_templates/', displayName: 'Page Templates', children: [{ uuid: 'f-sub', path: '/page_templates/sub/', displayName: 'Sub', children: [] }] },
          { uuid: 'f-other', path: '/page_templates/other/', displayName: 'Other', children: [] },
        ],
      },
    ];

    function move(source: string, target: string): void {
      const pane = fixture.debugElement.query((d) => d.componentInstance instanceof TemplatesTreePaneComponent).componentInstance;
      pane.moveItemTo({ source, target });
    }

    beforeEach(() => {
      TestBed.inject(ProjectContextStore).templateFolderTree.set(TREE as never);
      store.templates.set([{ uuid: 'tpl-1', uid: 'landing', displayName: 'Landing', folderPath: '/page_templates/sub/' }] as never);
    });

    it('a template move offers Undo, which moves it back into the folder it came from', async () => {
      move('tpl-1', 'f-other');
      const forward = http.expectOne({ method: 'POST', url: `${BASE}/assets/tpl-1/move` });
      expect(forward.request.body).toEqual({ folderUuid: 'f-other' });
      forward.flush({});
      answerReads();
      expect(lastToast().message).toBe('Moved “Landing” to Other.');

      lastToast().action!.run();
      const back = await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${BASE}/assets/tpl-1/move` }));
      expect(back.request.body).toEqual({ folderUuid: 'f-sub' });
      back.flush({});
    });

    it('a folder move is undone into its former parent, and the error toast shows when that fails', async () => {
      move('f-sub', 'f-other');
      http.expectOne({ method: 'POST', url: `${BASE}/assets/f-sub/move` }).flush({});
      answerReads();

      lastToast().action!.run();
      const back = await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${BASE}/assets/f-sub/move` }));
      expect(back.request.body).toEqual({ folderUuid: 'f-pages' });
      back.flush({}, { status: 422, statusText: 'Unprocessable Entity' });

      await vi.waitFor(() => expect(lastToast().kind).toBe('error'));
    });
  });
});
