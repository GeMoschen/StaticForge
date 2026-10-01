import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfFieldComponent } from '../sf-field.component';
import { SfInputComponent } from './sf-input.component';

describe('SfInputComponent', () => {
  it('is a textbox labelled by its field, described by hint and error', async () => {
    await render(`<sf-field label="Title" hint="Shown in the tree" error="Required"><sf-input /></sf-field>`, {
      imports: [SfFieldComponent, SfInputComponent],
    });

    const input = screen.getByRole('textbox', { name: 'Title' });
    expect(input).toHaveAccessibleDescription('Shown in the tree Required');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('takes aria-label outside a field (not on the host)', async () => {
    await render(`<sf-input aria-label="Filter" placeholder="Type…" />`, { imports: [SfInputComponent] });

    const input = screen.getByRole('textbox', { name: 'Filter' });
    expect(input).toHaveAttribute('placeholder', 'Type…');
    expect(document.querySelector('sf-input')).not.toHaveAttribute('aria-label');
  });

  it('passes type, maxlength, autocomplete, spellcheck and monospace through', async () => {
    await render(
      `<sf-input aria-label="Uid" type="email" maxlength="20" autocomplete="off" [spellcheck]="false" monospace icon="key" />`,
      { imports: [SfInputComponent] },
    );

    const input = screen.getByRole('textbox', { name: 'Uid' });
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAttribute('maxlength', '20');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
    expect(input).toHaveClass('sf-input__control--mono');
    expect(document.querySelector('.sf-input__icon')?.textContent?.trim()).toBe('key');
  });

  it('is required, read-only and disabled on request', async () => {
    await render(
      `<sf-input aria-label="A" required /><sf-input aria-label="B" readonly /><sf-input aria-label="C" disabled />`,
      { imports: [SfInputComponent] },
    );

    expect(screen.getByRole('textbox', { name: 'A' })).toHaveAttribute('aria-required', 'true');
    expect(screen.getByRole('textbox', { name: 'A' })).toBeRequired();
    const readOnly = screen.getByRole('textbox', { name: 'B' });
    expect(readOnly).toHaveAttribute('readonly');
    expect(readOnly.closest('.sf-input')).toHaveClass('is-readonly');
    expect(screen.getByRole('textbox', { name: 'C' })).toBeDisabled();
  });

  it('is a ControlValueAccessor for reactive forms', async () => {
    @Component({
      standalone: true,
      imports: [SfInputComponent, ReactiveFormsModule],
      template: `<sf-input aria-label="Title" [formControl]="title" />`,
    })
    class Host {
      readonly title = new FormControl<string | null>('Home');
    }
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.title;
    const input = screen.getByRole('textbox', { name: 'Title' });
    expect(input).toHaveValue('Home');

    fireEvent.input(input, { target: { value: 'About' } });
    expect(control.value).toBe('About');
    expect(control.touched).toBe(false);
    fireEvent.blur(input);
    expect(control.touched).toBe(true);

    control.setValue(null);
    fixture.detectChanges();
    expect(input).toHaveValue('');

    control.disable();
    fixture.detectChanges();
    expect(input).toBeDisabled();
  });
});
