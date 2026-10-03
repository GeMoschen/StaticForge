import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../../../core/ui/toast.service';
import { codeOf } from '../../../../shared/code-editor/code-editor.testing';
import { SampleState } from '../sample-state';
import { SampleMediaAreaComponent } from './sample-media-area.component';
import { MEDIA_FILES, completionNames } from './sample-media-data';

async function setup(query: Record<string, string> = {}) {
  const result = await render(SampleMediaAreaComponent, {
    providers: [
      SampleState,
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
    ],
  });
  TestBed.inject(SampleState).devMode.set(true);
  await screen.findAllByRole('treeitem');
  result.fixture.detectChanges();
  return result;
}

const drawer = (name: string) => screen.findByRole('dialog', { name });
const editor = (detail: HTMLElement) => within(detail).findByRole('textbox', { name: /^Source of / });
/** The editor's wrapper: it carries the format the text is highlighted as. */
const formatOf = (textbox: HTMLElement) => textbox.closest('.sf-code-editor')?.getAttribute('data-format');
const chip = (detail: HTMLElement, label: RegExp | string) => within(detail).getByRole('button', { name: label });

describe('Source tab of a text file (decisions 102-106)', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('completion names (102)', () => {
    it('lists global values, the library’s media UIDs and page paths, without the generated Archive photos', () => {
      const names = completionNames();
      expect(names).toEqual(
        expect.arrayContaining(['#global.brand.roastColor', '#global.brand.accentColor', 'media:hero_texture', 'media:logo', 'page:/shop']),
      );
      expect(names).toContain('page:/news/spring-harvest');
      const archive = MEDIA_FILES.find((f) => f.folderId === 'm-archive')!;
      expect(names).not.toContain(`media:${archive.uid}`);
      expect(new Set(names).size).toBe(names.length);
    });

    it('does not offer the brand.accent global that the Processing tab warns about', () => {
      expect(completionNames()).not.toContain('#global.brand.accent');
    });
  });

  describe('highlighting (103, 104)', () => {
    it('CSS: highlighted as CSS; the logo as SVG · XML; both in the code panel', async () => {
      await setup({ asset: 'a-brand-css', mtab: 'source' });
      const css = await drawer('brand.css');
      expect(formatOf(await editor(css))).toBe('CSS');
      expect(chip(css, /Highlighted as CSS/)).toBeInTheDocument();
    });

    it('SVG: highlighted as XML with the SVG chip', async () => {
      await setup({ asset: 'a-logo', mtab: 'source' });
      const svg = await drawer('lumen-logo.svg');
      expect(formatOf(await editor(svg))).toBe('XML');
      expect(chip(svg, /Highlighted as SVG · XML/)).toBeInTheDocument();
    });

    it('overrides the format for the file type from the menu, naming it a project setting, and re-highlights', async () => {
      await setup({ asset: 'a-brand-css', mtab: 'source' });
      const detail = await drawer('brand.css');
      const textbox = await editor(detail);
      const toast = vi.spyOn(TestBed.inject(ToastService), 'show');

      fireEvent.click(chip(detail, /Highlighted as CSS/));
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
      await waitFor(() => expect(chip(detail, /Highlighted as JavaScript/)).toBeInTheDocument());
      expect(formatOf(textbox)).toBe('JAVASCRIPT');
      expect(toast).toHaveBeenCalledWith(expect.stringContaining('.css files in this project are now highlighted as JavaScript'), expect.anything());

      // Auto goes back to the detected format.
      fireEvent.click(chip(detail, /Highlighted as JavaScript/));
      fireEvent.click(await screen.findByRole('menuitem', { name: /^Auto/ }));
      await waitFor(() => expect(chip(detail, /Highlighted as CSS/)).toBeInTheDocument());
      expect(formatOf(textbox)).toBe('CSS');
    });

    it('`highlight=` applies the override on load, to the Details preview too', async () => {
      await setup({ asset: 'a-brand-css', mtab: 'details', highlight: 'plain' });
      const detail = await drawer('brand.css');
      const preview = await within(detail).findByRole('textbox', { name: /brand\.css/ });
      expect(formatOf(preview)).toBe('PLAIN');
    });

    it('an XML override of the SVG keeps SVG completion; Plain turns it off with the highlighting', async () => {
      await setup({ asset: 'a-logo', mtab: 'source', highlight: 'plain' });
      const svg = await drawer('lumen-logo.svg');
      expect(formatOf(await editor(svg))).toBe('PLAIN');
      expect(chip(svg, /Highlighted as Plain text/)).toBeInTheDocument();
    });
  });

  describe('banners and language (105)', () => {
    it('too large: the banner with Download and Replace file instead of the editor', async () => {
      await setup({ asset: 'a-brand-css', mtab: 'source', banner: 'large' });
      const detail = await drawer('brand.css');
      expect(within(detail).getByText(/too large to edit here/)).toBeInTheDocument();
      expect(within(detail).getByRole('button', { name: 'Download' })).toBeInTheDocument();
      expect(within(detail).queryByRole('textbox', { name: /^Source of / })).toBeNull();

      fireEvent.click(within(detail).getByRole('button', { name: 'Replace file' }));
      await waitFor(() => expect(within(detail).getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true'));
    });

    it('not valid UTF-8: the banner, and the text shows the replacement character', async () => {
      await setup({ asset: 'a-brand-css', mtab: 'source', banner: 'utf8' });
      const detail = await drawer('brand.css');
      expect(within(detail).getByText(/not valid UTF-8/)).toBeInTheDocument();
      expect(codeOf(await editor(detail))).toContain('�');
    });

    it('mixed line endings: the banner above the editor', async () => {
      await setup({ asset: 'a-logo', mtab: 'source', banner: 'eol' });
      const detail = await drawer('lumen-logo.svg');
      expect(within(detail).getByText(/mixes line endings; saving stores LF/)).toBeInTheDocument();
      expect(await editor(detail)).toBeInTheDocument();
    });

    it('no banner and no language select for a file with one file for all languages', async () => {
      await setup({ asset: 'a-brand-css', mtab: 'source' });
      const detail = await drawer('brand.css');
      await editor(detail);
      expect(within(detail).queryByText(/mixes line endings|not valid UTF-8|too large/)).toBeNull();
      expect(within(detail).queryByRole('combobox', { name: 'Language of the file' })).toBeNull();
    });

    it('a file per language: the Language select switches the text that is edited', async () => {
      await setup({ asset: 'a-brand-css', mtab: 'source', lang: 'en' });
      const detail = await drawer('brand.css');
      const select = within(detail).getByRole('combobox', { name: 'Language of the file' });
      const textbox = await editor(detail);
      expect(select).toHaveDisplayValue(/English \(EN\)/);
      expect(codeOf(textbox)).toContain('Language: English');

      fireEvent.change(select, { target: { value: '0' } });
      await waitFor(() => expect(codeOf(textbox)).not.toContain('Language: English'));
      expect(select).toHaveDisplayValue(/Deutsch \(DE\)/);
    });

    it('keeps the unsaved edit of a language until the leave dialog is answered', async () => {
      await setup({ asset: 'a-brand-css', mtab: 'source', lang: 'en', complete: '1' });
      const detail = await drawer('brand.css');
      const select = within(detail).getByRole('combobox', { name: 'Language of the file' });
      await editor(detail);

      fireEvent.change(select, { target: { value: '0' } });
      const guard = await screen.findByRole('dialog', { name: 'Unsaved changes' });
      // Cancel keeps the language and the edit.
      fireEvent.click(within(guard).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).toBeNull());
      expect(codeOf(await editor(detail))).toContain('Language: English');
      expect(codeOf(await editor(detail))).toContain('$CMS_VALUE(#global.br');
    });
  });

  describe('completion stub (102)', () => {
    it('`complete=1` ends the text with an unfinished global reference and marks the file unsaved', async () => {
      await setup({ asset: 'a-brand-css', mtab: 'source', complete: '1' });
      const detail = await drawer('brand.css');
      expect(codeOf(await editor(detail)).endsWith('$CMS_VALUE(#global.br')).toBe(true);
      expect(within(detail).getByText('Unsaved changes')).toBeInTheDocument();
    });
  });
});
