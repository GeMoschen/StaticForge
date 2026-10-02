import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { beforeEach, describe, expect, it } from 'vitest';
import { FavoritesService } from '../../core/assets/favorites.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ToastService } from '../../core/ui/toast.service';
import { SfAssetFavoriteComponent } from './sf-asset-favorite.component';

async function setup(props: Record<string, unknown> = { type: 'PAGE', uuid: 'u1', name: 'Our story' }) {
  const view = await render(SfAssetFavoriteComponent, {
    inputs: props,
    providers: [
      provideTranslocoTesting(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: FrameContextStore, useValue: { projectKey: computed(() => 'acme'), location: signal({ kind: 'project' }) } },
    ],
  });
  return { ...view, favorites: TestBed.inject(FavoritesService), shortcuts: TestBed.inject(ShortcutService), toasts: TestBed.inject(ToastService) };
}

describe('SfAssetFavoriteComponent', () => {
  beforeEach(() => localStorage.clear());

  it('is a pressed-state toggle that stars the asset and says so', async () => {
    const { favorites, toasts } = await setup();
    const button = screen.getByRole('button', { name: 'Add “Our story” to favorites' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(button);
    expect(favorites.isFavorite('u1')).toBe(true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove “Our story” from favorites' }).getAttribute('aria-pressed')).toBe('true'));
    expect(toasts.toasts().at(-1)?.message).toContain('added to your favorites');
    await fireEvent.click(screen.getByRole('button', { name: 'Remove “Our story” from favorites' }));
    expect(favorites.isFavorite('u1')).toBe(false);
  });

  it('renders nothing until the asset has loaded', async () => {
    await setup({ type: 'PAGE', uuid: null });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers the toggle as a palette action for the open asset, for as long as it is on the screen', async () => {
    const { shortcuts, favorites, fixture } = await setup();
    const action = shortcuts.actions().find((c) => c.id === 'favorite');
    expect(action?.palette?.context?.()).toBe('Our story');
    action!.handler!();
    expect(favorites.isFavorite('u1')).toBe(true);
    fixture.destroy();
    expect(shortcuts.actions().some((c) => c.id === 'favorite')).toBe(false);
  });
});
