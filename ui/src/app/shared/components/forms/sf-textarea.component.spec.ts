import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfFieldComponent } from '../sf-field.component';
import { SfTextareaComponent } from './sf-textarea.component';

describe('SfTextareaComponent', () => {
  it('is a multi-line textbox labelled by its field, described by hint and error', async () => {
    await render(`<sf-field label="Notes" hint="Markdown" error="Too long" required><sf-textarea rows="6" /></sf-field>`, {
      imports: [SfFieldComponent, SfTextareaComponent],
    });

    const textarea = screen.getByRole('textbox', { name: 'Notes' });
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea).toHaveAttribute('rows', '6');
    expect(textarea).toHaveAccessibleDescription('Markdown Too long');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea).toHaveAttribute('aria-required', 'true');
  });

  it('takes aria-label, maxlength and monospace outside a field', async () => {
    await render(`<sf-textarea aria-label="Ids" maxlength="500" monospace />`, { imports: [SfTextareaComponent] });

    const textarea = screen.getByRole('textbox', { name: 'Ids' });
    expect(textarea).toHaveAttribute('maxlength', '500');
    expect(textarea).toHaveClass('sf-textarea--mono');
    expect(textarea).not.toHaveAttribute('aria-invalid');
  });

  it('is read-only or disabled on request', async () => {
    await render(`<sf-textarea aria-label="A" readonly /><sf-textarea aria-label="B" disabled />`, {
      imports: [SfTextareaComponent],
    });

    expect(screen.getByRole('textbox', { name: 'A' })).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: 'B' })).toBeDisabled();
  });

  it('is a ControlValueAccessor for reactive forms', async () => {
    @Component({
      standalone: true,
      imports: [SfTextareaComponent, ReactiveFormsModule],
      template: `<sf-textarea aria-label="Body" [formControl]="body" />`,
    })
    class Host {
      readonly body = new FormControl('Line 1');
    }
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.body;
    const textarea = screen.getByRole('textbox', { name: 'Body' });
    expect(textarea).toHaveValue('Line 1');

    fireEvent.input(textarea, { target: { value: 'Line 1\nLine 2' } });
    expect(control.value).toBe('Line 1\nLine 2');
    fireEvent.blur(textarea);
    expect(control.touched).toBe(true);

    control.disable();
    fixture.detectChanges();
    expect(textarea).toBeDisabled();
  });
});
