import '@angular/compiler';
import { signal } from '@angular/core';
import { fireEvent, render, screen } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageEditorOutlineComponent } from './page-editor-outline.component';
import { PageEditorSectionsService } from './page-editor-sections.service';
import { PageEditorStore } from './page-editor.store';

const SECTIONS = {
  main: [
    { instanceId: 's1', templateRef: 'hero' },
    { instanceId: 's2', templateRef: 'text' },
  ],
  footer: [{ instanceId: 's3', templateRef: 'links' }],
};

async function renderOutline(options: { readOnly?: boolean; issues?: { path: string; severity: string }[] } = {}) {
  const store = {
    selected: signal('fields'),
    readOnly: signal(options.readOnly ?? false),
    shownIssues: signal(options.issues ?? []),
    contentDefinition: signal({ editors: [{ name: 'title' }], bodies: [] }),
    bodies: () => [
      { name: 'main', label: 'Main' },
      { name: 'footer' },
    ],
    sectionsFor: (body: string) => SECTIONS[body as keyof typeof SECTIONS] ?? [],
  };
  const sections = { title: (ref: string) => ({ hero: 'Hero', text: 'Text', links: 'Links' })[ref] ?? ref, moveBy: vi.fn() };
  const result = await render(PageEditorOutlineComponent, {
    providers: [
      { provide: PageEditorStore, useValue: store },
      { provide: PageEditorSectionsService, useValue: sections },
    ],
  });
  return { ...result, store, sections };
}

/** A card the outline scrolls to. */
function card(selection: string): HTMLElement {
  const element = document.createElement('div');
  element.id = `page-editor-card-${selection.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  element.scrollIntoView = vi.fn();
  document.body.appendChild(element);
  return element;
}

describe('PageEditorOutlineComponent', () => {
  afterEach(() => {
    document.body.querySelectorAll('[id^="page-editor-card-"]').forEach((element) => element.remove());
  });

  it('lists the page fields, each body and its sections as a listbox, sections indented', async () => {
    await renderOutline();

    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.querySelector('.outline__label')?.textContent)).toEqual([
      'Page fields',
      'Main',
      'Hero',
      'Text',
      'footer',
      'Links',
    ]);
    expect(options.map((option) => option.classList.contains('is-section'))).toEqual([false, false, true, true, false, true]);
    expect(screen.getByRole('listbox', { name: 'Outline' })).toBeTruthy();
  });

  it('selects an entry on a click, scrolls the form to its card and keeps one tab stop', async () => {
    const { store } = await renderOutline();
    const hero = card('s1');

    fireEvent.click(screen.getByRole('option', { name: /Hero/ }));

    expect(store.selected()).toBe('s1');
    expect(hero.scrollIntoView).toHaveBeenCalled();
    const tabbable = screen.getAllByRole('option').filter((option) => option.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0].textContent).toContain('Hero');
  });

  it('keeps one tab stop on the first entry when the page has no fields', async () => {
    const { store } = await renderOutline();
    store.contentDefinition.set({ editors: [], bodies: [] });
    store.selected.set('s1');

    // The roving stop started on "Page fields", which is gone: the first entry takes it over.
    await Promise.resolve();
    const stops = screen.getAllByRole('option').filter((option) => option.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
  });

  it('moves the focus with the arrow keys, Home and End, and chooses with Enter', async () => {
    const { store } = await renderOutline();
    card('body:main');
    const first = screen.getByRole('option', { name: /Page fields/ });

    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    await Promise.resolve();
    expect(document.activeElement?.textContent).toContain('Main');

    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    await Promise.resolve();
    expect(document.activeElement?.textContent).toContain('Links');

    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    await Promise.resolve();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    await Promise.resolve();
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(store.selected()).toBe('body:main');
  });

  it('moves a section with Alt+↓ and Alt+↑ and announces where it went', async () => {
    const { sections } = await renderOutline();
    const hero = screen.getByRole('option', { name: /Hero/ });
    expect(hero.getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowUp Alt+ArrowDown');

    fireEvent.keyDown(hero, { key: 'ArrowDown', altKey: true });

    expect(sections.moveBy).toHaveBeenCalledWith('main', 0, 1);
    expect(document.body.textContent).toContain('Hero moved to position 2 of 2.');

    // The last section of a body cannot move down; the first cannot move up.
    sections.moveBy.mockClear();
    fireEvent.keyDown(screen.getByRole('option', { name: /Text/ }), { key: 'ArrowDown', altKey: true });
    fireEvent.keyDown(hero, { key: 'ArrowUp', altKey: true });
    expect(sections.moveBy).not.toHaveBeenCalled();
  });

  it('moves nothing, and shows no hint, while read-only', async () => {
    const { sections } = await renderOutline({ readOnly: true });
    const hero = screen.getByRole('option', { name: /Hero/ });

    fireEvent.keyDown(hero, { key: 'ArrowDown', altKey: true });

    expect(sections.moveBy).not.toHaveBeenCalled();
    expect(hero.getAttribute('aria-keyshortcuts')).toBeNull();
    expect(screen.queryByText(/moves the selected section/)).toBeNull();
  });

  it('marks an entry with the level of its most serious finding, in words', async () => {
    await renderOutline({
      issues: [
        { path: 'content.title', severity: 'WARNING' },
        { path: 'bodies.main[1].content.text', severity: 'INFO' },
        { path: 'bodies.main[1].content.caption', severity: 'ERROR' },
      ],
    });

    expect(screen.getByRole('option', { name: /Page fields/ }).textContent).toContain('Warnings');
    expect(screen.getByRole('option', { name: /Text/ }).textContent).toContain('Errors');
    expect(screen.getByRole('option', { name: /Hero/ }).querySelector('.outline__issue')).toBeNull();
  });
});
