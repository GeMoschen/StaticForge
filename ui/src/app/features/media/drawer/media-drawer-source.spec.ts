import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpTestingController } from '@angular/common/http/testing';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { LocalesStore } from '../../../core/project/locales.store';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { provideProjectPermissions } from '../../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../../core/ui/toast.service';
import { UnsavedChangesService } from '../../../shared/components/dialog/unsaved-changes.service';
import { codeOf, typeCode } from '../../../shared/code-editor/code-editor.testing';
import { CSS, SVG, flushPending, renderDrawer } from './media-drawer.testing';
import { valuePaths } from './media-drawer-names.store';

type MediaView = components['schemas']['MediaView'];

const CSS_TEXT = '/* brand */\nbody { color: $CMS_VALUE(CMS_GLOBAL.brand.roastColor)$; }\n';

async function setup(options: { detail?: MediaView; text?: string; utf8?: boolean; dev?: boolean; admin?: boolean; localized?: boolean } = {}) {
  const detail = options.detail ?? CSS;
  const result = await renderDrawer({
    detail,
    inputs: { tab: 'source', mediaUids: ['hero_png', 'brand_css'] },
    dev: options.dev,
    answers: { text: options.text ?? CSS_TEXT, utf8: options.utf8 },
    configure: () => {
      TestBed.configureTestingModule({
        providers: [
          provideProjectPermissions({ role: () => (options.admin === false ? 'EDITOR' : 'PROJECT_ADMIN'), readOnly: () => false }),
        ],
      });
    },
  });
  return result;
}

const textbox = () => screen.findByRole('textbox', { name: /^Source of / });
const chip = (label: RegExp | string) => screen.getByRole('button', { name: label });
/** The editor's wrapper: it carries the format the text is highlighted as. */
const formatOf = (box: HTMLElement) => box.closest('.sf-code-editor')?.getAttribute('data-format');
const save = () => screen.getByRole('button', { name: 'Save' });

describe('Source tab of a text file (decisions 102-106)', () => {
  afterEach(() => {
    flushPending(TestBed.inject(HttpTestingController));
    vi.restoreAllMocks();
  });

  describe('the text and its highlighting (103, 104)', () => {
    it('shows the saved text in the code panel, CSS highlighted as CSS', async () => {
      await setup();

      const box = await textbox();
      expect(codeOf(box)).toBe(CSS_TEXT);
      expect(formatOf(box)).toBe('CSS');
      expect(chip(/Highlighted as CSS/)).toBeInTheDocument();
      expect(screen.getByText(/Ctrl\+Space inside an instruction completes global values/)).toBeInTheDocument();
    });

    it('highlights an SVG as XML and names it SVG · XML', async () => {
      await setup({ detail: SVG, text: '<svg></svg>' });

      expect(formatOf(await textbox())).toBe('XML');
      expect(chip(/Highlighted as SVG · XML/)).toBeInTheDocument();
    });

    it('writes the override as a project setting by extension and re-highlights at once', async () => {
      const { http, settle } = await setup();
      const toast = vi.spyOn(TestBed.inject(ToastService), 'show');

      fireEvent.click(chip(/Highlighted as CSS/));
      const menu = await screen.findByRole('menu', { name: 'Highlight this file type as' });
      expect(within(menu).getByRole('group', { name: 'Project setting for .css files' })).toBeInTheDocument();
      expect(within(menu).getAllByText('Detected: CSS').length).toBeGreaterThan(0);
      expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent?.replace(/\s+/g, ' ').replace(/^check/, '').trim())).toEqual([
        expect.stringMatching(/^Auto/),
        'CSS',
        'JavaScript',
        'JSON',
        'XML',
        'Markdown',
        'Plain text',
      ]);

      fireEvent.click(within(menu).getByRole('menuitem', { name: 'JavaScript' }));
      const put = await waitFor(() => http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/projects/proj1/code-highlighting')));
      expect(put.request.body).toEqual({ extensions: { css: 'JAVASCRIPT' }, mimeTypes: {} });
      put.flush({ key: 'proj1', codeHighlighting: { extensions: { css: 'JAVASCRIPT' }, mimeTypes: {} } });
      await settle();

      await waitFor(() => expect(chip(/Highlighted as JavaScript/)).toBeInTheDocument());
      expect(formatOf(await textbox())).toBe('JAVASCRIPT');
      expect(toast).toHaveBeenCalledWith('.css files in this project are now highlighted as JavaScript.', 'success');
      expect(TestBed.inject(ProjectContextStore).project()?.codeHighlighting?.extensions).toEqual({ css: 'JAVASCRIPT' });
    });

    it('Auto removes the override again, keeping what the project set for other types', async () => {
      const { http } = await setup();
      TestBed.inject(ProjectContextStore).project.set({
        key: 'proj1',
        codeHighlighting: { extensions: { css: 'JSON', md: 'PLAIN' }, mimeTypes: { 'text/x-foo': 'XML' } },
      });

      fireEvent.click(await screen.findByRole('button', { name: /Highlighted as JSON/ }));
      fireEvent.click(await screen.findByRole('menuitem', { name: /^Auto/ }));

      const put = await waitFor(() => http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/code-highlighting')));
      expect(put.request.body).toEqual({ extensions: { md: 'PLAIN' }, mimeTypes: { 'text/x-foo': 'XML' } });
      put.flush({ key: 'proj1' });
    });

    it('is disabled with a reason without the project admin’s rights', async () => {
      await setup({ admin: false });

      fireEvent.click(chip(/Highlighted as CSS/));
      const item = await screen.findByRole('menuitem', { name: /JavaScript/ });

      expect(item).toHaveAttribute('aria-disabled', 'true');
      expect(item.getAttribute('aria-describedby')).toBeTruthy();
    });
  });

  describe('banners and language (105)', () => {
    it('too large: the banner with Download and Replace file instead of the editor', async () => {
      const { tabChange } = await setup({ detail: { ...CSS, sizeBytes: 2_000_000 } });

      expect(screen.getByText(/too large to edit here/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: /^Source of / })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Replace file' }));
      await waitFor(() => expect(tabChange).toHaveBeenCalledWith('details'));
    });

    it('not valid UTF-8: the banner above the text', async () => {
      await setup({ text: 'a � b', utf8: false });

      expect(await screen.findByText(/not valid UTF-8/)).toBeInTheDocument();
      expect(codeOf(await textbox())).toContain('�');
    });

    it('mixes line endings: the banner above the editor', async () => {
      await setup({ text: 'one\r\ntwo\nthree\r\n' });

      expect(await screen.findByText(/mixes line endings; saving stores LF/)).toBeInTheDocument();
      expect(await textbox()).toBeInTheDocument();
    });

    it('shows no banner and no Language select for a file with one file for all languages', async () => {
      await setup();
      await textbox();

      expect(screen.queryByText(/mixes line endings|not valid UTF-8|too large/)).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Language of the file' })).not.toBeInTheDocument();
    });

    it('a file per language: the Language select switches the file that is edited, and asks about unsaved edits', async () => {
      const localized = { ...CSS, localized: true };
      const { http, settle } = await setup({ detail: localized });
      await textbox();
      // the project's languages come from the stub of the app: set them directly
      TestBed.inject(LocalesStore).set('proj1', {
        locales: [
          { code: 'en', label: 'English' },
          { code: 'de', label: 'German' },
        ],
        defaultLocale: 'en',
        fallbacks: {},
        defaultWithoutPrefix: true,
      });
      await settle();

      const select = screen.getByRole('combobox', { name: 'Language of the file' });
      expect(select).toHaveDisplayValue(/English \(EN\)/);

      // an unsaved edit raises the leave dialog; Cancel keeps the language and the edit
      typeCode(await textbox(), CSS_TEXT + '/* mine */');
      await waitFor(() => expect(save()).not.toHaveAttribute('aria-disabled', 'true'));
      const confirm = vi.spyOn(TestBed.inject(UnsavedChangesService), 'confirmLeave').mockResolvedValue(false);
      fireEvent.change(select, { target: { value: '1' } });
      await waitFor(() => expect(confirm).toHaveBeenCalled());
      await settle();
      expect(select).toHaveDisplayValue(/English \(EN\)/);
      expect(codeOf(await textbox())).toContain('/* mine */');

      // no edit left: the other language's file is read
      confirm.mockResolvedValue(true).mockImplementation(async (options) => {
        await options.discard?.();
        return true;
      });
      fireEvent.change(select, { target: { value: '1' } });
      const read = await waitFor(() => http.expectOne((r) => r.url.endsWith('/media/media-css/text') && r.params.get('locale') === 'de'));
      read.flush({ text: '/* de */', utf8: true, revision: 5 });
      await settle();
      await waitFor(() => expect(codeOf(screen.getByRole('textbox', { name: /^Source of / }))).toBe('/* de */'));
    });
  });

  describe('saving (decision 47)', () => {
    it('is enabled only while the text differs, and saves it at the file’s revision', async () => {
      const { http, settle, updated } = await setup();
      const box = await textbox();
      expect(save()).toHaveAttribute('aria-disabled', 'true');

      typeCode(box, CSS_TEXT + 'a { b: c; }\n');
      await waitFor(() => expect(save()).not.toHaveAttribute('aria-disabled', 'true'));
      expect(screen.getByRole('tab', { name: /Source/ }).textContent).toContain('•');

      fireEvent.click(save());
      const put = await waitFor(() => http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/media/media-css/text')));
      expect(put.request.body).toEqual({ text: CSS_TEXT + 'a { b: c; }\n' });
      expect(put.request.headers.get('If-Match')).toBe('"rev-5"');
      put.flush({ media: { ...CSS, revision: 6 }, warnings: [] });
      await settle();

      await waitFor(() => expect(save()).toHaveAttribute('aria-disabled', 'true'));
      expect(updated).toHaveBeenCalledWith(expect.objectContaining({ revision: 6 }));
      expect(screen.getByRole('tab', { name: /Source/ }).textContent).not.toContain('•');
    });

    it('keeps what was typed while the save was on its way', async () => {
      const { http, settle } = await setup();
      const box = await textbox();
      typeCode(box, 'first');
      await waitFor(() => expect(save()).not.toHaveAttribute('aria-disabled', 'true'));
      fireEvent.click(save());
      const put = await waitFor(() => http.expectOne((r) => r.method === 'PUT'));

      typeCode(box, 'first and more');
      put.flush({ media: { ...CSS, revision: 6 }, warnings: [] });
      await settle();

      expect(codeOf(await textbox())).toBe('first and more');
      expect(save()).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('refuses to save while the text has errors, and says why', async () => {
      const { settle } = await setup({ detail: { ...CSS, processCms: true } });
      const box = await textbox();
      typeCode(box, '$CMS_VALUE(');
      await new Promise((resolve) => setTimeout(resolve, 450));
      const http = TestBed.inject(HttpTestingController);
      const validate = await waitFor(() => http.expectOne((r) => r.url.endsWith('/text/validate')));
      validate.flush({ diagnostics: [{ severity: 'ERROR', code: 'SF-OCTL-1', message: 'Unclosed instruction', line: 1, column: 1 }] });
      await settle();

      await waitFor(() => expect(screen.getByText('Unclosed instruction')).toBeInTheDocument());
      expect(save()).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(save());
      http.expectNone((r) => r.method === 'PUT');
    });

    it('a conflict asks keep mine or take theirs: keep mine saves again at the newer revision', async () => {
      const { http, settle } = await setup();
      typeCode(await textbox(), 'mine');
      await waitFor(() => expect(save()).not.toHaveAttribute('aria-disabled', 'true'));
      fireEvent.click(save());
      http
        .expectOne((r) => r.method === 'PUT' && r.url.endsWith('/text'))
        .flush({ currentRevision: 9, expectedRevision: 5 }, { status: 409, statusText: 'Conflict' });
      await settle();

      fireEvent.click(await screen.findByRole('button', { name: 'Keep mine' }));
      const again = await waitFor(() => http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/text')));
      expect(again.request.headers.get('If-Match')).toBe('"rev-9"');
      again.flush({ media: { ...CSS, revision: 10 }, warnings: [] });
    });

    it('a conflict can take theirs: the text is read again', async () => {
      const { http, settle } = await setup();
      typeCode(await textbox(), 'mine');
      await waitFor(() => expect(save()).not.toHaveAttribute('aria-disabled', 'true'));
      fireEvent.click(save());
      http
        .expectOne((r) => r.method === 'PUT' && r.url.endsWith('/text'))
        .flush({ currentRevision: 9, expectedRevision: 5 }, { status: 409, statusText: 'Conflict' });
      await settle();

      fireEvent.click(await screen.findByRole('button', { name: 'Take theirs' }));
      await settle();

      await waitFor(() => expect(codeOf(screen.getByRole('textbox', { name: /^Source of / }))).toBe(CSS_TEXT));
      expect(save()).toHaveAttribute('aria-disabled', 'true');
    });

    it('Revert takes the edits back', async () => {
      await setup();
      typeCode(await textbox(), 'changed');
      fireEvent.click(await screen.findByRole('button', { name: 'Revert' }));

      await waitFor(() => expect(codeOf(screen.getByRole('textbox', { name: /^Source of / }))).toBe(CSS_TEXT));
      expect(save()).toHaveAttribute('aria-disabled', 'true');
    });
  });

});

describe('completion names (102)', () => {
  it('lists the scalar values of a global set as dotted paths, without lists', () => {
    expect(valuePaths({ brand: { roastColor: '#6b3f1d', accent: { hue: 20 } }, tags: ['a', 'b'], title: 'T' })).toEqual([
      'brand.roastColor',
      'brand.accent.hue',
      'title',
    ]);
  });
});
