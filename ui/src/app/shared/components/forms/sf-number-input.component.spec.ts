import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfFieldComponent } from '../sf-field.component';
import { SfNumberInputComponent } from './sf-number-input.component';

describe('SfNumberInputComponent', () => {
  it('is a spinbutton labelled by its field, described by hint, error and unit', async () => {
    await render(
      `<sf-field label="Width" hint="Of the teaser" error="Too wide" required>
         <sf-number-input min="0" max="100" step="5" unit="px" />
       </sf-field>`,
      { imports: [SfFieldComponent, SfNumberInputComponent] },
    );

    const input = screen.getByRole('spinbutton', { name: 'Width' });
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('max', '100');
    expect(input).toHaveAttribute('step', '5');
    expect(input).toHaveAccessibleDescription('Of the teaser Too wide px');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-required', 'true');
  });

  it('takes aria-label outside a field and leaves unset limits off', async () => {
    await render(`<sf-number-input aria-label="Count" />`, { imports: [SfNumberInputComponent] });

    const input = screen.getByRole('spinbutton', { name: 'Count' });
    expect(input).not.toHaveAttribute('min');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('is read-only or disabled on request', async () => {
    await render(`<sf-number-input aria-label="A" readonly /><sf-number-input aria-label="B" disabled />`, {
      imports: [SfNumberInputComponent],
    });

    expect(screen.getByRole('spinbutton', { name: 'A' })).toHaveAttribute('readonly');
    expect(screen.getByRole('spinbutton', { name: 'B' })).toBeDisabled();
  });

  it('is a ControlValueAccessor holding a number or null', async () => {
    @Component({
      standalone: true,
      imports: [SfNumberInputComponent, ReactiveFormsModule],
      template: `<sf-number-input aria-label="Count" [formControl]="count" />`,
    })
    class Host {
      readonly count = new FormControl<number | null>(3);
    }
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.count;
    const input = screen.getByRole('spinbutton', { name: 'Count' });
    expect(input).toHaveValue(3);

    fireEvent.input(input, { target: { value: '12.5' } });
    expect(control.value).toBe(12.5);

    fireEvent.input(input, { target: { value: '' } });
    expect(control.value).toBeNull();

    // A browser reports unparseable text (`1e`) as an empty value: null as well.
    fireEvent.input(input, { target: { value: 'abc' } });
    expect(control.value).toBeNull();

    control.setValue(7);
    fixture.detectChanges();
    expect(input).toHaveValue(7);

    control.setValue(null);
    fixture.detectChanges();
    expect(input).toHaveValue(null);

    fireEvent.blur(input);
    expect(control.touched).toBe(true);

    control.disable();
    fixture.detectChanges();
    expect(input).toBeDisabled();
  });

  it('does not rewrite what the user typed when the value is unchanged', async () => {
    @Component({
      standalone: true,
      imports: [SfNumberInputComponent, ReactiveFormsModule],
      template: `<sf-number-input aria-label="Count" [formControl]="count" />`,
    })
    class Host {
      readonly count = new FormControl<number | null>(null);
    }
    const { fixture } = await render(Host);
    const input = screen.getByRole('spinbutton', { name: 'Count' }) as HTMLInputElement;

    fireEvent.input(input, { target: { value: '1.50' } });
    fixture.detectChanges();
    expect(fixture.componentInstance.count.value).toBe(1.5);
    expect(input.value).toBe('1.50');
  });

  it('clears half-typed text on a form reset', async () => {
    @Component({
      standalone: true,
      imports: [SfNumberInputComponent, ReactiveFormsModule],
      template: `<sf-number-input aria-label="Count" [formControl]="count" />`,
    })
    class Host {
      readonly count = new FormControl<number | null>(null);
    }
    const { fixture } = await render(Host);
    const input = screen.getByRole('spinbutton', { name: 'Count' }) as HTMLInputElement;
    // A browser shows "1e" but reports value "" (bad input); jsdom would sanitise it, so emulate that.
    let shown = '1e';
    Object.defineProperty(input, 'value', { configurable: true, get: () => '', set: (text: string) => (shown = text) });
    fireEvent.input(input);
    expect(fixture.componentInstance.count.value).toBeNull();

    fixture.componentInstance.count.reset();
    expect(shown).toBe('');
  });
});
