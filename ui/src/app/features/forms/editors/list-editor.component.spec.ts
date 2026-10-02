import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { ShortcutService } from '../../../core/ui/shortcut.service';
import { ToastService } from '../../../core/ui/toast.service';
import type { EditorDefinition } from '../form.model';
import { SfListEditor } from './list-editor.component';

const definition: EditorDefinition = {
  name: 'points',
  type: 'LIST',
  label: 'Selling points',
  help: 'Shown under the teaser.',
  items: [{ name: 'text', type: 'TEXT', label: 'Point' }],
};

const row = (text: string) => new FormGroup({ text: new FormControl(text) });
const rows = (...texts: string[]): FormArray => new FormArray<any>(texts.map(row));
const texts = (array: FormArray) => array.controls.map((c) => (c as FormGroup).value.text);

async function setup(array: FormArray, def: EditorDefinition = definition) {
  const view = await render(SfListEditor, { componentInputs: { definition: def, control: array }, providers: [provideTranslocoTesting()] });
  return { ...view, toasts: TestBed.inject(ToastService) };
}

const handle = (n: number) => document.querySelector<HTMLElement>(`[data-sf-list-handle="${n}"]`)!;

describe('SfListEditor', () => {
  it('is a labelled field with its hint, one row per control and an add button', async () => {
    await setup(rows('Washed', 'Single estate'));
    expect(screen.getByText('Selling points')).toBeTruthy();
    expect(screen.getByText('Shown under the teaser.')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Selling points' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('2 rows')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add row' })).toBeTruthy();
  });

  it('adds a row at the end', async () => {
    const array = rows('Washed');
    await setup(array);
    await fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    expect(array.length).toBe(2);
    expect(array.dirty).toBe(true);
  });

  it('removes a row with an Undo toast that puts the same row back at the same place', async () => {
    const array = rows('A', 'B', 'C');
    const { toasts } = await setup(array);
    await fireEvent.click(screen.getByRole('button', { name: 'Remove row 2' }));
    expect(texts(array)).toEqual(['A', 'C']);
    const toast = toasts.toasts().at(-1)!;
    expect(toast.message).toBe('Row 2 removed.');
    toast.action!.run();
    expect(texts(array)).toEqual(['A', 'B', 'C']);
  });

  it('keeps the minimum and the maximum: no removing below min, no adding at max', async () => {
    await setup(rows('A'), { ...definition, min: 1 });
    expect((screen.getByRole('button', { name: 'Remove row 1' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides add at the maximum', async () => {
    await setup(rows('A', 'B'), { ...definition, max: 2 });
    expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull();
  });

  it('moves a row with Alt+ArrowDown / Alt+ArrowUp on its handle, announces it and keeps the focus on the handle', async () => {
    const array = rows('A', 'B', 'C');
    await setup(array);
    handle(0).focus();
    await fireEvent.keyDown(handle(0), { key: 'ArrowDown', altKey: true });
    expect(texts(array)).toEqual(['B', 'A', 'C']);
    await waitFor(() => expect(document.activeElement).toBe(handle(1)));
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('Row moved to position 2 of 3.');
    await fireEvent.keyDown(handle(1), { key: 'ArrowUp', altKey: true });
    expect(texts(array)).toEqual(['A', 'B', 'C']);
  });

  it('does nothing at the ends and ignores the arrows without Alt', async () => {
    const array = rows('A', 'B');
    await setup(array);
    await fireEvent.keyDown(handle(0), { key: 'ArrowUp', altKey: true });
    await fireEvent.keyDown(handle(0), { key: 'ArrowDown' });
    expect(texts(array)).toEqual(['A', 'B']);
  });

  it('lists the move keys on the ? sheet while it is on the screen', async () => {
    const { fixture } = await setup(rows('A'));
    const shortcuts = TestBed.inject(ShortcutService);
    expect(shortcuts.commands().map((c) => c.id)).toContain('editing.moveSectionUp');
    fixture.destroy();
    expect(shortcuts.commands().map((c) => c.id)).not.toContain('editing.moveSectionUp');
  });

  it('shows the minimum as a finding and says "required" once for an empty required list', async () => {
    const array: FormArray = new FormArray<any>([], { validators: () => ({ listMin: { required: 2, actual: 0 } }) });
    await setup(array, { ...definition, required: true });
    expect(await screen.findByText(/At least 2 rows required/)).toBeTruthy();
    expect(screen.queryAllByText(/This field is required/)).toHaveLength(0);
  });

  it('says "required" once when a required list is empty and nothing else reports it', async () => {
    await setup(rows(), { ...definition, required: true });
    expect(screen.getAllByText(/This field is required/)).toHaveLength(1);
  });

  it('shows the rows without handles or buttons when read-only', async () => {
    await setup(rows('A', 'B'), { ...definition, readOnly: true });
    expect(handle(0)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove row/ })).toBeNull();
  });
});
