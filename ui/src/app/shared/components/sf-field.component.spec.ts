import { Component, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfButtonComponent } from './sf-button.component';
import { SfFieldComponent, SfFieldErrorDirective } from './sf-field.component';

describe('SfFieldComponent', () => {
  it('labels a projected native input with <label for> and links its hint', async () => {
    await render(`<sf-field label="Name" hint="Shown in the tree"><input type="text" /></sf-field>`, {
      imports: [SfFieldComponent],
    });

    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveAccessibleDescription('Shown in the tree');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(document.querySelector('label')?.getAttribute('for')).toBe(input.id);
  });

  it('keeps an id and a description the input already has', async () => {
    await render(
      `<p id="own">Own note</p><sf-field label="Name" hint="Hint"><input id="mine" aria-describedby="own" /></sf-field>`,
      { imports: [SfFieldComponent] },
    );

    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input.id).toBe('mine');
    expect(input).toHaveAccessibleDescription('Own note Hint');
  });

  it('shows an error, marks the control invalid and describes it by the error', async () => {
    @Component({
      standalone: true,
      imports: [SfFieldComponent],
      template: `<sf-field label="Name" [error]="error()"><input /></sf-field>`,
    })
    class Host {
      readonly error = signal<string | null>(null);
    }
    const { fixture } = await render(Host);
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).not.toHaveAttribute('aria-invalid');

    fixture.componentInstance.error.set('A name is required');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('A name is required');

    fixture.componentInstance.error.set(null);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText('A name is required')).toBeNull();
  });

  it('leaves an aria-invalid the consumer set itself', async () => {
    await render(`<sf-field label="Name"><input aria-invalid="true" /></sf-field>`, { imports: [SfFieldComponent] });

    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('takes projected error content', async () => {
    await render(`<sf-field label="Uid"><input /><span sfFieldError>Already taken</span></sf-field>`, {
      imports: [SfFieldComponent, SfFieldErrorDirective],
    });

    const input = screen.getByRole('textbox', { name: 'Uid' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Already taken');
  });

  it('marks a required field (marker hidden, aria-required on the control)', async () => {
    await render(`<sf-field label="Name" required><input /></sf-field>`, { imports: [SfFieldComponent] });

    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows "(optional)" for an optional field', async () => {
    await render(`<sf-field label="Notes" optional><textarea></textarea></sf-field>`, { imports: [SfFieldComponent] });

    expect(screen.getByRole('textbox', { name: 'Notes (optional)' })).toBeInTheDocument();
  });

  it('does not leak the label into the name of a button inside the field', async () => {
    await render(
      `<sf-field label="Channel"><input /><sf-button variant="secondary">Save channel</sf-button></sf-field>`,
      { imports: [SfFieldComponent, SfButtonComponent] },
    );

    expect(screen.getByRole('button').textContent?.trim()).toBe('Save channel');
    expect(screen.getByRole('button', { name: 'Save channel' })).toBeInTheDocument();
  });

  it('labels a set of radios as a group, not each radio', async () => {
    await render(
      `<sf-field label="Mode">
         <label><input type="radio" name="m" value="FULL" /> Full</label>
         <label><input type="radio" name="m" value="INC" /> Incremental</label>
       </sf-field>`,
      { imports: [SfFieldComponent] },
    );

    expect(screen.getByRole('group', { name: 'Mode' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Full' })).toBeInTheDocument();
    expect(document.querySelector('label.sf-field__label')).toBeNull();
  });

  it('leaves the inputs of a nested field to that field', async () => {
    await render(
      `<sf-field label="Items" hint="One per row">
         <sf-field label="Title"><input /></sf-field>
       </sf-field>`,
      { imports: [SfFieldComponent] },
    );

    const input = screen.getByRole('textbox', { name: 'Title' });
    expect(input).not.toHaveAccessibleDescription('One per row');
    expect(screen.getByRole('group', { name: 'Items' })).toBeInTheDocument();
  });

  it('places the label beside the control when inline', async () => {
    await render(`<sf-field label="Name" labelPosition="inline"><input /></sf-field>`, { imports: [SfFieldComponent] });

    expect(document.querySelector('.sf-field--inline')).not.toBeNull();
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
  });

  it('works with reactive forms on the projected input', async () => {
    @Component({
      standalone: true,
      imports: [SfFieldComponent, ReactiveFormsModule],
      template: `<sf-field label="Title"><input [formControl]="title" /></sf-field>`,
    })
    class Host {
      readonly title = new FormControl('Home');
    }
    await render(Host);

    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Home');
  });
});
