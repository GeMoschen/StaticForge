import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, within } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { FavoritesService } from '../../core/assets/favorites.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { FavoritesViewComponent } from './favorites-view.component';

const ENTRIES = [
  { kind: 'PAGE', uuid: 'p1', title: 'Our story', folderPath: '/pages_root/about/' },
  { kind: 'FOLDER', uuid: 'f1', title: 'Photos', folderPath: '/media_root/photos/' },
  { kind: 'RECORD', uuid: 'r1', title: 'Yirgacheffe', folderPath: '/content_root/coffees/' },
];

async function setup(entries: unknown[] = ENTRIES) {
  const favorites = { list: signal(entries as never[]), remove: vi.fn() };
  const view = await render(FavoritesViewComponent, {
    providers: [
      provideRouter([]),
      { provide: FavoritesService, useValue: favorites },
      { provide: FrameContextStore, useValue: { projectKey: signal('demo'), setItem: vi.fn() } },
    ],
  });
  return { ...view, favorites, navigate: vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) };
}

describe('FavoritesViewComponent', () => {
  it('lists the favorites of every store with their type and where they live', async () => {
    await setup();
    expect(screen.getByText('Our story')).toBeTruthy();
    expect(screen.getByText('Photos')).toBeTruthy();
    expect(screen.getByText('Yirgacheffe')).toBeTruthy();
    expect(screen.getByText('Folder')).toBeTruthy();
    expect(screen.getByText('Record')).toBeTruthy();
    expect(screen.getByText('about')).toBeTruthy();
  });

  it('opens a row in its own area', async () => {
    const { navigate } = await setup();
    fireEvent.click(screen.getByText('Yirgacheffe'));
    expect(navigate).toHaveBeenCalled();
    expect(navigate.mock.calls[0][0][2]).toBe('content');
  });

  it('takes a favorite off the list with its star, and says so', async () => {
    const { favorites } = await setup();
    const row = screen.getByText('Our story').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: /Remove “Our story” from favorites/ }));
    expect(favorites.remove).toHaveBeenCalledWith('p1');
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toBe('“Our story” removed from your favorites.');
  });

  it('explains the empty list', async () => {
    await setup([]);
    expect(screen.getByText('No favorites yet')).toBeTruthy();
  });
});
