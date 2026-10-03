import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ToastService } from '../../core/ui/toast.service';
import { UnsavedChangesService } from '../../shared/components/dialog/unsaved-changes.service';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { CSS, PDF, PHOTO, PHOTO_ROW, PNG, SVG, answerReads, flushPending, renderDrawer } from './drawer/media-drawer.testing';
import { MediaDetailDrawerComponent } from './media-detail-drawer.component';
import type { MediaView } from './drawer/media-drawer.store';

interface SetupOptions {
  row?: MediaView;
  detail?: MediaView;
  inputs?: Record<string, unknown>;
  dev?: boolean;
  usages?: unknown[];
}

const setup = (options: SetupOptions = {}) =>
  renderDrawer({ row: options.row, detail: options.detail, inputs: options.inputs, dev: options.dev, answers: { usages: options.usages } });

const drawer = (name = 'Photo') => screen.getByRole('dialog', { name });
const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent?.replace(/\s+/g, ' ').trim());
const altInput = () => screen.getByRole('textbox', { name: /^Alt text/ }) as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
/** `sf-button` keeps a button that has a reason focusable: it is `aria-disabled`, not natively disabled. */
const disabled = (button: HTMLElement) => (button as HTMLButtonElement).disabled || button.getAttribute('aria-disabled') === 'true';

describe('MediaDetailDrawerComponent', () => {
  afterEach(() => {
    flushPending(TestBed.inject(HttpTestingController));
    vi.restoreAllMocks();
  });

  describe('header and tabs (decision 21)', () => {
    it('names the file and shows its facts and its place in the library', async () => {
      await setup();

      expect(drawer()).toBeInTheDocument();
      expect(screen.getByText('JPG · 4000 × 2667 · 1.2 MB')).toBeInTheDocument();
      expect(screen.getByText('2 of 3')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Previous file' })).toHaveAttribute('aria-keyshortcuts', 'ArrowLeft');
      expect(screen.getByRole('button', { name: 'Next file' })).toHaveAttribute('aria-keyshortcuts', 'ArrowRight');
    });

    it('keeps the release status in the release bar only: the header carries no second "New" chip', async () => {
      await setup({ detail: { ...PHOTO, release: { '': { status: 'NEW' } } } });

      expect(drawer().querySelector('.head sf-status')).toBeNull();
      expect(screen.queryByText('New')).toBeNull();
    });

    it('lists its keys on the ? sheet: the stepping keys only with more than one file, the focal keys for a photo', async () => {
      await setup();
      const commands = () => TestBed.inject(ShortcutService).commands().filter((def) => def.id.startsWith('media.'));

      expect(commands().map((def) => [def.id, def.group, def.keys])).toEqual([
        ['media.drawerPrevious', 'mediaDrawer', 'ArrowLeft'],
        ['media.drawerNext', 'mediaDrawer', 'ArrowRight'],
        ['media.drawerClose', 'mediaDrawer', 'Escape'],
        ['media.focalMove', 'mediaFocal', 'ArrowRight'],
        ['media.focalMoveBig', 'mediaFocal', 'Shift+ArrowRight'],
      ]);
    });

    it('lists no stepping keys for a folder of one file and no focal keys for a PNG', async () => {
      await setup({ detail: PNG, inputs: { position: { index: 0, count: 1 } } });

      expect(TestBed.inject(ShortcutService).commands().map((def) => def.id).filter((id) => id.startsWith('media.'))).toEqual(['media.drawerClose']);
    });

    it('shows the tabs that apply to a photo, with the usage count once it is known', async () => {
      await setup({ usages: [{ fromUuid: 'p1', fromUid: 'home', fromType: 'PAGE' }] });

      expect(tabNames()).toEqual(['Details', 'Variants', 'Languages', 'Used by 1', 'Versions']);
    });

    it('shows Processing and Source for text media, and Rendered only while CMS syntax is processed', async () => {
      await setup({ detail: CSS });
      expect(tabNames()).toEqual(['Details', 'Languages', 'Processing', 'Source', 'Used by 0', 'Versions']);
    });

    it('adds Rendered when the text is processed', async () => {
      await setup({ detail: { ...CSS, processCms: true } });
      expect(tabNames()).toEqual(['Details', 'Languages', 'Processing', 'Rendered', 'Source', 'Used by 0', 'Versions']);
    });

    it('shows neither Variants nor the text tabs for a PDF', async () => {
      await setup({ detail: PDF });
      expect(tabNames()).toEqual(['Details', 'Languages', 'Used by 0', 'Versions']);
    });

    it('falls back to Details when the tab the URL names does not apply to the file', async () => {
      await setup({ inputs: { tab: 'source' } });

      expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
      expect(altInput()).toBeInTheDocument();
    });

    it('reports a chosen tab, for the URL', async () => {
      const { tabChange } = await setup();

      fireEvent.click(screen.getByRole('tab', { name: 'Versions' }));

      expect(tabChange).toHaveBeenCalledWith('versions');
    });

    it('keeps the layout of a file that was not read yet from collapsing: a skeleton stands in until it is', async () => {
      const result = await render(MediaDetailDrawerComponent, {
        componentInputs: { projectKey: 'proj1', media: PHOTO_ROW },
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      });
      result.fixture.detectChanges();

      expect(within(screen.getByRole('tabpanel')).getByRole('status')).toBeInTheDocument();
      answerReads(TestBed.inject(HttpTestingController), { detail: PHOTO });
    });
  });

  describe('Details', () => {
    it('shows what the full file says (the list row has no alt text) and offers Save only once something changed', async () => {
      await setup();

      expect(altInput().value).toBe('A photo');
      expect(disabled(saveButton())).toBe(true);
      expect(screen.getByText('Saved')).toBeInTheDocument();

      fireEvent.input(altInput(), { target: { value: 'A better photo' } });

      await waitFor(() => expect(disabled(saveButton())).toBe(false));
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Details/ }).textContent).toContain('•');
    });

    it('is clean again when the edit is typed away, and Revert takes the edits back', async () => {
      await setup();

      fireEvent.input(altInput(), { target: { value: 'A photo!' } });
      await waitFor(() => expect(disabled(saveButton())).toBe(false));
      fireEvent.input(altInput(), { target: { value: 'A photo' } });
      await waitFor(() => expect(disabled(saveButton())).toBe(true));

      fireEvent.input(altInput(), { target: { value: 'Something else' } });
      fireEvent.click(await screen.findByRole('button', { name: 'Revert' }));

      await waitFor(() => expect(altInput().value).toBe('A photo'));
      expect(disabled(saveButton())).toBe(true);
    });

    it('saves the alt text for the file at its revision and is settled afterwards', async () => {
      const { http, settle, updated } = await setup();
      fireEvent.input(altInput(), { target: { value: 'Changed' } });
      await waitFor(() => expect(disabled(saveButton())).toBe(false));

      fireEvent.click(saveButton());
      const put = http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/media/media-1'));
      expect(put.request.body).toMatchObject({ altText: 'Changed', caption: '', copyright: '' });
      expect(put.request.headers.get('If-Match')).toBe('"rev-3"');
      put.flush({ ...PHOTO, revision: 4, altText: 'Changed' });
      await settle();

      await waitFor(() => expect(disabled(saveButton())).toBe(true));
      expect(altInput().value).toBe('Changed');
      expect(updated).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }));
      expect(screen.getByText(/^Saved \d\d:\d\d$/)).toBeInTheDocument();
    });

    it('keeps what was typed while the save was on its way (a reload after a save must not take edits back)', async () => {
      const { http, settle } = await setup();
      fireEvent.input(altInput(), { target: { value: 'First' } });
      await waitFor(() => expect(disabled(saveButton())).toBe(false));
      fireEvent.click(saveButton());
      const put = http.expectOne((r) => r.method === 'PUT');

      fireEvent.input(altInput(), { target: { value: 'First and more' } });
      put.flush({ ...PHOTO, revision: 4, altText: 'First' });
      await settle();

      expect(altInput().value).toBe('First and more');
      expect(disabled(saveButton())).toBe(false);
    });

    it('shows the metadata of another file when the library reuses the drawer for it', async () => {
      const { fixture, http, settle } = await setup();
      fireEvent.input(altInput(), { target: { value: 'unsaved' } });
      const other = { ...PNG, uuid: 'media-2', altText: 'Another photo' };

      fixture.componentRef.setInput('media', other);
      fixture.detectChanges();
      answerReads(http, { detail: other });
      await settle();

      await waitFor(() => expect(altInput().value).toBe('Another photo'));
      expect(disabled(saveButton())).toBe(true);
    });

    it('tells the user alt text and caption belong to the editing language only in a localized project', async () => {
      await setup();
      expect(screen.getByText('Describe the picture for people who can’t see it.')).toBeInTheDocument();
    });
  });

  describe('Details preview and focal point (decision 101)', () => {
    const focalGroup = () => screen.getByRole('group', { name: /^Focal point at/ });

    it('sets the focal point of a photo by clicking the preview and shows it live', async () => {
      await setup();
      vi.spyOn(focalGroup(), 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50, width: 400, height: 200 } as DOMRect);

      fireEvent.click(focalGroup(), { clientX: 200, clientY: 150 });

      await waitFor(() => expect(screen.getByText('Focal point 25 % × 50 %')).toBeInTheDocument());
      await waitFor(() => expect(disabled(saveButton())).toBe(false));
    });

    it('moves it with the arrow keys, 1 % a step and 10 % with Shift', async () => {
      await setup();
      focalGroup().focus();

      fireEvent.keyDown(focalGroup(), { key: 'ArrowRight' });
      await waitFor(() => expect(screen.getByText('Focal point 51 % × 50 %')).toBeInTheDocument());
      fireEvent.keyDown(focalGroup(), { key: 'ArrowDown', shiftKey: true });
      await waitFor(() => expect(screen.getByText('Focal point 51 % × 60 %')).toBeInTheDocument());
    });

    it('saves the focal point as a share of the picture (0..1)', async () => {
      const { http } = await setup();
      fireEvent.keyDown(focalGroup(), { key: 'ArrowLeft', shiftKey: true });
      await waitFor(() => expect(disabled(saveButton())).toBe(false));

      fireEvent.click(saveButton());

      const put = http.expectOne((r) => r.method === 'PUT');
      expect((put.request.body as { focalPoint: { x: number; y: number } }).focalPoint).toEqual({ x: 0.4, y: 0.5 });
      put.flush(PHOTO);
    });

    it('offers numbers for it in developer mode only', async () => {
      await setup({ dev: true });
      expect(screen.getByRole('spinbutton', { name: /Focal point X/ })).toBeInTheDocument();
      expect(screen.getByRole('spinbutton', { name: /Focal point Y/ })).toBeInTheDocument();
    });

    it('has no numeric fields for an editor', async () => {
      await setup();
      expect(screen.queryByRole('spinbutton', { name: /Focal point/ })).not.toBeInTheDocument();
    });

    it('gives a PNG no focal point and says so', async () => {
      await setup({ detail: PNG });

      expect(screen.queryByRole('group', { name: /^Focal point at/ })).not.toBeInTheDocument();
      expect(screen.getByText(/Only photos have a focal point/)).toBeInTheDocument();
    });

    it('lists the developer facts of the file only in developer mode', async () => {
      await setup({ dev: true, inputs: { folderPath: '/media_root/products/' } });

      for (const label of ['UID', 'Path', 'Media type', 'Hash (SHA-256)', 'Storage path']) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
      expect(screen.getByText('/media/products/photo.jpg')).toBeInTheDocument();
      expect(screen.getByText('blobs/ab/12/' + PHOTO.blobSha256)).toBeInTheDocument();
    });

    it('does not list them for an editor', async () => {
      await setup();
      expect(screen.queryByText('Hash (SHA-256)')).not.toBeInTheDocument();
      expect(screen.queryByText('UID')).not.toBeInTheDocument();
    });

    it('says who uploaded the file and when it last changed, from its history', async () => {
      await setup();

      const info = screen.getByRole('heading', { name: 'File' }).nextElementSibling as HTMLElement;
      expect(within(info).getByText('Uploaded').nextElementSibling?.textContent).toContain('Grace');
      expect(within(info).getByText('Modified')).toBeInTheDocument();
    });

    it('shows the text of a text file read-only, and the picture of an SVG', async () => {
      const { settle } = await setup({ detail: { ...CSS } });
      await settle();
      expect(screen.getByRole('textbox', { name: 'Text of brand.css' })).toBeInTheDocument();
    });

    it('shows the picture of an SVG, not its text', async () => {
      await setup({ detail: SVG });
      expect(drawer('Logo').querySelector('.frame__img')).toBeTruthy();
      expect(screen.queryByRole('textbox', { name: /^Text of/ })).not.toBeInTheDocument();
    });

    it('offers Replace with an accept filter for the kind of file', async () => {
      await setup();
      const input = drawer().querySelector('.replace input[type="file"]') as HTMLInputElement;

      expect(input.accept).toBe('image/*');
      expect(screen.getByText('The new file keeps this file’s links, alt text and usages.')).toBeInTheDocument();
    });

    it('asks for the Details tab when Replace is chosen from another tab', async () => {
      const { tabChange } = await setup({ inputs: { tab: 'versions' } });

      fireEvent.click(screen.getByRole('button', { name: 'File actions' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: /Replace…/ }));

      expect(tabChange).toHaveBeenCalledWith('details');
    });

    it('replaces the file with the one that is dropped or chosen, once', async () => {
      const { http, settle, updated } = await setup();
      const toast = vi.spyOn(TestBed.inject(ToastService), 'show');
      const input = drawer().querySelector('.replace input[type="file"]') as HTMLInputElement;
      const file = new File(['x'], 'new.jpg', { type: 'image/jpeg' });

      fireEvent.change(input, { target: { files: [file] } });

      const post = await waitFor(() => http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/media/media-1/replace')));
      expect((post.request.body as FormData).get('file')).toBe(file);
      post.flush({ media: { ...PHOTO, revision: 4 }, warnings: [] });
      await settle();

      await waitFor(() => expect(updated).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 })));
      expect(toast).toHaveBeenCalledWith('Replaced the file with “new.jpg”.', 'success');
      http.expectNone((r) => r.method === 'POST');
    });

    it('does not replace the file while time travel is active', async () => {
      const result = await setup();
      TestBed.inject(TimeTravelStore).enter(5);
      result.fixture.detectChanges();
      const input = drawer().querySelector('.replace input[type="file"]') as HTMLInputElement;

      expect(input.disabled).toBe(true);
    });
  });

  describe('the ⋮ menu', () => {
    it('lists Replace, Rename, Move, Download, Copy link and Delete (danger, last)', async () => {
      await setup();

      fireEvent.click(screen.getByRole('button', { name: 'File actions' }));

      const items = await screen.findAllByRole('menuitem');
      expect(items.map((item) => item.getAttribute('aria-label') ?? item.textContent ?? '').map((text) => text.replace(/^[a-z_]+/, ''))).toEqual([
        expect.stringContaining('Replace…'),
        expect.stringContaining('Rename…'),
        expect.stringContaining('Move…'),
        expect.stringContaining('Download'),
        expect.stringContaining('Copy link'),
        expect.stringContaining('Delete…'),
      ]);
    });

    it('hands rename, move, download and copy link to the library, which owns their dialogs', async () => {
      const { fileAction } = await setup();

      for (const [label, action] of [['Rename…', 'rename'], ['Move…', 'move'], ['Download', 'download'], ['Copy link', 'copyLink']] as const) {
        fireEvent.click(screen.getByRole('button', { name: 'File actions' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(label) }));
        await waitFor(() => expect(fileAction).toHaveBeenLastCalledWith(action));
      }
    });

    it('is read-only while time travel is active: no Replace, Rename, Move or Delete, and no Save', async () => {
      const result = await setup();
      TestBed.inject(TimeTravelStore).enter(5);
      result.fixture.detectChanges();

      fireEvent.click(screen.getByRole('button', { name: 'File actions' }));
      const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent ?? '');

      expect(items.join('|')).not.toMatch(/Replace|Rename|Move|Delete/);
      expect(items.join('|')).toMatch(/Download/);
      expect(disabled(saveButton())).toBe(true);
    });
  });

  describe('stepping (decision 20)', () => {
    it('steps with ← and → while focus is in the header, and not elsewhere', async () => {
      const { step } = await setup();
      const header = drawer().querySelector('.sf-drawer__header') as HTMLElement;

      fireEvent.keyDown(within(header).getByRole('button', { name: 'Next file' }), { key: 'ArrowRight' });
      fireEvent.keyDown(within(header).getByRole('button', { name: 'Previous file' }), { key: 'ArrowLeft' });
      expect(step.mock.calls).toEqual([[1], [-1]]);

      fireEvent.keyDown(altInput(), { key: 'ArrowRight' });
      fireEvent.keyDown(within(header).getByRole('button', { name: 'Next file' }), { key: 'ArrowRight', ctrlKey: true });
      fireEvent.keyDown(within(header).getByRole('button', { name: 'Next file' }), { key: 'ArrowRight', shiftKey: true });
      expect(step).toHaveBeenCalledTimes(2);
    });

    it('steps with the buttons too', async () => {
      const { step } = await setup();

      fireEvent.click(screen.getByRole('button', { name: 'Next file' }));

      expect(step).toHaveBeenCalledWith(1);
    });

    it('has nothing to step to in a folder of one file', async () => {
      await setup({ inputs: { position: { index: 0, count: 1 } } });

      expect(screen.getByRole('button', { name: 'Next file' })).toBeDisabled();
      expect(screen.queryByText(/ of /)).not.toBeInTheDocument();
    });
  });

  describe('unsaved changes (decisions 48 and 97)', () => {
    it('lets the library leave a clean drawer without asking', async () => {
      await setup();
      const unsaved = vi.spyOn(TestBed.inject(UnsavedChangesService), 'confirmLeave');

      expect(await TestBed.inject(ActiveEditorService).canLeave()).toBe(true);
      expect(unsaved).not.toHaveBeenCalled();
    });

    it('asks Save / Discard / Cancel about the edits, and stays when the answer is Cancel', async () => {
      await setup();
      fireEvent.input(altInput(), { target: { value: 'Edited' } });
      await waitFor(() => expect(disabled(saveButton())).toBe(false));
      const confirm = vi.spyOn(TestBed.inject(UnsavedChangesService), 'confirmLeave').mockResolvedValue(false);

      expect(await TestBed.inject(ActiveEditorService).canLeave()).toBe(false);

      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ name: 'Photo' }));
    });

    it('gives the edits up when the dialog discards them', async () => {
      await setup();
      fireEvent.input(altInput(), { target: { value: 'Edited' } });
      await waitFor(() => expect(disabled(saveButton())).toBe(false));
      vi.spyOn(TestBed.inject(UnsavedChangesService), 'confirmLeave').mockImplementation(async (options) => {
        await options.discard?.();
        return true;
      });

      expect(await TestBed.inject(ActiveEditorService).canLeave()).toBe(true);

      await waitFor(() => expect(altInput().value).toBe('A photo'));
    });

    it('saves from the dialog through the drawer’s own save', async () => {
      const { http, settle } = await setup();
      fireEvent.input(altInput(), { target: { value: 'Edited' } });
      await waitFor(() => expect(disabled(saveButton())).toBe(false));
      vi.spyOn(TestBed.inject(UnsavedChangesService), 'confirmLeave').mockImplementation(async (options) => (await options.save()).ok);

      const left = TestBed.inject(ActiveEditorService).canLeave();
      const put = await waitFor(() => http.expectOne((r) => r.method === 'PUT'));
      put.flush({ ...PHOTO, revision: 4, altText: 'Edited' });
      await settle();

      expect(await left).toBe(true);
    });
  });

  describe('deleting (decision 21, item 6)', () => {
    it('asks with what breaks, deletes, closes the drawer through deleted and offers Undo', async () => {
      const { http, deleted, settle } = await setup({
        usages: [
          { fromUuid: 'p1', fromUid: 'home', fromType: 'PAGE' },
          { fromUuid: 'p2', fromUid: 'shop', fromType: 'PAGE' },
        ],
      });

      fireEvent.click(screen.getByRole('button', { name: 'File actions' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: /Delete…/ }));
      await settle();
      answerReads(http, { detail: PHOTO, usages: [{ fromUuid: 'p1', fromUid: 'home', fromType: 'PAGE' }, { fromUuid: 'p2', fromUid: 'shop', fromType: 'PAGE' }] });

      const dialog = await screen.findByRole('dialog', { name: 'Delete “Photo”?' });
      expect(within(dialog).getByText('It is used in 2 places; those links will break.')).toBeInTheDocument();
      expect(within(dialog).getByText('home (PAGE)')).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

      const request = await waitFor(() => http.expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/assets/media-1')));
      request.flush(null);
      await waitFor(() => expect(deleted).toHaveBeenCalledWith('media-1'));
      const toast = TestBed.inject(ToastService).toasts().at(-1)!;
      expect(toast.message).toBe('Deleted “Photo”.');
      expect(toast.action).toBeTruthy();
    });

    it('does not delete when the confirmation is declined', async () => {
      const { http, settle } = await setup();

      fireEvent.click(screen.getByRole('button', { name: 'File actions' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: /Delete…/ }));
      await settle();
      answerReads(http, { detail: PHOTO });
      const dialog = await screen.findByRole('dialog', { name: 'Delete “Photo”?' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      http.expectNone((r) => r.method === 'DELETE');
    });
  });
});
