import '@angular/compiler';
import { FormControl, FormGroup } from '@angular/forms';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import type { EditorChrome } from '../editor-base';
import type { EditorDefinition } from '../form.model';
import { SfGroupEditor } from './group-editor.component';

const definition: EditorDefinition = {
  name: 'seo',
  type: 'GROUP',
  label: 'Search and sharing',
  help: 'What search engines and social cards show.',
  items: [
    { name: 'title', type: 'TEXT', label: 'Search title' },
    { name: 'canonical', type: 'TEXT', label: 'Canonical path' },
    { name: 'priority', type: 'NUMBER', label: 'Priority' },
  ],
};

const group = (value: Record<string, unknown> = {}) =>
  new FormGroup({
    title: new FormControl(value['title'] ?? ''),
    canonical: new FormControl(value['canonical'] ?? ''),
    priority: new FormControl(value['priority'] ?? null),
  });

async function setup(control: FormGroup, chrome: EditorChrome | null = null) {
  return render(SfGroupEditor, { componentInputs: { definition, control, chrome }, providers: [provideTranslocoTesting()] });
}

const toggle = () => screen.getByRole('button', { name: /Search and sharing/ });

describe('SfGroupEditor', () => {
  it('opens expanded with a disclosure button, the hint and its members', async () => {
    await setup(group());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('What search engines and social cards show.')).toBeTruthy();
    expect(screen.getByText('Search title')).toBeTruthy();
    expect(screen.getByText('Canonical path')).toBeTruthy();
  });

  it('closes and opens with the button, and the closed group names its first filled values', async () => {
    await setup(group({ title: 'Spring harvest arrives', canonical: '/news/spring-harvest', priority: 3 }));
    await fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().textContent).toContain('Spring harvest arrives · /news/spring-harvest');
    expect(document.querySelector<HTMLElement>('.sf-group__body')!.hidden).toBe(true);
    await fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().textContent).not.toContain('/news/spring-harvest');
  });

  it('skips empty members and numbers count as values in the summary', async () => {
    await setup(group({ priority: 5 }));
    await fireEvent.click(toggle());
    expect(toggle().textContent).toContain('5');
  });

  it('shows the language chip on the header and the findings of its members under it, most severe first', async () => {
    const chrome: EditorChrome = {
      tags: [{ label: 'All languages', icon: 'public' }],
      findings: [
        { level: 'hint', message: 'Keep it short.' },
        { level: 'error', message: 'The canonical path must start with a slash.' },
      ],
      required: false,
    };
    await setup(group(), chrome);
    expect(toggle().textContent).toContain('All languages');
    const messages = Array.from(document.querySelectorAll('sf-finding')).map((f) => f.textContent?.replace(/\s+/g, ' ').trim());
    expect(messages[0]).toContain('The canonical path must start with a slash.');
    expect(messages[1]).toContain('Keep it short.');
  });

  it('points the button at the body it opens', async () => {
    await setup(group());
    const body = document.getElementById(toggle().getAttribute('aria-controls')!);
    expect(body).toBe(document.querySelector('.sf-group__body'));
  });
});
