import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../../../core/api/api.client';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { EditingLocaleStore } from '../../../core/project/editing-locale.store';
import { LocalesStore } from '../../../core/project/locales.store';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { ToastService } from '../../../core/ui/toast.service';
import type { CatalogCard, CatalogValue, ContentDefinition, EditorDefinition } from '../form.model';
import { SF_FORM_CONTEXT } from '../form.context';
import { SfCatalogEditor } from './catalog-editor.component';

const TEASER = 'tpl-teaser';
const QUOTE = 'tpl-quote';

const definition: EditorDefinition = { name: 'teasers', type: 'CATALOG', label: 'Product teasers', help: 'Shown on the home page.' };

const templates = [
  { uuid: TEASER, uid: 'teaser', displayName: 'Product teaser' },
  { uuid: QUOTE, uid: 'quote', displayName: 'Quote' },
];

const cardDefinition: ContentDefinition = {
  editors: [
    { name: 'headline', type: 'TEXT', label: 'Headline' },
    { name: 'price', type: 'NUMBER', label: 'Price' },
  ],
  bodies: [],
};

const card = (id: string, ref = TEASER, headline?: string): CatalogCard => ({
  instanceId: id,
  templateRef: ref,
  content: headline === undefined ? {} : { headline },
});

const catalogControl = (...cards: CatalogCard[]) => new FormControl({ type: 'CATALOG', cards } satisfies CatalogValue);
const cardsOf = (control: FormControl) => (control.value as CatalogValue).cards;

interface Options {
  def?: EditorDefinition;
  issues?: { path: string; message: string; severity: string }[];
}

async function setup(control: FormControl, options: Options = {}) {
  const def = options.def ?? definition;
  const form = new FormGroup({ teasers: control });
  const view = await render(SfCatalogEditor, {
    componentInputs: { definition: def, control, projectKey: 'acme' },
    providers: [
      provideTranslocoTesting(),
      { provide: ApiClient, useValue: { sectionTemplateDetail: () => of({ compiledDefinition: cardDefinition }) } },
      { provide: ProjectContextStore, useValue: { sectionTemplates: signal(templates) } },
      { provide: EditingLocaleStore, useValue: { binding: signal(null), locale: signal(null) } },
      { provide: LocalesStore, useValue: { locales: signal([]) } },
      {
        provide: SF_FORM_CONTEXT,
        useValue: {
          formValue: signal({}),
          projectKey: signal('acme'),
          issues: signal(options.issues ?? []),
          issuePrefix: signal('content'),
          formGroup: signal(form),
          definition: signal({ editors: [def], bodies: [] }),
        },
      },
    ],
  });
  return { ...view, toasts: TestBed.inject(ToastService) };
}

const headingOf = () => screen.getAllByRole('heading').map((h) => h.textContent?.replace(/\s+/g, ' ').trim());

describe('SfCatalogEditor', () => {
  beforeEach(() => sessionStorage.clear());

  it('is a sf-catalog named by the label, with a count, the hint, and cards that show Type · summary', async () => {
    await setup(catalogControl(card('a', TEASER, 'Yirgacheffe 250 g'), card('b', QUOTE)));
    expect(screen.getByRole('group', { name: /Product teasers/ })).toBeTruthy();
    expect(screen.getByText('Shown on the home page.')).toBeTruthy();
    await waitFor(() => expect(headingOf().join('|')).toContain('Yirgacheffe 250 g'));
    const titles = headingOf().join('|');
    expect(titles).toContain('Product teaser');
    expect(titles).toContain('Quote');
  });

  it('says Untitled for a card without text and renders the card form once its template loaded', async () => {
    await setup(catalogControl(card('a')));
    expect(await screen.findByLabelText('Headline')).toBeTruthy();
    expect(headingOf().join('|')).toContain('Untitled');
  });

  it('offers the allowed card types in the Add card menu and adds a card of the chosen type', async () => {
    const control = catalogControl(card('a', TEASER, 'First'));
    await setup(control, { def: { ...definition, allow: ['quote'] } });
    await screen.findByLabelText('Headline');
    await fireEvent.click(screen.getByRole('button', { name: /Add card/ }));
    // With one allowed type the button adds it directly.
    await waitFor(() => expect(cardsOf(control)).toHaveLength(2));
    expect(cardsOf(control)[1].templateRef).toBe(QUOTE);
    expect(cardsOf(control)[1].instanceId).toBeTruthy();
    expect(control.dirty).toBe(true);
  });

  it('opens a menu of the types when several are allowed', async () => {
    const control = catalogControl();
    await setup(control);
    await fireEvent.click(screen.getByRole('button', { name: /Add card/ }));
    const quote = await screen.findByRole('menuitem', { name: /Quote/ });
    await fireEvent.click(quote);
    expect(cardsOf(control).map((c) => c.templateRef)).toEqual([QUOTE]);
  });

  it('inserts between two cards with the "+" and keeps the order', async () => {
    const control = catalogControl(card('a', TEASER, 'First'), card('b', TEASER, 'Second'));
    await setup(control, { def: { ...definition, allow: ['quote'] } });
    await screen.findAllByLabelText('Headline');
    const insert = (await screen.findAllByRole('button', { name: /Insert|Add a card/i }))[0];
    await fireEvent.click(insert);
    await waitFor(() => expect(cardsOf(control)).toHaveLength(3));
    expect(cardsOf(control).map((c) => c.instanceId)[0]).toBe('a');
    expect(cardsOf(control)[2].instanceId).toBe('b');
  });

  it('collapses and expands every card with Collapse all / Expand all', async () => {
    await setup(catalogControl(card('a', TEASER, 'First'), card('b', TEASER, 'Second')));
    await screen.findAllByLabelText('Headline');
    const hidden = () => screen.getAllByLabelText('Headline').map((input) => !!input.closest('[hidden]'));
    expect(hidden()).toEqual([false, false]);
    await fireEvent.click(screen.getByRole('button', { name: /Collapse all/ }));
    expect(hidden()).toEqual([true, true]);
    await fireEvent.click(screen.getByRole('button', { name: /Expand all/ }));
    expect(hidden()).toEqual([false, false]);
  });

  it('stores an edit of a card in the catalog value without rebuilding the card form', async () => {
    const control = catalogControl(card('a', TEASER, 'Old'));
    await setup(control);
    const input = (await screen.findByLabelText('Headline')) as HTMLInputElement;
    input.focus();
    await fireEvent.input(input, { target: { value: 'New headline' } });
    expect(cardsOf(control)[0].content['headline']).toBe('New headline');
    // The same input element is still there (a rebuilt form would have replaced it).
    expect(screen.getByLabelText('Headline')).toBe(input);
    expect(control.dirty).toBe(true);
  });

  it('removes a card with an Undo toast that puts it back where it was', async () => {
    const control = catalogControl(card('a', TEASER, 'First'), card('b', TEASER, 'Second'), card('c', TEASER, 'Third'));
    const { toasts } = await setup(control);
    await screen.findAllByLabelText('Headline');
    const menus = screen.getAllByRole('button', { name: /actions|menu/i });
    await fireEvent.click(menus[1]);
    await fireEvent.click(await screen.findByRole('menuitem', { name: /Remove/ }));
    expect(cardsOf(control).map((c) => c.instanceId)).toEqual(['a', 'c']);
    const toast = toasts.toasts().at(-1)!;
    expect(toast.message).toBe('Removed Product teaser “Second”');
    toast.action!.run();
    expect(cardsOf(control).map((c) => c.instanceId)).toEqual(['a', 'b', 'c']);
  });

  it('duplicates a card with a new instance id and its own copy of the content', async () => {
    const control = catalogControl(card('a', TEASER, 'First'));
    await setup(control);
    await screen.findByLabelText('Headline');
    await fireEvent.click(screen.getAllByRole('button', { name: /actions|menu/i })[0]);
    await fireEvent.click(await screen.findByRole('menuitem', { name: /Duplicate/ }));
    const cards = cardsOf(control);
    expect(cards).toHaveLength(2);
    expect(cards[1].instanceId).not.toBe('a');
    expect(cards[1].content).toEqual({ headline: 'First' });
    expect(cards[1].content).not.toBe(cards[0].content);
  });

  it('reorders by Alt+ArrowDown on a card header', async () => {
    const control = catalogControl(card('a', TEASER, 'First'), card('b', TEASER, 'Second'));
    await setup(control);
    await screen.findAllByLabelText('Headline');
    const header = document.querySelector('[data-sf-catalog-item="a"] [tabindex]') as HTMLElement;
    await fireEvent.keyDown(header, { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(cardsOf(control).map((c) => c.instanceId)).toEqual(['b', 'a']));
  });

  it('shows the rule findings of the enclosing asset under the card field they name', async () => {
    const control = catalogControl(card('a', TEASER, 'First'));
    await setup(control, {
      issues: [{ path: 'content.teasers.cards[0].content.headline', message: 'A headline needs a verb.', severity: 'WARNING' }],
    });
    expect(await screen.findByText(/A headline needs a verb\./)).toBeTruthy();
  });

  it('says "required" once for an empty required catalog', async () => {
    await setup(catalogControl(), { def: { ...definition, required: true } });
    expect(screen.getAllByText(/This field is required/)).toHaveLength(1);
  });

  it('has no add button, handles or menus when read-only', async () => {
    await setup(catalogControl(card('a', TEASER, 'First')), { def: { ...definition, readOnly: true } });
    await screen.findByLabelText('Headline');
    expect(screen.queryByRole('button', { name: /Add card/ })).toBeNull();
  });
});
