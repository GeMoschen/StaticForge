import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { ContentService } from '../content/content.service';
import { SUMMARIES, TREE } from './templates-fixtures.testing';
import { NEW_DATASET_CONTENT, TemplatesItemActions } from './templates-item-actions.service';
import { type TemplateEntry, buildTemplatesIndex } from './templates-tree.util';
import { TemplatesService } from './templates.service';

/** The changes the Templates tree and folder table share (M35.21). */

const index = buildTemplatesIndex(TREE, SUMMARIES);
const entry = (uuid: string): TemplateEntry => index.entries.get(uuid)!;

function setup(options: { confirm?: boolean; usages?: Record<string, unknown[]> } = {}) {
  const api = {
    assetUsages: vi.fn((_key: string, uuid: string) => of(options.usages?.[uuid] ?? [])),
    deleteFolder: vi.fn().mockReturnValue(of(undefined)),
    restoreFolder: vi.fn().mockReturnValue(of({})),
    moveAsset: vi.fn().mockReturnValue(of({})),
    renameAsset: vi.fn().mockReturnValue(of({ revision: 9 })),
    renameFolder: vi.fn().mockReturnValue(of({ revision: 3 })),
    changeUid: vi.fn().mockReturnValue(of({ oldUid: 'x', newUid: 'chosen' })),
  };
  const templates = {
    delete: vi.fn().mockReturnValue(of(undefined)),
    restore: vi.fn().mockReturnValue(of({})),
    get: vi.fn().mockReturnValue(
      of({
        contentCdl: 'editor text title { }',
        bodiesCdl: 'body main { }',
        rulesCdl: '',
        channelTemplates: { html: { source: '<p/>' } },
        category: 'Blog',
        deprecated: false,
        outputPath: { html: 'index.html' },
        paginationPath: {},
        abstract: false,
      }),
    ),
    create: vi.fn().mockReturnValue(of({ uuid: 'new-1', uid: 'derived' })),
  };
  const content = {
    deleteDataset: vi.fn().mockReturnValue(of(undefined)),
    restoreDataset: vi.fn().mockReturnValue(of({})),
    getDataset: vi.fn().mockReturnValue(of({ contentCdl: 'editor text name { }', rulesCdl: '', titleEditor: 'name', description: 'd', channelTemplates: { html: '<li/>' } })),
    createDataset: vi.fn().mockReturnValue(of({ uuid: 'ds-new', uid: 'derived' })),
  };
  const confirm = vi.fn().mockResolvedValue(options.confirm ?? true);
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: TemplatesService, useValue: templates },
      { provide: ContentService, useValue: content },
      { provide: ConfirmService, useValue: { confirm } },
    ],
  });
  return { actions: TestBed.inject(TemplatesItemActions), api, templates, content, confirm, toasts: TestBed.inject(ToastService) };
}

describe('TemplatesItemActions', () => {
  describe('the delete question', () => {
    it('names the pages and other things that use the template', async () => {
      const { actions, confirm } = setup({
        usages: { article: [{ fromType: 'PAGE', fromUuid: 'p1' }, { fromType: 'PAGE', fromUuid: 'p2' }, { fromType: 'PAGE_TEMPLATE', fromUuid: 'other' }] },
      });

      await actions.confirmDelete('proj', [entry('article')], index);

      const question = confirm.mock.calls[0][0];
      expect(question.message).toContain('In use by 2 pages and 1 other template or record set.');
      expect(question.message).toContain('may break on the next build');
      expect(question.tone).toBe('danger');
      expect(question.title).toBe('Delete “Article”?');
      // One item, used by 3 things: the list says so even for a single item.
      expect(question.details).toEqual(['Article — used by 3 things']);
    });

    it('asks plainly, without a usage line, when nothing uses the items', async () => {
      const { actions, confirm, api } = setup();

      await actions.confirmDelete('proj', [entry('post')], index);

      // usedByCount 0: no lookup at all.
      expect(api.assetUsages).not.toHaveBeenCalled();
      expect(confirm.mock.calls[0][0].message).not.toContain('In use by');
    });

    it('says a folder goes with everything inside and counts what uses the templates in it, apart from the items going too', async () => {
      const { actions, confirm } = setup({
        usages: {
          article: [{ fromType: 'PAGE', fromUuid: 'p1' }, { fromType: 'PAGE_TEMPLATE', fromUuid: 'post' }],
          post: [{ fromType: 'PAGE', fromUuid: 'p1' }],
        },
      });

      await actions.confirmDelete('proj', [entry('pt')], index);

      const message = confirm.mock.calls[0][0].message as string;
      expect(message).toContain('Folders are deleted with everything inside them.');
      // p1 counts once; "post" is deleted together with its folder, so it does not count as a user.
      expect(message).toContain('In use by 1 page.');
    });

    it('needs the word typed from 25 items on', async () => {
      const { actions, confirm } = setup();
      const many = Array.from({ length: 25 }, (_, i) => ({ ...entry('post'), uuid: `t${i}`, usedByCount: 0 }));

      await actions.confirmDelete('proj', many, index);

      expect(confirm.mock.calls[0][0].typeToConfirm).toBe('delete');
    });
  });

  describe('deleting and taking it back', () => {
    it('deletes each kind through its own endpoint and restores it the same way', async () => {
      const { actions, api, templates, content } = setup();

      const change = await actions.delete('proj', [entry('article'), entry('teaser'), entry('products'), entry('blog')]);

      expect(change.failed).toBe(false);
      expect(templates.delete).toHaveBeenCalledWith('page', 'proj', 'article');
      expect(templates.delete).toHaveBeenCalledWith('section', 'proj', 'teaser');
      expect(content.deleteDataset).toHaveBeenCalledWith('proj', 'products');
      expect(api.deleteFolder).toHaveBeenCalledWith('proj', 'blog', true);

      await actions.runUndo(change.steps);
      expect(templates.restore).toHaveBeenCalledWith('page', 'proj', 'article');
      expect(templates.restore).toHaveBeenCalledWith('section', 'proj', 'teaser');
      expect(content.restoreDataset).toHaveBeenCalledWith('proj', 'products');
      expect(api.restoreFolder).toHaveBeenCalledWith('proj', 'blog');
    });

    it('stops at the first failure; what was deleted stays undoable', async () => {
      const { actions, templates } = setup();
      templates.delete.mockReturnValueOnce(of(undefined)).mockReturnValueOnce(throwError(() => new Error('in use')));

      const change = await actions.delete('proj', [entry('article'), entry('teaser'), entry('post')]);

      expect(change.failed).toBe(true);
      expect(change.done.map((e) => e.uuid)).toEqual(['article']);
      expect(change.steps).toHaveLength(1);
      expect(templates.delete).toHaveBeenCalledTimes(2);
    });

    it('says Undone, or that it could not undo', async () => {
      const { actions, toasts, templates } = setup();
      const change = await actions.delete('proj', [entry('article')]);
      await actions.runUndo(change.steps);
      expect(toasts.toasts().at(-1)!.message).toBe('Undone.');

      templates.restore.mockReturnValueOnce(throwError(() => new Error('gone')));
      await actions.runUndo(change.steps);
      expect(toasts.toasts().at(-1)!.kind).toBe('error');
    });
  });

  it('moves through the generic move endpoint and undoes into the folder each entry came from', async () => {
    const { actions, api } = setup();

    const change = await actions.move('proj', [entry('article'), entry('blog')], 'st', (e) => index.parentOf.get(e.uuid) ?? null);

    expect(api.moveAsset).toHaveBeenCalledWith('proj', 'article', { folderUuid: 'st' });
    expect(api.moveAsset).toHaveBeenCalledWith('proj', 'blog', { folderUuid: 'st' });
    await actions.runUndo(change.steps);
    expect(api.moveAsset).toHaveBeenCalledWith('proj', 'article', { folderUuid: 'pt' });
    expect(api.moveAsset).toHaveBeenCalledWith('proj', 'blog', { folderUuid: 'pt' });
  });

  it('renames a folder through the folder endpoint and a template through the asset endpoint, with the etag', () => {
    const { actions, api } = setup();
    actions.rename('proj', entry('blog'), 'Journal', 3).subscribe();
    actions.rename('proj', entry('article'), 'Story', 4).subscribe();
    expect(api.renameFolder).toHaveBeenCalledWith('proj', 'blog', { displayName: 'Journal' }, 3);
    expect(api.renameAsset).toHaveBeenCalledWith('proj', 'article', { displayName: 'Story' }, 4);
  });

  describe('creating', () => {
    it('creates a page or section template empty, in the chosen folder', async () => {
      const { actions, templates } = setup();

      const created = await actions.create('proj', { kind: 'section', name: 'Hero', uid: 'derived', parentFolderUuid: 'st' });

      expect(templates.create).toHaveBeenCalledWith('section', 'proj', expect.objectContaining({ displayName: 'Hero', parentFolderUuid: 'st', channelSources: {} }));
      expect(created).toEqual({ uuid: 'new-1', uid: 'derived', uidApplied: true });
    });

    it('creates a dataset with one starting field', async () => {
      const { actions, content } = setup();

      await actions.create('proj', { kind: 'dataset', name: 'Team', uid: 'derived', parentFolderUuid: 'ds' });

      expect(content.createDataset).toHaveBeenCalledWith('proj', { displayName: 'Team', contentCdl: NEW_DATASET_CONTENT, titleEditor: 'name', parentFolderUuid: 'ds' });
    });

    it('applies a UID the person edited after creating, and says when it could not', async () => {
      const { actions, api } = setup();
      expect(await actions.create('proj', { kind: 'page', name: 'Hero', uid: 'chosen' })).toEqual({ uuid: 'new-1', uid: 'chosen', uidApplied: true });
      expect(api.changeUid).toHaveBeenCalledWith('proj', 'new-1', { uid: 'chosen' });

      api.changeUid.mockReturnValueOnce(throwError(() => new Error('taken')));
      expect(await actions.create('proj', { kind: 'page', name: 'Hero', uid: 'chosen' })).toEqual({ uuid: 'new-1', uid: 'derived', uidApplied: false });
    });
  });

  describe('duplicating', () => {
    it('copies a page template by reading it and creating "<name> copy" next to it, and Undo deletes the copy', async () => {
      const { actions, templates, toasts } = setup();
      const changed = vi.fn();

      const uuid = await actions.duplicate('proj', entry('article'), 'pt', changed);

      expect(uuid).toBe('new-1');
      expect(templates.get).toHaveBeenCalledWith('page', 'proj', 'article');
      expect(templates.create).toHaveBeenCalledWith(
        'page',
        'proj',
        expect.objectContaining({ displayName: 'Article copy', parentFolderUuid: 'pt', contentCdl: 'editor text title { }', channelSources: { html: '<p/>' }, outputPath: { html: 'index.html' }, category: 'Blog' }),
      );
      expect(changed).toHaveBeenCalled();
      const toast = toasts.toasts().at(-1)!;
      expect(toast.action).toBeDefined();
      toast.action!.run();
      await vi.waitFor(() => expect(templates.delete).toHaveBeenCalledWith('page', 'proj', 'new-1'));
    });

    it('copies a dataset with its fields, rules and record templates', async () => {
      const { actions, content } = setup();

      await actions.duplicate('proj', entry('products'), 'ds', vi.fn());

      expect(content.createDataset).toHaveBeenCalledWith(
        'proj',
        expect.objectContaining({ displayName: 'Products copy', contentCdl: 'editor text name { }', channelTemplates: { html: '<li/>' }, parentFolderUuid: 'ds' }),
      );
    });

    it('says so when the copy fails', async () => {
      const { actions, templates, toasts } = setup();
      templates.get.mockReturnValueOnce(throwError(() => new Error('boom')));

      expect(await actions.duplicate('proj', entry('article'), 'pt', vi.fn())).toBeNull();
      expect(toasts.toasts().at(-1)!.kind).toBe('error');
    });
  });
});
