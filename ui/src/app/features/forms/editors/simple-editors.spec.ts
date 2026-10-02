import '@angular/compiler';
import { Type } from '@angular/core';
import { FormControl, Validators } from '@angular/forms';
import { render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import type { EditorChrome } from '../editor-base';
import type { EditorDefinition } from '../form.model';
import { SfBooleanEditor } from './boolean-editor.component';
import { SfColorEditor } from './color-editor.component';
import { SfDateEditor } from './date-editor.component';
import { SfDatetimeEditor } from './datetime-editor.component';
import { SfJsonEditor } from './json-editor.component';
import { SfMarkdownEditor } from './markdown-editor.component';
import { SfMultiselectEditor } from './multiselect-editor.component';
import { SfNumberEditor } from './number-editor.component';
import { SfSelectEditor } from './select-editor.component';
import { SfTextEditor } from './text-editor.component';
import { SfTextareaEditor } from './textarea-editor.component';

const REQUIRED = 'This field is required.';
const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];
const MANY = ['a', 'b', 'c', 'd', 'e'].map((value) => ({ value, label: value.toUpperCase() }));

interface Case {
  name: string;
  type: EditorDefinition['type'];
  component: Type<unknown>;
  empty: unknown;
  extra?: Partial<EditorDefinition>;
  /** The control role, where one native control carries the label and the description. */
  role?: string;
  /** The editor treats its empty value as a value (a switch is never "empty"). */
  neverEmpty?: boolean;
}

const CASES: Case[] = [
  { name: 'text', type: 'TEXT', component: SfTextEditor, empty: '', role: 'textbox' },
  { name: 'textarea', type: 'TEXTAREA', component: SfTextareaEditor, empty: '', role: 'textbox' },
  { name: 'number', type: 'NUMBER', component: SfNumberEditor, empty: null, role: 'spinbutton' },
  { name: 'boolean', type: 'BOOLEAN', component: SfBooleanEditor, empty: false, neverEmpty: true },
  { name: 'date', type: 'DATE', component: SfDateEditor, empty: null },
  { name: 'datetime', type: 'DATETIME', component: SfDatetimeEditor, empty: null },
  { name: 'select (radios)', type: 'SELECT', component: SfSelectEditor, empty: '', extra: { options: OPTIONS } },
  { name: 'select (list)', type: 'SELECT', component: SfSelectEditor, empty: '', extra: { options: MANY } },
  { name: 'multiselect', type: 'MULTISELECT', component: SfMultiselectEditor, empty: [], extra: { options: OPTIONS } },
  { name: 'color', type: 'COLOR', component: SfColorEditor, empty: null },
  { name: 'json', type: 'JSON', component: SfJsonEditor, empty: '' },
  { name: 'markdown', type: 'MARKDOWN', component: SfMarkdownEditor, empty: '' },
];

async function setup(c: Case, over: Partial<EditorDefinition> = {}, chrome: EditorChrome | null = null, value: unknown = c.empty) {
  const definition = { name: 'x', type: c.type, label: 'Field', help: 'Helpful words', ...c.extra, ...over } as EditorDefinition;
  const control = new FormControl<unknown>(value, definition.required ? Validators.required : null);
  const view = await render(c.component, { componentInputs: { definition, control, chrome } });
  return { ...view, control, root: view.container as HTMLElement };
}

const head = (root: HTMLElement) => root.querySelector('.sf-field__head')?.textContent ?? '';
const findings = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('.sf-field__findings sf-finding'));

describe.each(CASES)('$name editor in its field', (c) => {
  it('shows the label and the hint, and the findings under the control with the language chip on the label line', async () => {
    const chrome: EditorChrome = {
      tags: [{ label: 'English', icon: 'translate' }],
      findings: [
        { level: 'hint', message: 'A hint.' },
        { level: 'error', message: 'A rule error.' },
        { level: 'warning', message: 'A warning.' },
      ],
      required: false,
    };
    const { root } = await setup(c, {}, chrome);
    expect(head(root)).toContain('Field');
    expect(head(root)).toContain('English');
    expect(root.querySelector('.sf-field__hint')?.textContent).toContain('Helpful words');
    // Most severe first, inside the field, after the control.
    expect(findings(root).map((f) => f.className.match(/sf-finding--(\w+)/)![1])).toEqual(['error', 'warning', 'hint']);
    expect(findings(root)[0].getAttribute('role')).toBe('alert');
    const body = root.querySelector('.sf-field__body')!;
    expect(body.querySelector('.sf-field__control')!.compareDocumentPosition(findings(root)[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  if (!c.neverEmpty) {
    it('says "required" once when the field is empty, and not again when a rule already reports an error', async () => {
      const { root } = await setup(c, { required: true });
      expect(root.querySelector('.sf-field__required')).not.toBeNull();
      expect(root.textContent?.match(/This field is required/g)).toHaveLength(1);
      expect(screen.getAllByText(REQUIRED)).toHaveLength(1);
    });

    it('does not repeat the required error when the rule finding is an error too', async () => {
      const chrome: EditorChrome = { tags: [], findings: [{ level: 'error', message: 'Title is required by a rule.' }], required: true };
      const { root } = await setup(c, { required: true }, chrome);
      expect(root.textContent).toContain('Title is required by a rule.');
      expect(root.textContent).not.toContain('This field is required');
    });
  }

  it('is required by a rule (chrome) even when the template does not say so', async () => {
    const { root } = await setup(c, {}, { tags: [], findings: [], required: true });
    expect(root.querySelector('.sf-field__required')).not.toBeNull();
  });

  if (c.role) {
    it('labels the control and describes it with the hint', async () => {
      await setup(c);
      const control = screen.getByRole(c.role!, { name: /Field/ });
      const describedBy = control.getAttribute('aria-describedby') ?? '';
      const hint = document.getElementById(describedBy.split(' ')[0]);
      expect(hint?.textContent).toContain('Helpful words');
    });

    it('is readable but not editable when read-only', async () => {
      await setup(c, { readOnly: true }, null, c.type === 'NUMBER' ? 5 : 'Kept');
      const control = screen.getByRole(c.role!);
      expect(control.hasAttribute('readonly')).toBe(true);
      expect(control.hasAttribute('disabled')).toBe(false);
    });
  }
});

describe('the control\'s own validation message is a finding of the field', () => {
  it('shows "Must be at most 5 characters" under a text field that is too long', async () => {
    const definition = { name: 'x', type: 'TEXT', label: 'Field', maxLength: 5 } as EditorDefinition;
    const control = new FormControl<string>('abcdefgh', Validators.maxLength(5));
    const { container } = await render(SfTextEditor, { componentInputs: { definition, control } });
    expect(findings(container as HTMLElement).map((f) => f.textContent)).toEqual([expect.stringContaining('Must be at most 5 characters')]);
  });

  it('shows "Must be valid JSON" for a JSON editor holding invalid JSON', async () => {
    const definition = { name: 'x', type: 'JSON', label: 'Field' } as EditorDefinition;
    const control = new FormControl<string>('{oops', () => ({ json: true }));
    const { container } = await render(SfJsonEditor, { componentInputs: { definition, control } });
    expect(findings(container as HTMLElement).map((f) => f.textContent)).toEqual([expect.stringContaining('Must be valid JSON')]);
  });
});
