import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { fireEvent, render, screen, within } from '@testing-library/angular';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { EDITOR_STATES, EDITOR_TYPES } from '../sample/forms/sample-editor-demo.component';
import { SgFormsComponent } from './sg-forms.component';

async function setup() {
  return render(SgFormsComponent, { providers: [provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
}

describe('SgFormsComponent (the Content form section)', () => {
  it('is a section with one h2 and shows every editor type in every state', async () => {
    await setup();
    expect(screen.getByRole('heading', { level: 2, name: 'Content form' })).toBeTruthy();
    const editors = document.querySelectorAll('.sg-editor');
    expect(editors).toHaveLength(EDITOR_TYPES.length);
    for (const editor of Array.from(editors)) {
      expect(editor.querySelectorAll('sf-sample-editor-demo')).toHaveLength(EDITOR_STATES.length);
    }
  });

  it('shows the four finding levels under one field, with the error announced assertively', async () => {
    await setup();
    const price = screen.getAllByText('Price')[0].closest('sf-field') as HTMLElement;
    expect(within(price).getAllByRole('status')).toHaveLength(3);
    expect(within(price).getByRole('alert')).toHaveTextContent('The price must be a positive number.');
  });

  it('shows a required error once per field: the rule’s, or the form’s when no rule says it', async () => {
    await setup();
    const server = screen.getByText('Required, and a rule says so too').closest('sf-field') as HTMLElement;
    expect(within(server).getAllByRole('alert')).toHaveLength(1);
    expect(within(server).queryByText('This field is required.')).toBeNull();
    const client = screen.getByText('Required, only the form knows').closest('sf-field') as HTMLElement;
    expect(within(client).getByRole('alert')).toHaveTextContent('This field is required.');
  });

  it('shows the language chip only when the template is localized, and "All languages" for a shared field', async () => {
    await setup();
    // A chip's text starts with its icon's ligature name; the label is what follows.
    const chips = () => Array.from(document.querySelectorAll('.sf-field__head .sf-field__tag')).map((el) => (el.textContent ?? '').replace(/^(translate|public|functions)/, '').trim());
    expect(chips()).toContain('English');
    expect(chips()).toContain('All languages');

    await fireEvent.click(screen.getByRole('radio', { name: 'Not localized' }));
    expect(chips().filter((chip) => chip === 'English' || chip === 'All languages')).toHaveLength(0);

    await fireEvent.click(screen.getByRole('radio', { name: 'All languages' }));
    expect(chips()).toContain('All languages');
    expect(chips()).not.toContain('English');
  });

  it('marks a computed editor with the Computed cue and makes it read-only', async () => {
    await setup();
    const text = document.querySelector('#sg-editor-text')!.closest('article')!;
    const computed = text.querySelectorAll('sf-sample-editor-demo')[3] as HTMLElement;
    expect(within(computed).getByText('Computed')).toBeTruthy();
    expect(within(computed).getByRole('textbox')).toHaveAttribute('readonly');
  });

  it('opts fields into the two-column layout with a class, nothing else', async () => {
    await setup();
    const grid = document.querySelector('.sg-forms__grid')!;
    expect(grid.querySelectorAll(':scope > .is-half').length).toBeGreaterThan(1);
    expect(grid.querySelectorAll(':scope > :not(.is-half)').length).toBeGreaterThan(0);
  });
});
