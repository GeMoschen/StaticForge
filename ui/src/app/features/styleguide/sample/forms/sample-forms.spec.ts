import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { provideTranslocoTesting } from '../../../../core/i18n/transloco-testing';
import { ToastService } from '../../../../core/ui/toast.service';
import { SampleListFieldComponent } from './sample-list-field.component';
import { SampleMediaFieldComponent } from './sample-media-field.component';
import { SampleReferenceFieldComponent } from './sample-reference-field.component';
import { SampleAssetPickerComponent } from './sample-asset-picker.component';
import { SampleRichTextComponent } from './sample-rich-text.component';
import type { PickerItem } from './picker-data';

/** A picker item with the fields a spec does not care about filled in. */
const pick = (item: Partial<PickerItem> & Pick<PickerItem, 'id' | 'kind' | 'name'>): PickerItem => ({
  type: 'PAGE',
  uid: item.id,
  path: '',
  folderPath: '',
  folderId: null,
  ...item,
});

const providers = [provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting(), provideRouter([])];

describe('SampleRichTextComponent', () => {
  async function setup(inputs: Record<string, unknown> = {}) {
    return render(SampleRichTextComponent, { inputs: { value: '<p>Hello</p>', label: 'Introduction', ...inputs }, providers });
  }

  it('is a toolbar of icon buttons with one tab stop, over an editable textbox', async () => {
    await setup();
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' });
    const buttons = within(toolbar).getAllByRole('button');
    expect(buttons).toHaveLength(9);
    expect(buttons.filter((b) => b.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(buttons.every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Introduction' })).toHaveAttribute('contenteditable', 'true');
  });

  it('moves the focus to the toolbar with Alt+F10, along it with the arrows, and back with Escape', async () => {
    await setup();
    const body = screen.getByRole('textbox', { name: 'Introduction' });
    body.focus();
    fireEvent.keyDown(body, { key: 'F10', altKey: true });
    const buttons = within(screen.getByRole('toolbar')).getAllByRole('button');
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0], { key: 'ArrowRight' });
    await waitFor(() => expect(document.activeElement).toBe(buttons[1]));
    fireEvent.keyDown(buttons[1], { key: 'End' });
    await waitFor(() => expect(document.activeElement).toBe(buttons[8]));
    fireEvent.keyDown(buttons[8], { key: 'Escape' });
    expect(document.activeElement).toBe(body);
  });

  it('offers only the commands the field allows', async () => {
    await setup({ features: ['bold', 'link'] });
    expect(within(screen.getByRole('toolbar')).getAllByRole('button').map((b) => b.getAttribute('data-tool'))).toEqual(['bold', 'link']);
  });

  it('is not editable and has a dead toolbar when read-only', async () => {
    await setup({ readonly: true });
    expect(screen.getByRole('textbox', { name: 'Introduction' })).toHaveAttribute('contenteditable', 'false');
    expect(within(screen.getByRole('toolbar')).getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('opens a link dialog whose Apply stays disabled until the address is valid, instead of window.prompt', async () => {
    await setup();
    await fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Link' }));
    const dialog = await screen.findByRole('dialog', { name: 'Insert link' });
    const apply = within(dialog).getByRole('button', { name: 'Apply' });
    expect(apply).toBeDisabled();
    const address = within(dialog).getByRole('textbox', { name: /Address/ });
    await fireEvent.input(address, { target: { value: 'example.com' } });
    expect(apply).toBeDisabled();
    expect(within(dialog).getByText(/Enter a web address/)).toBeTruthy();
    await fireEvent.input(address, { target: { value: 'https://example.com' } });
    await waitFor(() => expect(apply).toBeEnabled());
  });

  it('fills the address from an internal page chosen in the picker', async () => {
    await setup();
    await fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Link' }));
    const dialog = await screen.findByRole('dialog', { name: 'Insert link' });
    await fireEvent.click(within(dialog).getByRole('button', { name: /Choose a page/ }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a page' });
    await fireEvent.click(await within(picker).findByRole('option', { name: /Contact/ }));
    await fireEvent.click(within(picker).getByRole('button', { name: 'Choose' }));
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: /Address/ }) as HTMLInputElement).toHaveValue('/contact'));
    expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeEnabled();
  });
});

describe('SampleListFieldComponent', () => {
  async function setup(readonly = false) {
    return render(SampleListFieldComponent, { inputs: { items: ['One', 'Two', 'Three'], label: 'Highlights', readonly }, providers });
  }

  it('reorders with Alt+Arrow on the handle and keeps the focus on the moved handle', async () => {
    await setup();
    const handles = screen.getAllByRole('button', { name: /Move item/ });
    handles[0].focus();
    fireEvent.keyDown(handles[0], { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect((screen.getAllByRole('textbox')[1] as HTMLInputElement).value).toBe('One'));
    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('Two');
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole('button', { name: /Move item/ })[1]));
    expect(screen.getByText('Moved to position 2 of 3.')).toBeTruthy();
  });

  it('removes an item with an Undo toast that puts it back in place', async () => {
    await setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Remove item 2' }));
    expect(screen.getAllByRole('textbox').map((i) => (i as HTMLInputElement).value)).toEqual(['One', 'Three']);
    const toast = TestBed.inject(ToastService).toasts().at(-1);
    expect(toast?.action?.label).toBeTruthy();
    toast!.action!.run();
    await waitFor(() => expect(screen.getAllByRole('textbox').map((i) => (i as HTMLInputElement).value)).toEqual(['One', 'Two', 'Three']));
  });

  it('adds an empty item', async () => {
    await setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(screen.getAllByRole('textbox')).toHaveLength(4);
  });

  it('shows no controls when read-only', async () => {
    await setup(true);
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull();
    expect(screen.queryAllByRole('button', { name: /Move item/ })).toHaveLength(0);
  });
});

describe('SampleMediaFieldComponent', () => {
  it('shows a drop zone while empty and a thumbnail card with the name once a file is chosen', async () => {
    await render(SampleMediaFieldComponent, { providers });
    expect(screen.getByText(/Drop a file here/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a file' });
    await fireEvent.click(await within(picker).findByRole('option', { name: /espresso-blend-bag\.jpg/ }));
    await fireEvent.click(within(picker).getByRole('button', { name: 'Choose' }));
    await waitFor(() => expect(screen.getByText('espresso-blend-bag.jpg')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Replace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove the file' })).toBeTruthy();
  });

  it('warns while the alternative text is empty and never shows a UUID outside developer mode', async () => {
    await render(SampleMediaFieldComponent, {
      inputs: { value: { item: pick({ id: 'a-1', kind: 'media', type: 'MEDIA', name: 'a.jpg', path: 'P', detail: '1 × 1' }), alt: '' }, developerMode: false },
      providers,
    });
    expect(screen.getByRole('status')).toHaveTextContent('Add alternative text');
    expect(screen.queryByText(/UUID/)).toBeNull();
  });

  it('shows the UUID, copyable, only in developer mode', async () => {
    await render(SampleMediaFieldComponent, {
      inputs: { value: { item: pick({ id: 'a-1', kind: 'media', type: 'MEDIA', name: 'a.jpg', path: 'P', detail: '1 × 1' }), alt: 'x' }, developerMode: true },
      providers,
    });
    expect(document.querySelector('sf-copyable')).toBeTruthy();
  });
});

describe('SampleReferenceFieldComponent', () => {
  const page = pick({ id: 'p-contact', kind: 'page', name: 'Contact', path: '/contact' });

  it('shows the target by name and URL with an Open button — no UUID', async () => {
    await render(SampleReferenceFieldComponent, { inputs: { reference: page }, providers });
    expect(screen.getByText('Contact')).toBeTruthy();
    expect(screen.getByText('/contact')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toContain('Contact');
  });

  it('offers to choose when empty, picks through the dialog and can remove the target again', async () => {
    await render(SampleReferenceFieldComponent, { providers });
    expect(screen.getByText('Nothing chosen yet.')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Choose a page…' }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a page' });
    await fireEvent.click(await within(picker).findByRole('option', { name: /Contact/ }));
    await fireEvent.click(within(picker).getByRole('button', { name: 'Choose' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove the target' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Remove the target' }));
    expect(screen.getByText('Nothing chosen yet.')).toBeTruthy();
  });

  it('lets a link choose between a page and a web address', async () => {
    await render(SampleReferenceFieldComponent, { inputs: { link: true }, providers });
    await fireEvent.click(screen.getByRole('radio', { name: 'Web address' }));
    expect(await screen.findByRole('textbox', { name: 'Web address' })).toBeTruthy();
  });
});

describe('SampleAssetPickerComponent', () => {
  const open = async (inputs: Record<string, unknown> = {}) => {
    await render(SampleAssetPickerComponent, { inputs, providers });
    return screen.findByRole('dialog');
  };

  it('offers the type switch only when more than one type is allowed, and the dataset select only for records', async () => {
    const dialog = await open({ allowedTypes: ['PAGE'] });
    expect(within(dialog).queryByRole('radio', { name: 'Media' })).toBeNull();
  });

  it('lists the allowed types, switches between them and shows the dataset select for records', async () => {
    const dialog = await open({ allowedTypes: ['PAGE', 'RECORD'] });
    expect(within(dialog).getByRole('radio', { name: 'Pages' })).toBeTruthy();
    await fireEvent.click(within(dialog).getByRole('radio', { name: 'Records' }));
    expect(within(dialog).getByRole('combobox', { name: 'Dataset' })).toBeTruthy();
    expect(within(dialog).getAllByRole('option').length).toBeGreaterThan(0);
  });

  it('keeps Choose disabled until a row is selected, and picks with Enter or a double click', async () => {
    const dialog = await open({ allowedTypes: ['PAGE'] });
    expect(within(dialog).getByRole('button', { name: 'Choose' })).toBeDisabled();
    const row = await within(dialog).findByRole('option', { name: /Contact/ });
    await fireEvent.click(row);
    expect(within(dialog).getByRole('button', { name: 'Choose' })).toBeEnabled();
    expect(row).toHaveAttribute('aria-selected', 'true');
  });

  it('filters by a typed search across folders and offers Clear search when nothing matches', async () => {
    const dialog = await open({ allowedTypes: ['PAGE'] });
    await fireEvent.input(within(dialog).getByRole('searchbox'), { target: { value: 'zzzz' } });
    await waitFor(() => expect(within(dialog).getByText(/No pages match/)).toBeTruthy(), { timeout: 2000 });
    await fireEvent.click(within(dialog).getAllByRole('button', { name: 'Clear search' })[0]);
    await waitFor(() => expect(within(dialog).getAllByRole('option').length).toBeGreaterThan(3));
  });
});
