import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ValidatorFn, Validators } from '@angular/forms';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { ShortcutService } from '../../../core/ui/shortcut.service';
import type { EditorChrome } from '../editor-base';
import type { EditorDefinition } from '../form.model';
import { SF_FORM_CONTEXT } from '../form.context';
import { SfRichTextEditor } from './rich-text-editor.component';

const definition: EditorDefinition = { name: 'body', type: 'RICHTEXT', label: 'Body text' };

function group(html = '<p>Hello</p>', validators: ValidatorFn[] = []): FormGroup {
  return new FormGroup({ format: new FormControl('html'), value: new FormControl(html, validators) });
}

async function setup(inputs: { definition?: EditorDefinition; control?: FormGroup; chrome?: EditorChrome | null } = {}) {
  const control = inputs.control ?? group();
  const view = await render(SfRichTextEditor, {
    componentInputs: { definition: inputs.definition ?? definition, control, chrome: inputs.chrome ?? null },
    providers: [
      provideTranslocoTesting(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SF_FORM_CONTEXT, useValue: { formValue: signal({}), projectKey: signal('acme') } },
    ],
  });
  return { ...view, control, shortcuts: TestBed.inject(ShortcutService) };
}

const body = () => document.querySelector<HTMLElement>('[data-sf-richtext-body]')!;
const tool = (id: string) => document.querySelector<HTMLButtonElement>(`[data-tool="${id}"]`)!;

describe('SfRichTextEditor', () => {
  let execCommand: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    execCommand = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = execCommand;
    (document as unknown as { queryCommandState: unknown }).queryCommandState = vi.fn(() => false);
  });
  afterEach(() => {
    delete (document as unknown as { execCommand?: unknown }).execCommand;
    delete (document as unknown as { queryCommandState?: unknown }).queryCommandState;
  });

  it('is a labelled textbox with a named toolbar of icon buttons, all nine by default', async () => {
    await setup();
    const textbox = screen.getByRole('textbox', { name: 'Body text' });
    expect(textbox.getAttribute('aria-multiline')).toBe('true');
    expect(textbox.innerHTML).toBe('<p>Hello</p>');
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' });
    expect(toolbar.querySelectorAll('button')).toHaveLength(9);
    expect(screen.getByRole('button', { name: 'Numbered list' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear formatting' })).toBeTruthy();
    expect(toolbar.getAttribute('aria-controls')).toBe(textbox.id);
  });

  it('shows only the commands the field names', async () => {
    await setup({ definition: { ...definition, features: ['bold', 'link'] } });
    expect(Array.from(document.querySelectorAll('[data-tool]')).map((b) => b.getAttribute('data-tool'))).toEqual(['bold', 'link']);
  });

  it('reports the pressed state of the caret through aria-pressed', async () => {
    (document.queryCommandState as ReturnType<typeof vi.fn>).mockImplementation((c: string) => c === 'bold');
    await setup();
    await fireEvent.focus(body());
    expect(tool('bold').getAttribute('aria-pressed')).toBe('true');
    expect(tool('italic').getAttribute('aria-pressed')).toBe('false');
  });

  it('runs a command on the text and writes the HTML back to the value control', async () => {
    const { control } = await setup();
    execCommand.mockImplementation((command: string) => {
      if (command === 'bold') {
        body().innerHTML = '<p><b>Hello</b></p>';
      }
      return true;
    });
    await fireEvent.click(tool('bold'));
    expect(execCommand).toHaveBeenCalledWith('bold');
    expect(control.get('value')!.value).toBe('<p><b>Hello</b></p>');
    expect(control.get('value')!.dirty).toBe(true);
  });

  it('toggles a heading off again when the caret is already in one', async () => {
    await setup({ control: group('<h2>Title</h2>') });
    const text = body().querySelector('h2')!.firstChild!;
    window.getSelection()!.setBaseAndExtent(text, 1, text, 1);
    await fireEvent.click(tool('h2'));
    expect(execCommand).toHaveBeenCalledWith('formatBlock', false, 'p');
  });

  it('is one tab stop: arrows, Home and End move the focus along the toolbar, Escape returns to the text', async () => {
    await setup();
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tool]'));
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    buttons[0].focus();
    await fireEvent.keyDown(buttons[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[1]);
    await fireEvent.keyDown(buttons[1], { key: 'End' });
    expect(document.activeElement).toBe(buttons[8]);
    await fireEvent.keyDown(buttons[8], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[0]);
    await fireEvent.keyDown(buttons[0], { key: 'Escape' });
    expect(document.activeElement).toBe(body());
  });

  it('Alt+F10 moves the focus from the text to the toolbar; Ctrl+B and Ctrl+I format from the text only', async () => {
    await setup();
    body().focus();
    await fireEvent.keyDown(body(), { key: 'F10', code: 'F10', altKey: true });
    expect(document.activeElement).toBe(tool('bold'));

    body().focus();
    await fireEvent.keyDown(body(), { key: 'b', ctrlKey: true });
    expect(execCommand).toHaveBeenCalledWith('bold');
    await fireEvent.keyDown(body(), { key: 'i', ctrlKey: true });
    expect(execCommand).toHaveBeenCalledWith('italic');
  });

  it('lists its shortcuts in the registry while it lives', async () => {
    const { shortcuts, fixture } = await setup();
    expect(shortcuts.commands().map((c) => c.id)).toEqual(expect.arrayContaining(['richToolbar', 'richBold', 'richItalic', 'richLink']));
    fixture.destroy();
    expect(shortcuts.commands().map((c) => c.id)).not.toContain('richBold');
  });

  describe('the link dialog', () => {
    it('replaces window.prompt: Apply stays disabled until the address is valid', async () => {
      const prompt = vi.spyOn(window, 'prompt');
      await setup();
      body().focus();
      await fireEvent.click(tool('link'));
      const dialog = await screen.findByRole('dialog');
      expect(prompt).not.toHaveBeenCalled();
      const apply = screen.getByRole('button', { name: 'Apply' });
      expect(apply).toHaveProperty('disabled', true);
      const address = screen.getByRole('textbox', { name: /Address/ });
      await fireEvent.input(address, { target: { value: 'example.com' } });
      expect(apply).toHaveProperty('disabled', true);
      await waitFor(() => expect(dialog.textContent).toContain('Enter a web address'));
      await fireEvent.input(address, { target: { value: 'https://example.com' } });
      await waitFor(() => expect(apply).toHaveProperty('disabled', false));
    });

    it('applies the link with the new-tab choice', async () => {
      const { control } = await setup();
      const text = body().querySelector('p')!.firstChild!;
      body().focus();
      window.getSelection()!.setBaseAndExtent(text, 0, text, 5);
      await fireEvent.blur(body());
      execCommand.mockImplementation((command: string, _ui: boolean, value: string) => {
        if (command === 'createLink') {
          body().innerHTML = `<p><a href="${value}">Hello</a></p>`;
          const inner = body().querySelector('a')!.firstChild!;
          window.getSelection()!.setBaseAndExtent(inner, 0, inner, 5);
        }
        return true;
      });
      await fireEvent.click(tool('link'));
      await fireEvent.input(await screen.findByRole('textbox', { name: /Address/ }), { target: { value: 'https://example.com' } });
      await fireEvent.click(screen.getByRole('checkbox', { name: 'Open in a new tab' }));
      await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      expect(execCommand).toHaveBeenCalledWith('createLink', false, 'https://example.com');
      const html = String(control.get('value')!.value);
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener"');
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('edits an existing link when the caret is in one, and can remove it', async () => {
      const { control } = await setup({ control: group('<p><a href="https://old.example" target="_blank">Link</a></p>') });
      const text = body().querySelector('a')!.firstChild!;
      body().focus();
      window.getSelection()!.setBaseAndExtent(text, 1, text, 1);
      await fireEvent.blur(body());
      await fireEvent.click(tool('link'));
      const address = (await screen.findByRole('textbox', { name: /Address/ })) as HTMLInputElement;
      await waitFor(() => expect(address.value).toBe('https://old.example'));
      expect((screen.getByRole('checkbox', { name: 'Open in a new tab' }) as HTMLInputElement).checked).toBe(true);
      await fireEvent.input(address, { target: { value: 'https://new.example' } });
      await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      expect(String(control.get('value')!.value)).toContain('href="https://new.example"');

      window.getSelection()!.setBaseAndExtent(text, 1, text, 1);
      await fireEvent.blur(body());
      await fireEvent.click(tool('link'));
      await fireEvent.click(await screen.findByRole('button', { name: 'Remove link' }));
      expect(execCommand).toHaveBeenCalledWith('unlink');
    });

    it('offers the page picker', async () => {
      await setup();
      body().focus();
      await fireEvent.click(tool('link'));
      await fireEvent.click(await screen.findByRole('button', { name: 'Choose a page…' }));
      expect(await screen.findAllByRole('dialog')).toHaveLength(2);
    });
  });

  it('is readable but not editable when read-only: the toolbar is disabled', async () => {
    await setup({ definition: { ...definition, readOnly: true } });
    expect(body().getAttribute('contenteditable')).toBe('false');
    expect(body().getAttribute('aria-readonly')).toBe('true');
    expect(body().textContent).toBe('Hello');
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tool]'))) {
      expect(button.disabled).toBe(true);
    }
  });

  it('describes the textbox by its hint and findings, and marks it invalid on an error finding', async () => {
    await setup({
      definition: { ...definition, help: 'Shown on the page.' },
      chrome: { tags: [], findings: [{ level: 'error', message: 'Too short.' }, { level: 'info', message: 'Heads up.' }], required: false },
    });
    const textbox = screen.getByRole('textbox', { name: 'Body text' });
    expect(textbox.getAttribute('aria-invalid')).toBe('true');
    const described = textbox
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toContain('Shown on the page.');
    expect(described).toContain('Too short.');
    expect(described).toContain('Heads up.');
  });

  it('says required once when empty', async () => {
    await setup({ definition: { ...definition, required: true }, control: group('<p><br></p>') });
    expect(screen.getAllByText('This field is required.')).toHaveLength(1);
  });

  it('does not say required again when a rule already reports an error', async () => {
    await setup({
      definition: { ...definition, required: true },
      control: group(''),
      chrome: { tags: [], findings: [{ level: 'error', message: 'Please write something.' }], required: false },
    });
    expect(screen.queryByText('This field is required.')).toBeNull();
    expect(screen.getByText('Please write something.')).toBeTruthy();
  });

  it('shows the language chip from the form on the label line', async () => {
    await setup({ chrome: { tags: [{ label: 'English', icon: 'translate' }], findings: [], required: false } });
    expect(screen.getByText('English')).toBeTruthy();
  });

  it('shows the control validation (the character limit) as a finding, with the counter', async () => {
    const control = group('<p>Hello</p>', [Validators.maxLength(3)]);
    await setup({ definition: { ...definition, maxChars: 3 }, control });
    expect(screen.getByText('5/3')).toBeTruthy();
    expect(document.querySelector('sf-finding')).toBeTruthy();
  });
});
