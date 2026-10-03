import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
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
  result.fixture.detectChanges();
  return result;
}

/** Media sample, gate round 12: what M35.19 built beyond the signed-off sample. */
describe('media sample: round 12 additions', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('rename dialog with the UID (decision 107)', () => {
    it('renames a folder: required, free among its siblings, no extension rule', async () => {
      await setup({ dialog: 'rename-folder' });
      const dialog = await screen.findByRole('dialog', { name: 'Rename “Products”' });
      const apply = within(dialog).getByRole('button', { name: 'Apply' });
      const field = within(dialog).getByRole('textbox', { name: /Folder name/ });
      expect(apply).toBeDisabled();

      fireEvent.input(field, { target: { value: 'Brand' } });
      expect(await within(dialog).findByText('A folder with this name already exists here.')).toBeInTheDocument();
      expect(apply).toBeDisabled();

      fireEvent.input(field, { target: { value: '' } });
      expect(await within(dialog).findByText('Enter a folder name.')).toBeInTheDocument();

      fireEvent.input(field, { target: { value: 'Coffee products' } });
      await waitFor(() => expect(apply).toBeEnabled());
      const undo = vi.spyOn(TestBed.inject(ToastService), 'undo');
      fireEvent.click(apply);
      await waitFor(() => expect(undo).toHaveBeenCalled());
      expect(undo.mock.lastCall![0]).toContain('Renamed the folder “Products” to “Coffee products”');
    });

    it('opens from the page header menu as Rename folder…', async () => {
      await setup();
      await screen.findAllByRole('treeitem');
      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename folder…' }));
      expect(await screen.findByRole('dialog', { name: 'Rename “Products”' })).toBeInTheDocument();
    });

    it('changes the UID on its own, after a warning, with an Undo toast (developer mode, files and folders)', async () => {
      await setup({ asset: 'a-latte-rosetta', dialog: 'rename' });
      const undo = vi.spyOn(TestBed.inject(ToastService), 'undo');
      const dialog = await screen.findByRole('dialog', { name: 'Rename “latte-art-rosetta.jpg”' });
      expect(within(dialog).getByRole('heading', { name: 'UID' })).toBeInTheDocument();
      expect(within(dialog).getByText(/Changing the UID breaks links/)).toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Change UID…' }));
      expect(within(dialog).getByText(/Links that use the old UID break/)).toBeInTheDocument();
      const apply = within(dialog).getByRole('button', { name: 'Change UID' });
      expect(apply).toBeDisabled();
      fireEvent.input(within(dialog).getByRole('textbox', { name: /New UID/ }), { target: { value: 'latte_pour' } });
      await waitFor(() => expect(apply).toBeEnabled());
      fireEvent.click(apply);

      expect(undo).toHaveBeenCalledWith('UID changed to “latte_pour”.', expect.any(Function));
      // The name's own Apply is untouched, and the dialog stays open.
      expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeDisabled();
      expect(within(dialog).getByText('latte_pour')).toBeInTheDocument();
    });

    it('has no UID section outside developer mode', async () => {
      await setup({ asset: 'a-latte-rosetta', dialog: 'rename' }, false);
      const dialog = await screen.findByRole('dialog', { name: 'Rename “latte-art-rosetta.jpg”' });
      expect(within(dialog).queryByRole('heading', { name: 'UID' })).toBeNull();
    });
  });

  describe('details, move, delete', () => {
    it('keeps Copyright as a field under the caption', async () => {
      await setup({ asset: 'a-yirgacheffe-beans' });
      const drawer = await screen.findByRole('dialog', { name: 'yirgacheffe-beans-light-roast.jpg' });
      const copyright = within(drawer).getByRole('textbox', { name: /Copyright/ });
      fireEvent.input(copyright, { target: { value: '© Lumen Coffee' } });
      expect(await within(drawer).findByText('Unsaved changes')).toBeInTheDocument();
    });

    it('offers the top level as a target when files are moved', async () => {
      await setup({ selected: '2', dialog: 'move' });
      const undo = vi.spyOn(TestBed.inject(ToastService), 'undo');
      const dialog = await screen.findByRole('dialog', { name: 'Move 2 files' });
      fireEvent.click(await within(dialog).findByRole('treeitem', { name: /^Top level/ }));
      const move = within(dialog).getByRole('button', { name: 'Move' });
      await waitFor(() => expect(move).not.toHaveAttribute('aria-disabled'));
      fireEvent.click(move);
      await waitFor(() => expect(undo).toHaveBeenCalled());
      expect(undo.mock.lastCall![0]).toMatch(/^Moved 2 files to the top level/);
    });

    it('names where a used file is used in the delete confirmation', async () => {
      await setup({ asset: 'a-hero-texture', dialog: 'delete' });
      const dialog = await screen.findByRole('dialog', { name: 'Delete “hero-texture.png”?' });
      expect(within(dialog).getByText('brand.css · CSS')).toBeInTheDocument();
    });
  });

  describe('the URLs of the Used by tab', () => {
    it('lists the URLs, and overrides them in developer mode only', async () => {
      await setup({ asset: 'a-hero-texture', mtab: 'usedby' });
      const drawer = await screen.findByRole('dialog', { name: 'hero-texture.png' });
      expect(within(drawer).getByRole('heading', { name: 'URLs' })).toBeInTheDocument();
      expect(within(drawer).getByText('/media/hero-texture.png')).toBeInTheDocument();
      expect(within(drawer).getAllByRole('button', { name: 'Override' }).length).toBeGreaterThan(0);
    });

    it('says quietly that the URLs are unavailable and retries instead of raising a toast', async () => {
      await setup({ asset: 'a-hero-texture', mtab: 'usedby', urls: 'error' });
      const drawer = await screen.findByRole('dialog', { name: 'hero-texture.png' });
      expect(within(drawer).getByText(/The URLs of this item are not available yet/)).toBeInTheDocument();
      fireEvent.click(within(drawer).getByRole('button', { name: 'Retry' }));
      expect(await within(drawer).findByText('/media/hero-texture.png')).toBeInTheDocument();
    });
  });
});
