import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { provideTranslocoTesting } from '../i18n/transloco-testing';
import { ShortcutDef, ShortcutService } from './shortcut.service';
import { ShortcutSheetComponent } from './shortcut-sheet.component';

const def = (id: string, keys: string | undefined, description: string, over: Partial<ShortcutDef> = {}): ShortcutDef => ({
  id,
  keys,
  scope: 'global',
  group: 'general',
  description: `frame.shortcuts.items.${description}`,
  handler: vi.fn(),
  ...over,
});

async function setup() {
  const view = await render(ShortcutSheetComponent, { providers: [provideTranslocoTesting()] });
  const shortcuts = TestBed.inject(ShortcutService);
  return { ...view, shortcuts };
}

describe('ShortcutSheetComponent', () => {
  it('lists what the registry holds, grouped, and nothing for a command without keys', async () => {
    const { shortcuts } = await setup();
    shortcuts.registerAll([
      def('palette', 'Mod+K', 'palette'),
      def('go.pages', 'g p', 'goPages', { group: 'goTo' }),
      def('theme', undefined, 'themeDark'),
    ]);
    shortcuts.shortcutSheetOpen.set(true);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Everywhere' })).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Go to' })).toBeTruthy();
    expect(screen.getByText('Search and commands')).toBeTruthy();
    expect(screen.getByText('Go to Pages')).toBeTruthy();
    expect(screen.queryByText('Switch to dark theme')).toBeNull();
  });

  it('puts the shortcuts of the open screen first, and drops them when the screen goes away', async () => {
    const { shortcuts } = await setup();
    shortcuts.register(def('palette', 'Mod+K', 'palette'));
    const off = shortcuts.register(def('editor.refresh', 'Mod+Enter', 'refreshPreview', { scope: 'component', group: 'editing' }));
    shortcuts.shortcutSheetOpen.set(true);
    await waitFor(() => expect(screen.getByRole('heading', { name: /Editing/ })).toBeTruthy());
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent?.trim());
    expect(headings[0]).toMatch(/^Editing/);
    expect(headings[0]).toContain('On this screen');
    off();
    await waitFor(() => expect(screen.queryByText('Refresh the preview')).toBeNull());
  });

  it('hides commands that do not apply right now', async () => {
    const { shortcuts } = await setup();
    const dev = signal(false);
    shortcuts.register(def('go.templates', 'g t', 'goTemplates', { group: 'goTo', enabled: () => dev() }));
    shortcuts.register(def('go.pages', 'g p', 'goPages', { group: 'goTo' }));
    shortcuts.shortcutSheetOpen.set(true);
    await waitFor(() => expect(screen.getByText('Go to Pages')).toBeTruthy());
    expect(screen.queryByText('Go to Templates')).toBeNull();
    dev.set(true);
    await waitFor(() => expect(screen.getByText('Go to Templates')).toBeTruthy());
  });

  it('filters by description or keys and says when nothing matches', async () => {
    const { shortcuts } = await setup();
    shortcuts.registerAll([def('palette', 'Mod+K', 'palette'), def('save', 'Mod+S', 'save'), def('go.pages', 'g p', 'goPages', { group: 'goTo' })]);
    shortcuts.shortcutSheetOpen.set(true);
    const search = await screen.findByRole('searchbox');
    await fireEvent.input(search, { target: { value: 'save' } });
    await waitFor(() => expect(screen.queryByText('Search and commands')).toBeNull());
    expect(screen.getByText('Save')).toBeTruthy();
    await fireEvent.input(search, { target: { value: 'ctrl k' } });
    await waitFor(() => expect(screen.getByText('Search and commands')).toBeTruthy());
    expect(within(document.body).queryByText('Go to Pages')).toBeNull();
    await fireEvent.input(search, { target: { value: 'zzz' } });
    await waitFor(() => expect(screen.getByText(/No shortcut matches/)).toBeTruthy());
  });
});
