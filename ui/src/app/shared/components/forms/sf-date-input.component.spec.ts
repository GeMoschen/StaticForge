import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SF_BROWSER_LOCALE } from '../../../core/i18n/i18n-format.service';
import { SfFieldComponent } from '../sf-field.component';
import { SfDateInputComponent } from './sf-date-input.component';

// en-GB: day-first dates (31/12/2026), 24-hour clock, weeks from Monday.
const providers = [{ provide: SF_BROWSER_LOCALE, useValue: 'en-GB' }];

@Component({
  standalone: true,
  imports: [SfDateInputComponent, SfFieldComponent, ReactiveFormsModule],
  template: `
    <sf-field label="Publish on" hint="Local time" [error]="error">
      <sf-date-input [mode]="mode" [min]="min" [max]="max" [formControl]="control" />
    </sf-field>
    <button type="button">After</button>
  `,
})
class Host {
  mode: 'date' | 'time' | 'datetime' = 'date';
  min: string | null = null;
  max: string | null = null;
  error: string | null = null;
  readonly control = new FormControl<string | null>(null);
}

async function setup(props: Partial<Host> = {}) {
  const result = await render(Host, { componentProperties: props, providers });
  const control = result.fixture.componentInstance.control;
  const type = (element: HTMLElement, text: string) => {
    fireEvent.input(element, { target: { value: text } });
    result.fixture.detectChanges();
  };
  return { ...result, control, type };
}

describe('SfDateInputComponent', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 1, 9, 10)); // Thursday 1 October 2026, 09:10
  });
  afterEach(() => vi.useRealTimers());

  describe('date', () => {
    it('is a text field labelled by its field, described by hint and the locale format', async () => {
      await setup();

      const input = screen.getByRole('textbox', { name: 'Publish on' });
      expect(input).toHaveAttribute('placeholder', 'DD/MM/YYYY');
      expect(input).toHaveAccessibleDescription('Local time Format: 31/12/2026');
      expect(screen.getByRole('button', { name: 'Choose date' })).toHaveAttribute('aria-haspopup', 'dialog');
    });

    it('reads typed dates in the locale order (and ISO), tidying them on blur', async () => {
      const { control, type } = await setup();
      const input = screen.getByRole('textbox', { name: 'Publish on' }) as HTMLInputElement;

      type(input, '7/3/2026');
      expect(control.value).toBe('2026-03-07');
      expect(input.value).toBe('7/3/2026'); // not rewritten while typing
      fireEvent.blur(input);
      await waitFor(() => expect(input.value).toBe('07/03/2026'));
      expect(control.touched).toBe(true);

      type(input, '2026-12-24');
      expect(control.value).toBe('2026-12-24');
    });

    it('marks unreadable or impossible dates invalid and holds null', async () => {
      const { control, type } = await setup();
      const input = screen.getByRole('textbox', { name: 'Publish on' });

      type(input, '31/02/2026');
      expect(control.value).toBeNull();
      expect(input).toHaveAttribute('aria-invalid', 'true');
      type(input, '');
      expect(input).not.toHaveAttribute('aria-invalid');
    });

    it('treats dates outside min/max as invalid', async () => {
      const { control, type } = await setup({ min: '2026-10-01', max: '2026-10-31' });
      const input = screen.getByRole('textbox', { name: 'Publish on' });

      type(input, '15/11/2026');
      expect(control.value).toBeNull();
      expect(input).toHaveAttribute('aria-invalid', 'true');
      type(input, '15/10/2026');
      expect(control.value).toBe('2026-10-15');
    });

    it('shows a form value in the locale format and replaces invalid text on reset', async () => {
      const { control, fixture, type } = await setup();
      const input = screen.getByRole('textbox', { name: 'Publish on' }) as HTMLInputElement;

      control.setValue('2026-12-31');
      fixture.detectChanges();
      expect(input.value).toBe('31/12/2026');

      type(input, '99/99');
      control.reset();
      fixture.detectChanges();
      expect(input.value).toBe('');
      expect(input).not.toHaveAttribute('aria-invalid');
    });

    it('opens a modal calendar dialog on the button, focused on the selected day; picking fills the field', async () => {
      const { control, fixture } = await setup();
      control.setValue('2026-10-15');
      fixture.detectChanges();
      const button = screen.getByRole('button', { name: 'Choose date' });

      fireEvent.click(button);
      const dialog = await screen.findByRole('dialog', { name: 'Choose a date' });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(button).toHaveAttribute('aria-expanded', 'true');
      expect(document.activeElement).toHaveAttribute('data-day', '2026-10-15');

      fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
      fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
      expect(control.value).toBe('2026-10-16');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(button);
      expect(screen.getByRole('textbox', { name: 'Publish on' })).toHaveValue('16/10/2026');
    });

    it('opens the calendar with Alt+ArrowDown in the field and closes it with Escape', async () => {
      await setup();
      const input = screen.getByRole('textbox', { name: 'Publish on' });

      fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true });
      const dialog = await screen.findByRole('dialog');
      expect(document.activeElement).toHaveAttribute('data-day', '2026-10-01'); // today

      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose date' }));
    });

    it('keeps Tab inside the dialog', async () => {
      await setup();
      fireEvent.click(screen.getByRole('button', { name: 'Choose date' }));
      const dialog = await screen.findByRole('dialog');
      const today = screen.getByRole('button', { name: 'Today' });
      const clear = screen.getByRole('button', { name: 'Clear' });

      clear.focus();
      fireEvent.keyDown(clear, { key: 'Tab' });
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toHaveAccessibleName('Previous year');
      fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(clear);
      expect(today).toBeInTheDocument();
    });

    it('offers Today and Clear', async () => {
      const { control, fixture } = await setup();
      control.setValue('2026-12-31');
      fixture.detectChanges();

      fireEvent.click(screen.getByRole('button', { name: 'Choose date' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Today' }));
      expect(control.value).toBe('2026-10-01');

      fireEvent.click(screen.getByRole('button', { name: 'Choose date' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
      expect(control.value).toBeNull();
    });

    it('closes the dialog on a click outside', async () => {
      await setup();
      fireEvent.click(screen.getByRole('button', { name: 'Choose date' }));
      await screen.findByRole('dialog');

      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('is read-only or disabled: no picker', async () => {
      const { control, fixture } = await setup();
      control.disable();
      fixture.detectChanges();

      expect(screen.getByRole('textbox', { name: 'Publish on' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Choose date' })).toBeDisabled();
    });

    it('takes an error from its field', async () => {
      await setup({ error: 'Pick a date' });

      const input = screen.getByRole('textbox', { name: 'Publish on' });
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAccessibleDescription('Local time Pick a date Format: 31/12/2026');
    });
  });

  describe('time', () => {
    it('is a combobox reading typed 24 h and 12 h times', async () => {
      const { control, type } = await setup({ mode: 'time' });
      const input = screen.getByRole('combobox', { name: 'Publish on' }) as HTMLInputElement;

      expect(input).toHaveAttribute('placeholder', 'hh:mm');
      type(input, '2:30 pm');
      expect(control.value).toBe('14:30');
      fireEvent.blur(input);
      await waitFor(() => expect(input.value).toBe('14:30'));
      type(input, '25:00');
      expect(control.value).toBeNull();
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('opens a time list with ArrowDown near the current time, moves and picks with Enter', async () => {
      const { control } = await setup({ mode: 'time' });
      const input = screen.getByRole('combobox', { name: 'Publish on' });

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      const list = await screen.findByRole('listbox', { name: 'Times' });
      expect(input).toHaveAttribute('aria-expanded', 'true');
      expect(input).toHaveAttribute('aria-controls', list.id);
      const active = () => document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent?.trim();
      expect(active()).toBe('09:30'); // first slot at or after 09:10

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(active()).toBe('10:00');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(control.value).toBe('10:00');
      expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('closes the list with Escape and picks by click', async () => {
      const { control } = await setup({ mode: 'time' });
      const input = screen.getByRole('combobox', { name: 'Publish on' });

      fireEvent.keyDown(input, { key: 'ArrowUp' });
      await screen.findByRole('listbox');
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(screen.queryByRole('listbox')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Choose time', hidden: true }));
      fireEvent.click(await screen.findByRole('option', { name: '18:00' }));
      expect(control.value).toBe('18:00');
    });

    it('limits the list to min and max in time mode', async () => {
      await setup({ mode: 'time', min: '08:00', max: '09:00' });
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });

      const options = (await screen.findAllByRole('option')).map((option) => option.textContent?.trim());
      expect(options).toEqual(['08:00', '08:30', '09:00']);
    });
  });

  describe('datetime', () => {
    it('combines a date and a time field, the time labelled "<label> Time"', async () => {
      const { control, type } = await setup({ mode: 'datetime' });
      const date = screen.getByRole('textbox', { name: 'Publish on' });
      const time = screen.getByRole('combobox', { name: 'Publish on Time' });

      type(date, '24/12/2026');
      expect(control.value).toBeNull(); // incomplete
      type(time, '18:00');
      expect(control.value).toBe('2026-12-24T18:00');
    });

    it('shows a form value in both fields', async () => {
      const { control, fixture } = await setup({ mode: 'datetime' });

      control.setValue('2026-12-24T07:05');
      fixture.detectChanges();
      expect(screen.getByRole('textbox', { name: 'Publish on' })).toHaveValue('24/12/2026');
      expect(screen.getByRole('combobox', { name: 'Publish on Time' })).toHaveValue('07:05');
    });
  });

  it('takes aria-label outside a field, also for the time part', async () => {
    await render(`<sf-date-input mode="datetime" aria-label="Starts" />`, { imports: [SfDateInputComponent], providers });

    expect(screen.getByRole('textbox', { name: 'Starts' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Starts Time' })).toBeInTheDocument();
  });
});
