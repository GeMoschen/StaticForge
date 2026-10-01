import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfFieldComponent } from '../sf-field.component';
import { SfColorInputComponent, parseHex } from './sf-color-input.component';

@Component({
  standalone: true,
  imports: [SfColorInputComponent, ReactiveFormsModule],
  template: `<sf-color-input [formControl]="color" />`,
})
class Host {
  readonly color = new FormControl<string | null>('#3366ff');
}

describe('SfColorInputComponent', () => {
  it('names the hex input by its field and the swatch "Pick a colour"', async () => {
    await render(`<sf-field label="Accent" hint="Buttons and links" error="Too light" required><sf-color-input /></sf-field>`, {
      imports: [SfFieldComponent, SfColorInputComponent],
    });

    const hex = screen.getByRole('textbox', { name: 'Accent' });
    expect(hex).toHaveAccessibleDescription('Buttons and links Too light');
    expect(hex).toHaveAttribute('aria-invalid', 'true');
    expect(hex).toHaveAttribute('aria-required', 'true');
    const swatch = screen.getByLabelText('Pick a colour');
    expect(swatch).toHaveAttribute('type', 'color');
    expect(swatch).toHaveAccessibleDescription('Buttons and links Too light');
  });

  it('names the hex input "Hex value" outside a field, or by aria-label', async () => {
    await render(`<sf-color-input /><sf-color-input aria-label="Brand colour" />`, { imports: [SfColorInputComponent] });

    expect(screen.getByRole('textbox', { name: 'Hex value' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Brand colour' })).toBeInTheDocument();
  });

  it('keeps the swatch and the hex text in sync', async () => {
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.color;
    const hex = screen.getByRole('textbox', { name: 'Hex value' });
    const swatch = screen.getByLabelText('Pick a colour') as HTMLInputElement;
    expect(hex).toHaveValue('#3366ff');
    expect(swatch.value).toBe('#3366ff');

    fireEvent.input(swatch, { target: { value: '#AA0011' } });
    expect(control.value).toBe('#aa0011');
    fixture.detectChanges();
    expect(hex).toHaveValue('#aa0011');

    fireEvent.input(hex, { target: { value: 'F80' } });
    expect(control.value).toBe('#ff8800');
    fixture.detectChanges();
    expect(swatch.value).toBe('#ff8800');
    // The typed text stays until blur, then shows normalised.
    expect(hex).toHaveValue('F80');
    fireEvent.blur(hex);
    fixture.detectChanges();
    expect(hex).toHaveValue('#ff8800');
    expect(control.touched).toBe(true);
  });

  it('marks invalid text and does not emit until it is a colour', async () => {
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.color;
    const hex = screen.getByRole('textbox', { name: 'Hex value' });

    fireEvent.input(hex, { target: { value: '#33' } });
    fixture.detectChanges();
    expect(control.value).toBe('#3366ff');
    expect(hex).toHaveAttribute('aria-invalid', 'true');

    fireEvent.blur(hex);
    fixture.detectChanges();
    expect(hex).toHaveValue('#33');
    expect(hex).toHaveAttribute('aria-invalid', 'true');

    fireEvent.input(hex, { target: { value: '#336699' } });
    fixture.detectChanges();
    expect(control.value).toBe('#336699');
    expect(hex).not.toHaveAttribute('aria-invalid');

    fireEvent.input(hex, { target: { value: '' } });
    expect(control.value).toBeNull();
  });

  it('is a ControlValueAccessor: writeValue normalises, disable disables both parts', async () => {
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.color;
    const hex = screen.getByRole('textbox', { name: 'Hex value' });

    control.setValue('#ABC');
    fixture.detectChanges();
    expect(hex).toHaveValue('#aabbcc');

    control.setValue(null);
    fixture.detectChanges();
    expect(hex).toHaveValue('');

    control.disable();
    fixture.detectChanges();
    expect(hex).toBeDisabled();
    expect(screen.getByLabelText('Pick a colour')).toBeDisabled();
  });

  it('read-only: text is read-only and the picker cannot be opened', async () => {
    await render(`<sf-color-input readonly value="#112233" />`, { imports: [SfColorInputComponent] });

    const hex = screen.getByRole('textbox', { name: 'Hex value' });
    expect(hex).toHaveAttribute('readonly');
    expect(hex).toHaveValue('#112233');
    expect(screen.getByLabelText('Pick a colour')).toBeDisabled();
  });

  it('parses hex colours', () => {
    expect(parseHex('#ABCDEF')).toBe('#abcdef');
    expect(parseHex('abc')).toBe('#aabbcc');
    expect(parseHex('  ')).toBeNull();
    expect(parseHex('#abcd')).toBeUndefined();
    expect(parseHex('red')).toBeUndefined();
  });
});
