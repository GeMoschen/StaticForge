import '@angular/compiler';
import { FormControl, FormGroup } from '@angular/forms';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import type { EditorDefinition } from '../form.model';
import { SfLinkEditor } from './link-editor.component';

const definition: EditorDefinition = { name: 'cta', type: 'LINK', label: 'Call to action' };

function linkGroup(): FormGroup {
  return new FormGroup({
    kind: new FormControl('INTERNAL'),
    uuid: new FormControl('page-1'),
    url: new FormControl(null),
    anchor: new FormControl(null),
    target: new FormControl(null),
    title: new FormControl(null),
  });
}

describe('SfLinkEditor', () => {
  it('swaps the fields and the summary when another link kind is selected', async () => {
    const control = linkGroup();
    await render(SfLinkEditor, { componentInputs: { definition, control } });
    fireEvent.click(screen.getByText('Edit'));
    expect(await screen.findByPlaceholderText('Target UUID')).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'EXTERNAL' } });

    expect(await screen.findByPlaceholderText('https://…')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Target UUID')).toBeNull();
    expect(control.value.kind).toBe('EXTERNAL');
    expect(document.querySelector('.sf-link__kind')?.textContent).toBe('external');
  });

  it("clears the old kind's destination and keeps only what the new kind shows", async () => {
    const control = linkGroup();
    control.patchValue({ kind: 'EXTERNAL', uuid: null, url: 'https://example.com', target: '_blank', title: 'Docs' });
    await render(SfLinkEditor, { componentInputs: { definition, control } });
    fireEvent.click(screen.getByText('Edit'));

    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'MAIL' } });

    expect(control.getRawValue()).toEqual({
      kind: 'MAIL',
      uuid: null,
      url: null,
      anchor: null,
      target: null,
      title: 'Docs',
    });
    expect(control.dirty).toBe(true);
  });

  it('leaves the fields alone when the value is set on the control from outside', async () => {
    const control = linkGroup();
    await render(SfLinkEditor, { componentInputs: { definition, control } });

    control.patchValue({ kind: 'EXTERNAL', url: 'https://example.com' });

    expect(control.getRawValue()).toMatchObject({ kind: 'EXTERNAL', uuid: 'page-1', url: 'https://example.com' });
  });

  it('follows a value set on the control from outside', async () => {
    const control = linkGroup();
    const { fixture } = await render(SfLinkEditor, { componentInputs: { definition, control } });

    control.patchValue({ kind: 'MAIL', url: 'hi@example.com' });
    fixture.detectChanges();

    expect(screen.getByText('mail')).toBeTruthy();
    expect(screen.getByText('hi@example.com')).toBeTruthy();
  });
});
