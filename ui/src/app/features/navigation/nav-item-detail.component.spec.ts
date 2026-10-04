import '@angular/compiler';
import { Component, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../core/ui/toast.service';
import { SfAssetFavoriteComponent } from '../../shared/components/sf-asset-favorite.component';
import { type AssetPicked, SfAssetPickerDialogComponent } from '../../shared/components/sf-asset-picker-dialog.component';
import { ReleaseBarComponent } from '../release/release-bar.component';
import { NavItemDetailComponent, storedLabel } from './nav-item-detail.component';
import type { NavEntry } from './navigation-tree.util';
import { NavigationService } from './navigation.service';

@Component({ selector: 'sf-release-bar', standalone: true, template: '' })
class ReleaseBarStub {
  readonly projectKey = input<string>();
  readonly assetUuid = input<string | null>();
  readonly refreshKey = input<unknown>();
  readonly layout = input<string>();
}

@Component({ selector: 'sf-asset-favorite', standalone: true, template: '' })
class FavoriteStub {
  readonly type = input<string>();
  readonly uuid = input<string>();
  readonly name = input<string>();
  readonly folderPath = input<string>();
}

@Component({
  selector: 'sf-asset-picker-dialog',
  standalone: true,
  template:
    '<div role="dialog" aria-label="picker" data-testid="picker">{{ allowedTypes()?.join() }}<button type="button" (click)="picked.emit({ uuid: \'p-new\', assetType: \'PAGE\', label: \'Pricing\' })">choose pricing</button></div>',
})
class PickerStub {
  readonly projectKey = input<string>();
  readonly initialType = input<string | null>(null);
  readonly allowedTypes = input<string[] | null>(null);
  readonly picked = output<AssetPicked>();
  readonly closed = output<void>();
}

const ENTRY: NavEntry = {
  kind: 'item',
  uuid: 'n-about',
  label: 'About us',
  displayName: 'About',
  uid: 'about',
  targetUuid: 'p-about',
  targetName: 'Our story',
  release: null,
  scheduled: false,
  revision: 3,
  visible: true,
  protectedFolder: false,
  entry: null,
};
const URLS = new Map([
  ['p-about', '/about-us/'],
  ['p-new', '/pricing/'],
]);

interface SetupOptions {
  entry?: NavEntry;
  payload?: unknown;
  role?: string;
  dev?: boolean;
  locale?: string | null;
  nav?: Record<string, unknown>;
  api?: Record<string, unknown>;
}

async function setup(options: SetupOptions = {}) {
  const nav = {
    updateReference: vi.fn().mockReturnValue(of({ revision: 4 })),
    ...options.nav,
  };
  const api = {
    assetDetail: vi.fn().mockReturnValue(
      of({ revision: 3, folderPath: '/navigation_root/', payload: options.payload ?? { target: { kind: 'PAGE', assetUuid: 'p-about' }, label: 'About us' } }),
    ),
    ...options.api,
  };
  const role = options.role ?? 'EDITOR';
  const view = await render(NavItemDetailComponent, {
    componentInputs: { projectKey: 'proj', entry: options.entry ?? ENTRY, urls: URLS },
    providers: [
      { provide: NavigationService, useValue: nav },
      { provide: ApiClient, useValue: api },
      { provide: FrameContextStore, useValue: { setItem: vi.fn() } },
      provideProjectPermissions({ role: () => role, readOnly: () => false }),
      { provide: DeveloperModeService, useValue: { enabled: signal(options.dev ?? false) } },
      { provide: EditingLocaleStore, useValue: { locale: signal(options.locale ?? null) } },
    ],
    configureTestBed: (tb) => {
      tb.overrideComponent(NavItemDetailComponent, {
        remove: { imports: [ReleaseBarComponent, SfAssetFavoriteComponent, SfAssetPickerDialogComponent] },
        add: { imports: [ReleaseBarStub, FavoriteStub, PickerStub] },
      });
    },
  });
  const toasts = TestBed.inject(ToastService);
  const editors = TestBed.inject(ActiveEditorService);
  return { ...view, nav, api, toasts, editors };
}

const labelInput = () => screen.getByRole('textbox', { name: /^Label/ }) as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: 'Save' });

describe('NavItemDetailComponent (menu item)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('has the item as the page\'s h1 with the save status, and no "Select a node"/UUID wording', async () => {
    await setup();
    expect(screen.getByRole('heading', { level: 1, name: 'About us' })).toBeTruthy();
    expect(await screen.findByText(/^Saved/)).toBeTruthy();
    expect(saveButton()).toBeDisabled();
  });

  it('shows the target as a picker card — page name and public URL — with Open and Change target', async () => {
    await setup();
    expect(screen.getByText('Our story')).toBeTruthy();
    // The card and the read-only field both show the URL, labelled "Public URL".
    expect(screen.getAllByText('/about-us/').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Public URL')).toHaveValue('/about-us/');
    expect(screen.getByRole('button', { name: 'Open Our story' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change target…' })).toBeTruthy();
    expect(screen.queryByText('p-about')).toBeNull();
  });

  it('says there is no target page yet, and offers to choose one', async () => {
    await setup({ entry: { ...ENTRY, targetUuid: null, targetName: null }, payload: { target: { kind: 'PAGE', assetUuid: null }, label: '' } });
    expect(screen.getByText('No target page yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose target…' })).toBeTruthy();
  });

  it('says so when the target page is gone', async () => {
    await setup({ entry: { ...ENTRY, targetUuid: null, targetName: null }, payload: { target: { kind: 'PAGE', assetUuid: 'p-gone' }, label: '' } });
    expect(await screen.findByText(/target page no longer exists/)).toBeTruthy();
  });

  it('shows no UIDs outside developer mode', async () => {
    await setup();
    expect(screen.queryByText('about')).toBeNull();
    expect(screen.queryByText('Target UUID')).toBeNull();
  });

  it('shows the UID and the target UUID in developer mode', async () => {
    await setup({ dev: true });
    expect(screen.getByText('about')).toBeTruthy();
    expect(screen.getByText('Target UUID')).toBeTruthy();
    expect(screen.getByText('p-about')).toBeTruthy();
  });

  describe('editing', () => {
    it('Change target opens the page picker — pages only — and a chosen page is a draft with "Not saved" until saved', async () => {
      const { nav } = await setup();
      fireEvent.click(screen.getByRole('button', { name: 'Change target…' }));
      expect(screen.getByTestId('picker').textContent).toContain('PAGE');

      fireEvent.click(screen.getByRole('button', { name: 'choose pricing' }));

      expect(screen.queryByTestId('picker')).toBeNull();
      expect(screen.getByText('Pricing')).toBeTruthy();
      expect(screen.getByLabelText('Public URL')).toHaveValue('/pricing/');
      expect(screen.getByText('Unsaved changes')).toBeTruthy();
      expect(nav['updateReference']).not.toHaveBeenCalled();

      fireEvent.click(saveButton());
      await waitFor(() =>
        expect(nav['updateReference']).toHaveBeenCalledWith(
          'proj',
          'n-about',
          { targetKind: 'PAGE', targetAssetUuid: 'p-new', label: 'About us', visibleInMenu: true },
          '"rev-3"',
          undefined,
        ),
      );
    });

    it('saves the label for the editing language and says Saved with a toast', async () => {
      const { nav, toasts, fixture } = await setup({
        locale: 'de',
        payload: { target: { kind: 'PAGE', assetUuid: 'p-about' }, label: { type: 'L10N', values: { de: 'Über uns', en: 'About us' } } },
      });
      await waitFor(() => expect(labelInput().value).toBe('Über uns'));

      fireEvent.input(labelInput(), { target: { value: 'Wer wir sind' } });
      expect(await screen.findByText('Unsaved changes')).toBeTruthy();
      fireEvent.click(saveButton());

      await waitFor(() =>
        expect(nav['updateReference']).toHaveBeenCalledWith(
          'proj',
          'n-about',
          { targetKind: 'PAGE', targetAssetUuid: 'p-about', label: 'Wer wir sind', visibleInMenu: true },
          '"rev-3"',
          'de',
        ),
      );
      await waitFor(() => expect(toasts.toasts().at(-1)?.message).toBe('Menu item saved.'));
      expect(fixture.componentInstance).toBeTruthy();
    });

    describe('Visible in menu', () => {
      const visibleSwitch = () => screen.getByRole('switch', { name: /Visible in menu/ });

      it('is a switch that is on when the item has no flag stored (everything stored before it is visible)', async () => {
        await setup();
        await waitFor(() => expect(visibleSwitch()).toBeChecked());
        expect(await screen.findByText('In menu')).toBeTruthy();
      });

      it('is a draft until saved: turning it off makes the item dirty, Save sends it with the target and label', async () => {
        const { nav, editors } = await setup();
        await waitFor(() => expect(labelInput().value).toBe('About us'));
        fireEvent.click(visibleSwitch());

        expect(visibleSwitch()).not.toBeChecked();
        expect(editors.active()!.dirty()).toBe(true);
        expect(nav['updateReference']).not.toHaveBeenCalled();

        fireEvent.click(saveButton());
        await waitFor(() =>
          expect(nav['updateReference']).toHaveBeenCalledWith(
            'proj',
            'n-about',
            { targetKind: 'PAGE', targetAssetUuid: 'p-about', label: 'About us', visibleInMenu: false },
            '"rev-3"',
            undefined,
          ),
        );
      });

      it('shows a stored false as off with the Hidden status, and discard gives a change up', async () => {
        const { editors } = await setup({
          entry: { ...ENTRY, visible: false },
          payload: { target: { kind: 'PAGE', assetUuid: 'p-about' }, label: 'About us', visibleInMenu: false },
        });
        await waitFor(() => expect(visibleSwitch()).not.toBeChecked());
        expect(screen.getByText('Hidden from menu')).toBeTruthy();

        fireEvent.click(visibleSwitch());
        expect(editors.active()!.dirty()).toBe(true);
        await editors.active()!.discard();
        await waitFor(() => expect(visibleSwitch()).not.toBeChecked());
        expect(editors.active()!.dirty()).toBe(false);
      });

      it('cannot be changed by a viewer', async () => {
        await setup({ role: 'VIEWER' });
        expect(visibleSwitch()).toBeDisabled();
      });
    });

    it('registers as an editor: unsaved edits are dirty for Ctrl+S and the leave guard, and discard gives them up', async () => {
      const { editors } = await setup();
      await waitFor(() => expect(labelInput().value).toBe('About us'));
      const editor = editors.active()!;
      expect(editor.dirty()).toBe(false);

      fireEvent.input(labelInput(), { target: { value: 'Who we are' } });
      expect(editor.dirty()).toBe(true);
      expect(editor.autosave).toBe(false);
      expect(editor.name()).toBe('About us');

      await editor.discard();
      expect(editor.dirty()).toBe(false);
      await waitFor(() => expect(labelInput().value).toBe('About us'));
    });

    it('keeps the edits and says why when the save is refused', async () => {
      const { editors } = await setup({ nav: { updateReference: vi.fn().mockReturnValue(throwError(() => new Error('409'))) } });
      await waitFor(() => expect(labelInput().value).toBe('About us'));
      fireEvent.input(labelInput(), { target: { value: 'Who we are' } });

      const result = await editors.active()!.save();

      expect(result.ok).toBe(false);
      expect(await screen.findByText(/Could not save the menu item/)).toBeTruthy();
      expect(labelInput().value).toBe('Who we are');
    });

    it('does not save without a target page', async () => {
      const { editors, nav } = await setup({
        entry: { ...ENTRY, targetUuid: null, targetName: null },
        payload: { target: { kind: 'PAGE', assetUuid: null }, label: '' },
      });
      fireEvent.input(labelInput(), { target: { value: 'Orphan' } });

      const result = await editors.active()!.save();

      expect(result).toEqual({ ok: false, message: 'Choose a target page first.' });
      expect(nav['updateReference']).not.toHaveBeenCalled();
    });

    it('is read-only for a viewer', async () => {
      await setup({ role: 'VIEWER' });
      expect(labelInput()).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Change target…' })).toBeDisabled();
    });
  });

  describe('storedLabel', () => {
    it('reads a plain label, the editing language of a wrapper, and nothing when untranslated', () => {
      expect(storedLabel('Home', null)).toBe('Home');
      expect(storedLabel({ type: 'L10N', values: { de: 'Start' } }, 'de')).toBe('Start');
      expect(storedLabel({ type: 'L10N', values: { de: 'Start' } }, 'en')).toBe('');
      expect(storedLabel(null, 'en')).toBe('');
    });
  });
});
