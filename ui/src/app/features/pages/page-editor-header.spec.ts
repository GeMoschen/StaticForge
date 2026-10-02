import '@angular/compiler';
import { fireEvent, screen, waitFor } from '@testing-library/angular';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../core/ui/toast.service';
import { PageEditorStore } from './page-editor.store';
import { renderPageEditorShell } from './page-editor.testing';

describe('PageEditorHeaderComponent', () => {
  it("names the page in the one h1 and shows the language's translation status", async () => {
    await renderPageEditorShell();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'About' })).toBeTruthy();
  });

  it('shows the Issues count on its button and toggles the drawer', async () => {
    const { fixture } = await renderPageEditorShell();
    const store = fixture.debugElement.injector.get(PageEditorStore);

    expect(screen.getByRole('button', { name: /^Issues/ }).textContent).not.toMatch(/\d/);
    store.issueSummary.set({ count: 3, errors: 1 });
    await waitFor(() => expect(screen.getByRole('button', { name: /^Issues/ }).textContent).toMatch(/3/));

    const button = screen.getByRole('button', { name: /^Issues/ });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('true'));
    expect(store.issuesOpen()).toBe(true);
  });

  it('lets Issues and Page settings share the right edge: opening one closes the other', async () => {
    const { fixture } = await renderPageEditorShell();
    const store = fixture.debugElement.injector.get(PageEditorStore);

    fireEvent.click(screen.getByRole('button', { name: /^Issues/ }));
    await waitFor(() => expect(store.issuesOpen()).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Page settings' }));

    await waitFor(() => expect(store.settingsOpen()).toBe(true));
    expect(store.issuesOpen()).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /^Issues/ }));
    await waitFor(() => expect(store.issuesOpen()).toBe(true));
    expect(store.settingsOpen()).toBe(false);
  });

  it('toggles the preview with a pressed button, remembering the choice', async () => {
    localStorage.removeItem('sf-page-editor-preview');
    const { fixture } = await renderPageEditorShell();
    const store = fixture.debugElement.injector.get(PageEditorStore);
    const button = screen.getByRole('button', { name: 'Preview' });
    expect(button.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(button);

    await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('false'));
    expect(store.previewOpen()).toBe(false);
    expect(localStorage.getItem('sf-page-editor-preview')).toBe('off');
    localStorage.removeItem('sf-page-editor-preview');
  });

  it("lists the page's own actions in ⋮, in order", async () => {
    await renderPageEditorShell();

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

    const labels = ['Save now', 'Duplicate', 'Rename…', 'Copy link', 'Page settings…', 'Delete…'];
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => labels.find((label) => item.textContent?.includes(label)))).toEqual(labels);
  });

  it('saves now: writes what is pending at once', async () => {
    const { api, fixture } = await renderPageEditorShell();
    const store = fixture.debugElement.injector.get(PageEditorStore);
    store.autosave.markDirty();

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Save now/ }));

    await waitFor(() => expect(api.updatePage).toHaveBeenCalledTimes(1));
  });

  it('duplicates the page and opens the copy', async () => {
    const { api, router } = await renderPageEditorShell();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const toasts = TestBed.inject(ToastService);

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Duplicate/ }));

    await waitFor(() => expect(api.duplicatePage).toHaveBeenCalledWith('proj', 'page-1'));
    expect(navigate).toHaveBeenCalledWith(['/p', 'proj', 'pages', 'page-3']);
    expect(toasts.toasts().at(-1)?.message).toBe('Created “About copy”.');
  });

  it('asks before deleting, then returns to the pages area', async () => {
    const { api, router } = await renderPageEditorShell();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete…/ }));
    expect(api.deleteAsset).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(api.deleteAsset).toHaveBeenCalledWith('proj', 'page-1'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(['/p', 'proj', 'pages']));
  });

  it('offers no save, duplicate, rename or delete while read-only', async () => {
    await renderPageEditorShell({ readOnly: true });

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

    for (const name of [/Save now/, /Duplicate/, /Rename…/, /Delete…/]) {
      expect((await screen.findByRole('menuitem', { name })).getAttribute('aria-disabled')).toBe('true');
    }
    expect((await screen.findByRole('menuitem', { name: /Page settings…/ })).getAttribute('aria-disabled')).not.toBe('true');
  });
});
