import '@angular/compiler';
import { signal } from '@angular/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import type { BodyDefinition } from '../forms';
import { SectionPaletteComponent } from './section-palette.component';
import { type PaletteTarget, SectionPaletteService } from './section-palette.service';

const BODY: BodyDefinition = { name: 'main', label: 'Main' };

const TEMPLATES = [
  { uuid: 't-hero', uid: 'hero', displayName: 'Hero', folderPath: '/heroes/' },
  { uuid: 't-banner', uid: 'banner', displayName: 'Banner', folderPath: '/heroes/' },
  { uuid: 't-text', uid: 'text', displayName: 'Text block', folderPath: '/content_blocks/' },
  { uuid: 't-misc', uid: 'misc', displayName: 'Misc', folderPath: '/' },
];

async function renderPalette(target: PaletteTarget | null, templates = TEMPLATES) {
  const palette = {
    target: signal<PaletteTarget | null>(target),
    allowedTemplates: vi.fn().mockReturnValue(templates),
    add: vi.fn(),
    close: vi.fn(),
  };
  await render(SectionPaletteComponent, { providers: [{ provide: SectionPaletteService, useValue: palette }] });
  return palette;
}

describe('SectionPaletteComponent', () => {
  it('renders nothing while closed', async () => {
    await renderPalette(null);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a dialog that names where the section goes', async () => {
    await renderPalette({ body: BODY, position: 1, after: 'Hero' });

    expect(await screen.findByRole('dialog', { name: 'Add a section' })).toBeTruthy();
    expect(screen.getByText('Insert after: Hero')).toBeTruthy();
  });

  it('says it inserts at the end or at the start of the body without a section to follow', async () => {
    await renderPalette({ body: BODY, position: 3, after: null });
    expect(await screen.findByText('Insert at the end of Main')).toBeTruthy();
  });

  it('shows every allowed template as a tile with its name and UID', async () => {
    await renderPalette({ body: BODY, position: 0, after: null });

    const tiles = await screen.findAllByRole('option');
    expect(tiles).toHaveLength(4);
    expect(tiles[0].textContent).toContain('Hero');
    expect(tiles[0].textContent).toContain('hero');
    expect(screen.getByRole('listbox', { name: 'Section templates' })).toBeTruthy();
  });

  it('files the templates under the folders they sit in, with counts, and filters by category', async () => {
    await renderPalette({ body: BODY, position: 0, after: null });
    const categories = await screen.findByRole('navigation', { name: 'Categories' });

    expect(categories.textContent).toContain('All');
    expect(categories.textContent).toContain('Heroes');
    expect(categories.textContent).toContain('Content blocks');
    expect(categories.textContent).toContain('Other');

    fireEvent.click(screen.getByRole('button', { name: /Heroes/ }));

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
  });

  it('has no categories to pick when every template sits in one folder', async () => {
    await renderPalette({ body: BODY, position: 0, after: null }, TEMPLATES.slice(0, 2));

    await screen.findAllByRole('option');
    expect(screen.queryByRole('navigation', { name: 'Categories' })).toBeNull();
  });

  it('filters by name, UID and category as you type, with the focus already in the field', async () => {
    await renderPalette({ body: BODY, position: 0, after: null });
    const field = await screen.findByRole('combobox', { name: 'Filter the templates' });
    await waitFor(() => expect(document.activeElement).toBe(field));

    fireEvent.input(field, { target: { value: 'block' } });

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(screen.getByRole('option').textContent).toContain('Text block');
  });

  it('says so, and offers to clear the filter, when no template matches', async () => {
    await renderPalette({ body: BODY, position: 0, after: null });
    const field = await screen.findByRole('combobox', { name: 'Filter the templates' });

    fireEvent.input(field, { target: { value: 'zzz' } });

    expect(await screen.findByText('No template matches “zzz”')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(4));
  });

  it('inserts the active tile with Enter, the first one to begin with, and the one the arrows chose', async () => {
    const palette = await renderPalette({ body: BODY, position: 2, after: 'Hero' });
    const field = await screen.findByRole('combobox', { name: 'Filter the templates' });

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(palette.add).toHaveBeenLastCalledWith(BODY, 't-hero');

    fireEvent.keyDown(field, { key: 'ArrowRight' });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(palette.add).toHaveBeenLastCalledWith(BODY, 't-banner');
  });

  it('inserts the tile that is clicked, and closes with Cancel', async () => {
    const palette = await renderPalette({ body: BODY, position: 0, after: null });

    fireEvent.click(await screen.findByRole('option', { name: /Text block/ }));
    expect(palette.add).toHaveBeenCalledWith(BODY, 't-text');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(palette.close).toHaveBeenCalled();
  });

  it('says what to do when the body allows no template', async () => {
    await renderPalette({ body: BODY, position: 0, after: null }, []);

    expect(await screen.findByText('This body allows no section templates yet.')).toBeTruthy();
  });
});
