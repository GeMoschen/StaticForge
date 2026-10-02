import '@angular/compiler';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoPipe } from '@jsverse/transloco';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SfSectionComponent } from '../../shared/components/layout/sf-section.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { PageEditorFormComponent } from './page-editor-form.component';
import { PageEditorSectionsService } from './page-editor-sections.service';
import { PageEditorStore } from './page-editor.store';
import { SectionPaletteService } from './section-palette.service';

const BODIES = [
  // The server sends no limit as `max: null` (or `0`) — a body without a limit is never full.
  { name: 'main', label: 'Main', max: null },
  { name: 'footer', max: 1 },
];
const SECTIONS: Record<string, { instanceId: string; templateRef: string }[]> = {
  main: [
    { instanceId: 's1', templateRef: 'hero' },
    { instanceId: 's2', templateRef: 'text' },
  ],
  footer: [{ instanceId: 's3', templateRef: 'links' }],
};

async function renderForm(options: { readOnly?: boolean; loading?: boolean; error?: string | null; editors?: unknown[] } = {}) {
  const store = {
    loading: signal(options.loading ?? false),
    error: signal(options.error ?? null),
    page: signal({ uuid: 'page-1' }),
    readOnly: signal(options.readOnly ?? false),
    selected: signal('fields'),
    contentDefinition: signal({ editors: options.editors ?? [{ name: 'title' }], bodies: BODIES }),
    focusedSection: signal<{ section: { instanceId: string } } | null>(null),
    focusedBody: signal<{ name: string } | null>(null),
    bodies: () => BODIES,
    sectionsFor: (body: string) => SECTIONS[body] ?? [],
    bodyCount: (body: string) => (SECTIONS[body] ?? []).length,
    shownIssues: signal([]),
    projectKey: signal('proj'),
    uuid: signal('page-1'),
    autosave: { revision: signal(1) },
    editingLocale: signal(null),
    fields: {
      fieldsForm: () => null,
      rules: { fieldStates: () => [], hub: null },
      storedContent: () => ({}),
      localeLabels: () => ({}),
    },
  };
  const sections = {
    title: (ref: string) => ({ hero: 'Hero', text: 'Text', links: 'Links' })[ref] ?? ref,
    defFor: () => ({ editors: [], bodies: [] }),
    uidFor: (ref: string) => ref,
    onBodyDragOver: vi.fn(),
    onBodyDrop: vi.fn(),
    drag: signal(null),
  };
  const palette = { open: vi.fn() };
  // The form engine and the section cards are under test elsewhere: stand-ins mark where they are.
  TestBed.overrideComponent(PageEditorFormComponent, {
    set: {
      imports: [SfButtonComponent, SfEmptyStateComponent, SfIconComponent, SfSectionComponent, SfSpinnerComponent, TranslocoPipe],
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const result = await render(PageEditorFormComponent, {
    providers: [
      { provide: PageEditorStore, useValue: store },
      { provide: PageEditorSectionsService, useValue: sections },
      { provide: SectionPaletteService, useValue: palette },
    ],
  });
  return { ...result, store, palette };
}

describe('PageEditorFormComponent', () => {
  let scrolled: Element[];

  beforeEach(() => {
    scrolled = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
  });

  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('shows the page fields, then every body with its sections, in one scrolling form', async () => {
    await renderForm();

    expect(screen.getByRole('heading', { level: 2, name: 'Page fields' })).toBeTruthy();
    expect(document.querySelector('sf-content-form[data-sf-page-fields]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: /Main/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /footer/ })).toBeTruthy();
    expect(Array.from(document.querySelectorAll('sf-section-editor')).map((card) => card.id)).toEqual([
      'page-editor-card-s1',
      'page-editor-card-s2',
      'page-editor-card-s3',
    ]);
  });

  it('shows no page fields card for a template without page fields', async () => {
    await renderForm({ editors: [] });

    expect(screen.queryByRole('heading', { level: 2, name: 'Page fields' })).toBeNull();
  });

  it('opens the palette at the end of the body from Add section', async () => {
    const { palette } = await renderForm();

    fireEvent.click(screen.getAllByRole('button', { name: 'Add section' })[0]);

    expect(palette.open).toHaveBeenCalledWith(BODIES[0]);
  });

  it('opens the palette right after a section from the + between sections', async () => {
    const { palette } = await renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Add a section after Hero' }));

    expect(palette.open).toHaveBeenCalledWith(BODIES[0], 1, 'Hero');
  });

  it('offers no more sections in a body that is full (max)', async () => {
    await renderForm();

    // `footer` takes one section and has one: its Add section is disabled and it has no + after its section.
    expect((screen.getAllByRole('button', { name: 'Add section' })[1] as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Add a section after Links' })).toBeNull();
  });

  it('keeps Add section enabled in a body without a limit (max null), even when it has sections', async () => {
    await renderForm();

    expect((screen.getAllByRole('button', { name: 'Add section' })[0] as HTMLButtonElement).disabled).toBe(false);
  });

  it('offers no adding while read-only', async () => {
    await renderForm({ readOnly: true });

    expect(screen.queryByRole('button', { name: 'Add section' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add a section after/ })).toBeNull();
  });

  it('echoes the outline selection on its card', async () => {
    const { store } = await renderForm();

    store.selected.set('s2');

    await waitFor(() => expect(document.getElementById('page-editor-card-s2')?.classList.contains('is-selected')).toBe(true));
    expect(document.getElementById('page-editor-card-s1')?.classList.contains('is-selected')).toBe(false);
  });

  it('selects and scrolls to the section a link points at (?section=)', async () => {
    const { store } = await renderForm();

    store.focusedSection.set({ section: { instanceId: 's2' } });

    await waitFor(() => expect(store.selected()).toBe('s2'));
    await waitFor(() => expect(scrolled.map((element) => element.id)).toContain('page-editor-card-s2'));
  });

  it('does not scroll again when the page is saved while a section is linked to', async () => {
    const { store } = await renderForm();
    store.focusedSection.set({ section: { instanceId: 's2' } });
    await waitFor(() => expect(scrolled.map((element) => element.id)).toContain('page-editor-card-s2'));
    const count = scrolled.length;

    store.page.set({ uuid: 'page-1', saved: true } as never);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(scrolled).toHaveLength(count);
  });

  it('shows a spinner while loading and the error when the page cannot be loaded', async () => {
    await renderForm({ loading: true });
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('says why the page could not be loaded', async () => {
    await renderForm({ error: 'Not found' });

    expect(screen.getByText('Could not load page')).toBeTruthy();
    expect(screen.getByText('Not found')).toBeTruthy();
  });
});
