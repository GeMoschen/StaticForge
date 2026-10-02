import '@angular/compiler';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { PageNavSettingsComponent } from './page-nav-settings.component';
import { openSettings, renderPageEditorShell } from './page-editor.testing';

describe('PageNavSettingsComponent', () => {
  it('shows the defaults for a page saved before the settings existed', async () => {
    await render(PageNavSettingsComponent, { componentInputs: { nav: { position: 3 } } });

    expect(screen.getByRole('switch', { name: 'Show in navigation' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Hide from search engines' }).getAttribute('aria-checked')).toBe('false');
    expect((screen.getByRole('spinbutton', { name: /Position/ }) as HTMLInputElement).value).toBe('3');
  });

  it('emits the whole nav with the toggled member, keeping the others, and says the edit is complete', async () => {
    const navChange = vi.fn();
    const navSettled = vi.fn();
    await render(PageNavSettingsComponent, {
      componentInputs: { nav: { visible: true, position: 30, label: 'Autumn', noIndex: false } },
      on: { navChange, navSettled },
    });

    fireEvent.click(screen.getByRole('switch', { name: 'Hide from search engines' }));

    expect(navChange).toHaveBeenCalledWith({ visible: true, position: 30, label: 'Autumn', noIndex: true });
    expect(navSettled).toHaveBeenCalledTimes(1);
  });

  it('emits the label as it is typed, and settles when the field is left', async () => {
    const navChange = vi.fn();
    const navSettled = vi.fn();
    await render(PageNavSettingsComponent, {
      componentInputs: { nav: { visible: true, position: 1, label: 'Autumn', noIndex: false } },
      on: { navChange, navSettled },
    });

    const label = screen.getByRole('textbox', { name: /Navigation label/ });
    fireEvent.input(label, { target: { value: 'Winter' } });
    expect(navChange).toHaveBeenLastCalledWith({ visible: true, position: 1, label: 'Winter', noIndex: false });
    expect(navSettled).not.toHaveBeenCalled();

    fireEvent.focusOut(label);
    expect(navSettled).toHaveBeenCalledTimes(1);
  });

  it('is disabled when read-only, and the label and position follow "Show in navigation"', async () => {
    await render(PageNavSettingsComponent, { componentInputs: { nav: { visible: false, noIndex: true }, disabled: true } });

    expect((screen.getByRole('switch', { name: 'Hide from search engines' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('switch', { name: 'Show in navigation' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('textbox', { name: /Navigation label/ }) as HTMLInputElement).disabled).toBe(true);
  });
});

describe('PageEditorComponent: navigation and search settings', () => {
  it('saves "Hide from search engines" as nav.noIndex with the page', async () => {
    const { api } = await renderPageEditorShell();
    await openSettings();

    fireEvent.click(await screen.findByRole('switch', { name: 'Hide from search engines' }));

    await waitFor(() => expect(api.updatePage).toHaveBeenCalledTimes(1));
    const [key, uuid, payload, revision] = api.updatePage.mock.calls[0];
    expect([key, uuid, revision]).toEqual(['proj', 'page-1', 7]);
    expect(payload).toMatchObject({ templateRef: 'tpl-1', nav: { visible: true, position: 0, noIndex: true } });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Hide from search engines' }).getAttribute('aria-checked')).toBe('true'));
  });

  it('saves "Show in navigation" as nav.visible', async () => {
    const { api } = await renderPageEditorShell();
    await openSettings();

    fireEvent.click(await screen.findByRole('switch', { name: 'Show in navigation' }));

    await waitFor(() => expect(api.updatePage).toHaveBeenCalledTimes(1));
    expect(api.updatePage.mock.calls[0][2]).toMatchObject({ nav: { visible: false, position: 0, noIndex: false } });
  });

  it('offers no change while read-only', async () => {
    const { api } = await renderPageEditorShell({ readOnly: true });
    await openSettings();

    const noIndex = (await screen.findByRole('switch', { name: 'Hide from search engines' })) as HTMLButtonElement;
    expect(noIndex.disabled).toBe(true);
    fireEvent.click(noIndex);
    expect(api.updatePage).not.toHaveBeenCalled();
  });
});
