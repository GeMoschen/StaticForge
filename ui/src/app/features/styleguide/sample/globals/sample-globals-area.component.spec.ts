import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { SpyLocation } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../../../core/ui/toast.service';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { SampleGlobalsAreaComponent } from './sample-globals-area.component';

async function setup(query: Record<string, string> = {}, confirm = true) {
  const confirms = { confirm: vi.fn().mockResolvedValue(confirm) };
  const result = await render(SampleGlobalsAreaComponent, {
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
      { provide: ConfirmService, useValue: confirms },
    ],
  });
  await screen.findAllByRole('treeitem');
  return { ...result, confirms };
}

/** The query string the area last wrote (it replaces the history entry in place). */
function watchQuery(): () => string {
  const replace = vi.spyOn(SpyLocation.prototype, 'replaceState');
  return () => String(replace.mock.lastCall?.[1] ?? '');
}

const h1 = () => screen.getByRole('heading', { level: 1 });
const tree = () => screen.getByRole('tree', { name: 'Globals' });
const nameOf = (row: Element) => row.querySelector('.sf-tree__name')?.textContent?.trim();
const rowNamed = (name: string) => within(tree()).getAllByRole('treeitem').find((r) => nameOf(r) === name)!;
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const hourRows = () => Array.from(document.querySelectorAll<HTMLElement>('.hours__row'));
const dayOf = (row: HTMLElement) => within(row).getByRole('textbox', { name: 'Day' });

describe('SampleGlobalsAreaComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists the global sets in their folders and asks for a selection', async () => {
    await setup();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(h1()).toHaveTextContent('Globals');
    expect(screen.getByText('Select a global set')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(tree()).getAllByRole('treeitem').map(nameOf)).toEqual(['Site', 'Site settings', 'Shop', 'Shop settings']),
    );
    // The tree has a filter.
    expect(screen.getByRole('searchbox', { name: 'Filter Globals' })).toBeInTheDocument();
  });

  it('opens a set from the query with its values, saved, and no developer-only parts', async () => {
    const url = watchQuery();
    await setup({ set: 'site' });

    expect(h1()).toHaveTextContent('Site settings');
    expect(screen.getByRole('textbox', { name: /^Site name/ })).toHaveValue('Kaffeerösterei Hafenblick');
    expect(screen.getByRole('textbox', { name: /^Contact e-mail/ })).toHaveValue('hello@hafenblick.example');
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    // The language chip only on the localized field.
    expect(screen.getAllByText('English')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: /^Footer text/ }) as HTMLTextAreaElement).toHaveProperty('value', expect.stringContaining('Roasted by hand'));
    // Social links as a catalog of cards.
    expect(screen.getByRole('group', { name: /Social links/ })).toBeInTheDocument();
    expect(screen.getByText(/@hafenblick\.coffee/, { selector: '.sf-card *' })).toBeInTheDocument();
    // Developer mode only: the Schema tab and the usage chips.
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent?.trim())).toEqual(['Values']);
    expect(document.body.textContent).not.toContain('CMS_GLOBAL');
    expect(url()).toContain('set=site');
    expect(url()).toContain('gtab=values');
  });

  it('enables Save only with unsaved changes', async () => {
    await setup({ set: 'site' });

    fireEvent.input(screen.getByRole('textbox', { name: /^Site name/ }), { target: { value: 'Hafenblick Coffee' } });
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();

    fireEvent.click(saveButton());
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('asks before leaving unsaved changes and stays when declined', async () => {
    const { confirms } = await setup({ set: 'site' }, false);
    await waitFor(() => expect(rowNamed('Shop settings')).toBeTruthy());

    fireEvent.input(screen.getByRole('textbox', { name: /^Site name/ }), { target: { value: 'Changed' } });
    fireEvent.click(rowNamed('Shop settings'));
    await waitFor(() => expect(confirms.confirm).toHaveBeenCalled());
    expect(h1()).toHaveTextContent('Site settings');
    await waitFor(() => expect(rowNamed('Site settings')).toHaveAttribute('aria-selected', 'true'));
  });

  it('shows the Shop settings with the currency and the threshold with its unit', async () => {
    await setup({ set: 'shop' });

    expect(h1()).toHaveTextContent('Shop settings');
    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveDisplayValue(/Euro/);
    expect(screen.getByRole('spinbutton', { name: /^Free shipping from/ })).toHaveValue(39);
    expect(screen.getByText('EUR')).toBeInTheDocument();
  });

  it('adds the Schema tab with the CDL and the usage chips in developer mode', async () => {
    await setup({ set: 'site', dev: '1', gtab: 'schema' });

    expect(screen.getByRole('tab', { name: 'Schema' })).toHaveAttribute('aria-selected', 'true');
    const editor = await screen.findByRole('textbox', { name: 'Schema of Site settings' });
    expect(editor.textContent).toContain('editor list openingHours');
    expect(screen.getByText('site.cdl')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Values' }));
    expect(await screen.findByText('$CMS_VALUE(CMS_GLOBAL.site.name)$')).toBeInTheDocument();
    expect(screen.getByText('$CMS_FOR(item : CMS_GLOBAL.site.openingHours)$')).toBeInTheDocument();
  });

  it('adds, removes (with Undo) and reorders opening hours with Alt+↑/↓', async () => {
    await setup({ set: 'site' });
    const undo = vi.spyOn(TestBed.inject(ToastService), 'undo');
    expect(hourRows().map((row) => (dayOf(row) as HTMLInputElement).value)).toEqual(['Monday – Friday', 'Saturday', 'Sunday']);

    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    await waitFor(() => expect(hourRows()).toHaveLength(4));

    fireEvent.click(screen.getByRole('button', { name: 'Remove row 4' }));
    await waitFor(() => expect(hourRows()).toHaveLength(3));
    expect(undo).toHaveBeenCalledWith('Row removed', expect.any(Function));

    const handle = hourRows()[0].querySelector<HTMLElement>('.hours__handle')!;
    fireEvent.keyDown(handle, { key: 'ArrowDown', altKey: true });
    await waitFor(() =>
      expect(hourRows().map((row) => (dayOf(row) as HTMLInputElement).value)).toEqual(['Saturday', 'Monday – Friday', 'Sunday']),
    );
    expect(screen.getByText('Row moved to position 2 of 3')).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Move row 2 up' }));
    await waitFor(() => expect((dayOf(hourRows()[0]) as HTMLInputElement).value).toBe('Monday – Friday'));
  });
});
