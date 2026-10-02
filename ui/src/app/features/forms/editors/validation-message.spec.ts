import '@angular/compiler';
import { Type } from '@angular/core';
import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import type { EditorDefinition } from '../form.model';
import { SfListEditor } from './list-editor.component';
import { SfNumberEditor } from './number-editor.component';
import { SfRichTextEditor } from './rich-text-editor.component';
import { SfTextEditor } from './text-editor.component';
import { SfTextareaEditor } from './textarea-editor.component';

const REQUIRED = 'This field is required.';

/**
 * Form controls are not signals: the editors' messages were `computed`s over `control.errors` alone, evaluated once, so
 * "This field is required" stayed under a field after it was filled (seen in the M30 journey's page editor).
 */
describe('editor validation messages follow the control', () => {
  const cases: { name: string; component: Type<unknown>; type: EditorDefinition['type']; field: string; value: string }[] = [
    { name: 'text', component: SfTextEditor, type: 'TEXT', field: 'textbox', value: 'Welcome' },
    { name: 'textarea', component: SfTextareaEditor, type: 'TEXTAREA', field: 'textbox', value: 'A teaser' },
    { name: 'number', component: SfNumberEditor, type: 'NUMBER', field: 'spinbutton', value: '42' },
  ];

  for (const { name, component, type, field, value } of cases) {
    it(`${name}: the required message goes when the field is filled and comes back when it is emptied`, async () => {
      const definition = { name: 'x', type, label: 'Field', required: true } as EditorDefinition;
      const control = new FormControl<string | null>(null, Validators.required);
      await render(component, { componentInputs: { definition, control } });
      expect(await screen.findByText(REQUIRED)).toBeTruthy();

      fireEvent.input(screen.getByRole(field), { target: { value } });

      await expect.poll(() => screen.queryByText(REQUIRED)).toBeNull();

      control.setValue(null);

      expect(await screen.findByText(REQUIRED)).toBeTruthy();
    });
  }

  it('rich text: the required message follows the value control of its group', async () => {
    const definition = { name: 'body', type: 'RICHTEXT', label: 'Body', required: true } as EditorDefinition;
    const control = new FormGroup({
      format: new FormControl('html'),
      value: new FormControl<string | null>(null, Validators.required),
    });
    await render(SfRichTextEditor, { componentInputs: { definition, control } });
    expect(await screen.findByText(REQUIRED)).toBeTruthy();

    control.controls.value.setValue('<p>Hello</p>');

    await expect.poll(() => screen.queryByText(REQUIRED)).toBeNull();
  });

  it('text: the character count follows the value', async () => {
    const definition = { name: 'x', type: 'TEXT', label: 'Field', maxLength: 20 } as EditorDefinition;
    const control = new FormControl<string>('abc');
    await render(SfTextEditor, { componentInputs: { definition, control } });
    expect(await screen.findByText('3/20')).toBeTruthy();

    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'abcdef' } });

    expect(await screen.findByText('6/20')).toBeTruthy();
  });

  it('list: adding a row up to the maximum disables "add" and removes the minimum message', async () => {
    const definition = {
      name: 'rows',
      type: 'LIST',
      label: 'Rows',
      min: 1,
      max: 1,
      items: [{ name: 'label', type: 'TEXT', label: 'Label' }],
    } as unknown as EditorDefinition;
    const control = new FormArray<FormGroup>([], (array) =>
      (array as FormArray).length < 1 ? { listMin: { required: 1 } } : null,
    );
    await render(SfListEditor, { componentInputs: { definition, control } });
    expect(await screen.findByText('At least 1 rows required')).toBeTruthy();
    expect(screen.getByText('Add row')).toBeTruthy();

    control.push(new FormGroup({ label: new FormControl('one') }));

    await expect.poll(() => screen.queryByText('At least 1 rows required')).toBeNull();
    expect(screen.queryByText('Add row')).toBeNull();
  });
});
