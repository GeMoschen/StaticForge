import '@angular/compiler';
import { fireEvent, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { ToastService } from '../../core/ui/toast.service';
import { PageEditorStore } from './page-editor.store';
import { openSettings, renderPageEditorShell, testPage } from './page-editor.testing';

describe('PageEditorComponent: Page settings drawer', () => {
  it('opens from the header button and closes with its ×, leaving the editor in place', async () => {
    await renderPageEditorShell();

    await openSettings();
    expect(screen.getByRole('button', { name: 'Page settings' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Name' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Page settings' })).toBeNull());
    expect(screen.getByRole('heading', { level: 1, name: 'About' })).toBeTruthy();
  });

  it('is non-modal: the page behind it stays usable', async () => {
    await renderPageEditorShell();

    await openSettings();

    expect(screen.getByRole('dialog', { name: 'Page settings' }).getAttribute('aria-modal')).toBeNull();
  });

  it('closes on Escape', async () => {
    await renderPageEditorShell();
    await openSettings();

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Page settings' }), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Page settings' })).toBeNull());
  });

  it('opens with the name in edit mode from ⋮ › Rename…', async () => {
    await renderPageEditorShell();

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename…' }));

    expect(await screen.findByDisplayValue('About')).toBeTruthy();
  });

  it("a rename offers Undo, which renames back on top of the page's current revision", async () => {
    const { fixture, api } = await renderPageEditorShell();
    const toasts = fixture.debugElement.injector.get(ToastService);
    await openSettings();

    // The server's copy after the rename (the editor re-reads the page when it changes).
    api.pageDetail.mockReturnValue(of({ ...testPage('page-1', 'Renamed'), revision: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename…' }));
    fireEvent.input(await screen.findByDisplayValue('About'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => expect(api.renameAsset).toHaveBeenCalledWith('proj', 'page-1', { displayName: 'Renamed' }, 7));
    expect(toasts.toasts().at(-1)?.message).toBe('Renamed “About” to “Renamed”.');
    await screen.findByRole('heading', { level: 1, name: 'Renamed' });

    api.renameAsset.mockReturnValue(of({ displayName: 'About', revision: 3 }));
    toasts.toasts().at(-1)!.action!.run();
    await waitFor(() => expect(api.renameAsset).toHaveBeenLastCalledWith('proj', 'page-1', { displayName: 'About' }, 2));
  });

  it('shows the error toast when the rename back fails', async () => {
    const { fixture, api } = await renderPageEditorShell();
    const toasts = fixture.debugElement.injector.get(ToastService);
    await openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Rename…' }));
    fireEvent.input(await screen.findByDisplayValue('About'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(toasts.toasts().at(-1)?.action).toBeDefined());
    api.renameAsset.mockReturnValue(throwError(() => new Error('412')));

    toasts.toasts().at(-1)!.action!.run();

    await waitFor(() => expect(toasts.toasts().at(-1)?.kind).toBe('error'));
  });

  it('keeps the name when the rename fails, and says so', async () => {
    const { fixture, api } = await renderPageEditorShell();
    const toasts = fixture.debugElement.injector.get(ToastService);
    api.renameAsset.mockReturnValue(throwError(() => new Error('500')));
    await openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Rename…' }));
    fireEvent.input(await screen.findByDisplayValue('About'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => expect(toasts.toasts().at(-1)?.kind).toBe('error'));
    expect(screen.getByRole('heading', { level: 1, name: 'About' })).toBeTruthy();
  });

  it('requires a name', async () => {
    await renderPageEditorShell();
    await openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Rename…' }));

    fireEvent.input(await screen.findByDisplayValue('About'), { target: { value: '  ' } });

    expect(await screen.findByText('A name is required.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Rename' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers no rename while read-only', async () => {
    await renderPageEditorShell({ readOnly: true });
    await openSettings();

    expect((screen.getByRole('button', { name: 'Rename…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('This page is read-only.')).toBeTruthy();
  });

  it('shows the UID only in developer mode', async () => {
    await renderPageEditorShell();
    await openSettings();
    expect(screen.queryByRole('heading', { name: 'UID' })).toBeNull();
  });

  it('shows the UID in developer mode', async () => {
    await renderPageEditorShell({ developerMode: true });
    await openSettings();
    expect(screen.getByRole('heading', { name: 'UID' })).toBeTruthy();
  });

  it('does not stay open on the next page', async () => {
    const { rerender, fixture } = await renderPageEditorShell();
    await openSettings();

    await rerender({ componentInputs: { projectKey: 'proj', uuid: 'page-2' } });

    await screen.findByRole('heading', { level: 1, name: 'Contact' });
    expect(fixture.debugElement.injector.get(PageEditorStore).settingsOpen()).toBe(false);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Page settings' })).toBeNull());
  });
});
