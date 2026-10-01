import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../../../core/ui/toast.service';
import { SampleState } from '../sample-state';
import { SampleMediaAreaComponent } from './sample-media-area.component';

async function setup(query: Record<string, string> = {}, dev = true) {
  const result = await render(SampleMediaAreaComponent, {
    providers: [
      SampleState,
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
    ],
  });
  TestBed.inject(SampleState).devMode.set(dev);
  // The folder tree loads its root asynchronously.
  await screen.findAllByRole('treeitem');
  result.fixture.detectChanges();
  return result;
}

/** The query string the area last wrote (it replaces the history entry). */
function watchQuery(): () => string {
  const replace = vi.spyOn(TestBed.inject(Location), 'replaceState');
  return () => String(replace.mock.lastCall?.[1] ?? '');
}

const h1 = () => screen.getByRole('heading', { level: 1 });
const library = () => screen.getByRole('grid', { name: /^Files in/ });
const cards = () => within(library()).getAllByRole('gridcell');
const card = (name: string) => cards().find((c) => c.getAttribute('aria-label')?.startsWith(name))!;
const drawer = (name: string) => screen.findByRole('dialog', { name });
const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent?.trim().replace(/\s+\d+$/, ''));

describe('SampleMediaAreaComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('query parameters', () => {
    it('opens the default folder as a grid of focusable cards and writes the state back', async () => {
      await setup();
      const query = watchQuery();

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(h1()).toHaveTextContent('Products');
      expect(cards().length).toBe(8);
      expect(card('yirgacheffe-beans-light-roast.jpg')).toHaveAttribute('aria-label', expect.stringContaining('JPG · 1.2 MB'));
      // The tree shows folders only.
      expect(screen.getByRole('treeitem', { name: /^Products/ })).toBeInTheDocument();
      expect(screen.queryByRole('treeitem', { name: /\.jpg/ })).toBeNull();
      fireEvent.click(screen.getByRole('radio', { name: 'List' }));
      await waitFor(() => expect(query()).toContain('media=list'));
      expect(query()).toContain('folder=m-products');
    });

    it('selects the list view and the folder', async () => {
      await setup({ media: 'list', folder: 'm-team' });

      expect(h1()).toHaveTextContent('Team');
      const table = screen.getByRole('grid', { name: 'Files in Team' });
      expect(within(table).getByRole('columnheader', { name: /Dimensions/ })).toBeInTheDocument();
      expect(within(table).getByText('anna-berger.jpg')).toBeInTheDocument();
    });

    it('opens a file in the drawer on the given tab, in the file’s folder', async () => {
      await setup({ asset: 'a-roaster-drum', mtab: 'variants' });
      const query = watchQuery();

      const detail = await drawer('roaster-drum-first-crack.jpg');
      expect(h1()).toHaveTextContent('Roastery');
      expect(within(detail).getByRole('tab', { name: 'Variants' })).toHaveAttribute('aria-selected', 'true');
      expect(within(detail).getByText('320w')).toBeInTheDocument();
      expect(within(detail).getByText('Original')).toBeInTheDocument();
      fireEvent.click(within(detail).getByRole('tab', { name: 'Versions' }));
      await waitFor(() => expect(query()).toContain('mtab=versions'));
      expect(query()).toContain('asset=a-roaster-drum');
    });

    it('shows the upload panel mid-upload, with a finished and a failed file', async () => {
      await setup({ upload: '1' });

      const panel = screen.getByRole('region', { name: 'Uploads' });
      expect(within(panel).getAllByRole('progressbar').length).toBe(2);
      expect(within(panel).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      expect(within(panel).getByRole('button', { name: 'Cancel the upload of iced-latte-terrace.jpg' })).toBeInTheDocument();

      fireEvent.click(within(panel).getByRole('button', { name: 'Add alt text' }));
      const detail = await drawer('cold-brew-bottle.jpg');
      expect(within(detail).getByRole('textbox', { name: /Alt text/ })).toHaveValue('');
    });

    it('selects the first files so the bulk bar shows', async () => {
      await setup({ selected: '2' });

      const bulk = screen.getByRole('group', { name: /bulk/i });
      expect(within(bulk).getByText('2 selected')).toBeInTheDocument();
      expect(cards().filter((c) => c.getAttribute('aria-selected') === 'true')).toHaveLength(2);
    });
  });

  describe('grid keyboard', () => {
    it('moves with the arrow keys, selects with Space and opens with Enter', async () => {
      await setup();
      const [first, second] = cards();
      expect(first).toHaveAttribute('tabindex', '0');
      expect(second).toHaveAttribute('tabindex', '-1');

      first.focus();
      fireEvent.keyDown(first, { key: 'ArrowRight' });
      expect(document.activeElement).toBe(second);
      expect(second).toHaveAttribute('tabindex', '0');

      fireEvent.keyDown(second, { key: ' ' });
      expect(second).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('group', { name: /bulk/i })).toHaveTextContent('1 selected');

      fireEvent.keyDown(second, { key: 'ArrowLeft' });
      expect(document.activeElement).toBe(first);
      fireEvent.keyDown(first, { key: 'End' });
      expect(document.activeElement).toBe(cards()[7]);

      fireEvent.keyDown(cards()[7], { key: 'Enter' });
      expect(await drawer(cards()[7].getAttribute('aria-label')!.split(',')[0])).toBeInTheDocument();
    });

    it('labels each card’s checkbox with the file name', async () => {
      await setup();
      const box = within(card('latte-art-rosetta.jpg')).getByRole('checkbox', { name: 'Select latte-art-rosetta.jpg' });
      expect(box).toHaveAttribute('tabindex', '-1');
      fireEvent.click(box);
      expect(card('latte-art-rosetta.jpg')).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('deletes the selection after a danger confirm and offers Undo', async () => {
    await setup({ selected: '2' });
    const undo = vi.spyOn(TestBed.inject(ToastService), 'undo');
    const before = cards().length;

    fireEvent.click(within(screen.getByRole('group', { name: /bulk/i })).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete 2 files?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete 2 files' }));

    await waitFor(() => expect(cards().length).toBe(before - 2));
    expect(screen.queryByRole('group', { name: /bulk/i })).toBeNull();
    expect(undo).toHaveBeenCalledWith('Deleted 2 files', expect.any(Function));

    undo.mock.lastCall![1]();
    await waitFor(() => expect(cards().length).toBe(before));
  });

  describe('tabs per kind of file', () => {
    it('photo: details, variants, languages, used by, versions', async () => {
      await setup({ asset: 'a-latte-rosetta' });
      await drawer('latte-art-rosetta.jpg');
      expect(tabNames()).toEqual(['Details', 'Variants', 'Languages', 'Used by', 'Versions']);
    });

    it('CSS text media: processing, rendered and source, no variants', async () => {
      await setup({ asset: 'a-brand-css', mtab: 'processing' });
      const detail = await drawer('brand.css');
      expect(tabNames()).toEqual(['Details', 'Languages', 'Processing', 'Rendered', 'Source', 'Used by', 'Versions']);
      expect(within(detail).getByRole('switch', { name: 'Process CMS syntax' })).toHaveAttribute('aria-checked', 'true');
      expect(within(detail).getByText('UNKNOWN_GLOBAL')).toBeInTheDocument();

      // Without processing there is nothing rendered to show.
      fireEvent.click(within(detail).getByRole('switch', { name: 'Process CMS syntax' }));
      await waitFor(() => expect(tabNames()).not.toContain('Rendered'));
    });

    it('SVG logo: source in the code panel, rendered only when processed', async () => {
      await setup({ asset: 'a-logo', mtab: 'source' });
      const detail = await drawer('lumen-logo.svg');
      expect(tabNames()).toEqual(['Details', 'Languages', 'Processing', 'Source', 'Used by', 'Versions']);
      expect(within(detail).getAllByText('SVG · XML', { exact: false }).length).toBeGreaterThan(0);
    });

    it('PDF: no variants and no text tabs', async () => {
      await setup({ asset: 'a-price-list' });
      const detail = await drawer('wholesale-price-list-2026.pdf');
      expect(tabNames()).toEqual(['Details', 'Languages', 'Used by', 'Versions']);
      expect(within(detail).getByText('Page 1 of 4')).toBeInTheDocument();
    });

    it('localized image: one file per language', async () => {
      await setup({ asset: 'a-summer-campaign', mtab: 'languages' });
      const detail = await drawer('summer-campaign.jpg');
      expect(within(detail).getByRole('switch', { name: 'Different file per language' })).toHaveAttribute('aria-checked', 'true');
      expect(within(detail).getByText(/sommer-aktion\.jpg/)).toBeInTheDocument();
      expect(within(detail).getByText(/summer-campaign-en\.jpg/)).toBeInTheDocument();
    });

    it('a photo switched to a file per language: English uses the German file', async () => {
      await setup({ asset: 'a-latte-rosetta', mtab: 'languages' });
      const detail = await drawer('latte-art-rosetta.jpg');
      fireEvent.click(within(detail).getByRole('switch', { name: 'Different file per language' }));
      expect(await within(detail).findByText('Uses the DE file')).toBeInTheDocument();
    });
  });

  describe('details', () => {
    it('sets the focal point by clicking the preview and moves it with the arrow keys', async () => {
      await setup({ asset: 'a-yirgacheffe-beans' });
      const detail = await drawer('yirgacheffe-beans-light-roast.jpg');
      const preview = within(detail).getByRole('group', { name: /Focal point at 50 % across/ });
      vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 100 } as DOMRect);

      fireEvent.click(preview, { clientX: 50, clientY: 75 });
      await waitFor(() => expect(preview).toHaveAccessibleName('Focal point at 25 % across and 75 % down'));

      fireEvent.keyDown(preview, { key: 'ArrowRight' });
      fireEvent.keyDown(preview, { key: 'ArrowUp', shiftKey: true });
      await waitFor(() => expect(preview).toHaveAccessibleName('Focal point at 26 % across and 65 % down'));
      // Developer mode: the numbers too.
      expect(within(detail).getByRole('spinbutton', { name: 'Focal point X' })).toHaveValue(26);
    });

    it('hides the focal numbers and the UID outside developer mode', async () => {
      await setup({ asset: 'a-yirgacheffe-beans' }, false);
      const detail = await drawer('yirgacheffe-beans-light-roast.jpg');
      expect(within(detail).getByRole('group', { name: /Focal point at/ })).toBeInTheDocument();
      expect(within(detail).queryByRole('spinbutton', { name: 'Focal point X' })).toBeNull();
      expect(within(detail).queryByText('yirgacheffe_beans')).toBeNull();
    });

    it('enables Save only when the details changed', async () => {
      await setup({ asset: 'a-yirgacheffe-beans' });
      const detail = await drawer('yirgacheffe-beans-light-roast.jpg');
      const save = within(detail).getByRole('button', { name: /^Save/ });
      expect(save).toHaveAttribute('aria-disabled', 'true');

      fireEvent.input(within(detail).getByRole('textbox', { name: /Alt text/ }), { target: { value: 'Beans' } });
      await waitFor(() => expect(save).not.toHaveAttribute('aria-disabled'));
      expect(within(detail).getByText('Unsaved changes')).toBeInTheDocument();

      fireEvent.click(save);
      await waitFor(() => expect(save).toHaveAttribute('aria-disabled', 'true'));
      expect(within(detail).getByRole('textbox', { name: /Alt text/ })).toHaveValue('Beans');
    });

    it('steps to the next file with → in the header and closes with ×', async () => {
      await setup({ asset: 'a-yirgacheffe-beans' });
      const detail = await drawer('yirgacheffe-beans-light-roast.jpg');
      const next = within(detail).getByRole('button', { name: 'Next file' });
      fireEvent.keyDown(next, { key: 'ArrowRight' });
      // Sorted by name: after "yirgacheffe…" the list wraps to the first file.
      expect(await drawer('cold-brew-bottle.jpg')).toBeInTheDocument();

      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
  });
});
