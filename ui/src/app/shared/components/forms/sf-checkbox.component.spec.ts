import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfFieldComponent } from '../sf-field.component';
import { SfCheckboxComponent } from './sf-checkbox.component';

describe('SfCheckboxComponent', () => {
  it('is a native checkbox named by its own text, even inside a field', async () => {
    await render(
      `<sf-field label="Publishing" hint="Applies to new pages" error="Required"><sf-checkbox>Publish on save</sf-checkbox></sf-field>`,
      { imports: [SfFieldComponent, SfCheckboxComponent] },
    );

    const box = screen.getByRole('checkbox', { name: 'Publish on save' });
    expect(box).toHaveAttribute('type', 'checkbox');
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription('Applies to new pages Required');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    // The field label is a group heading, not a <label for>.
    expect(document.querySelector('label.sf-field__label')).toBeNull();
  });

  it('falls back to the field label without text of its own', async () => {
    await render(`<sf-field label="Archived"><sf-checkbox /></sf-field>`, {
      imports: [SfFieldComponent, SfCheckboxComponent],
    });

    expect(screen.getByRole('checkbox', { name: 'Archived' })).toBeInTheDocument();
  });

  it('takes aria-label outside a field and keeps the host free of aria attributes', async () => {
    await render(`<sf-checkbox aria-label="Select row" required />`, { imports: [SfCheckboxComponent] });

    const box = screen.getByRole('checkbox', { name: 'Select row' });
    expect(box).toHaveAttribute('aria-required', 'true');
    expect(document.querySelector('sf-checkbox')).not.toHaveAttribute('aria-label');
  });

  it('toggles on click and Space (via click) and shows the mixed state', async () => {
    const { fixture } = await render(`<sf-checkbox [indeterminate]="true">All pages</sf-checkbox>`, {
      imports: [SfCheckboxComponent],
    });

    const box = screen.getByRole('checkbox', { name: 'All pages' }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    fireEvent.click(box);
    fixture.detectChanges();
    expect(box).toBeChecked();
    expect(box.indeterminate).toBe(false);
    fireEvent.click(box);
    expect(box).not.toBeChecked();
  });

  it('does not toggle when read-only', async () => {
    await render(`<sf-checkbox readonly [value]="true">Locked</sf-checkbox>`, { imports: [SfCheckboxComponent] });

    const box = screen.getByRole('checkbox', { name: 'Locked' });
    expect(box).toHaveAttribute('aria-readonly', 'true');
    expect(box).not.toBeDisabled();
    fireEvent.click(box);
    expect(box).toBeChecked();
  });

  it('is disabled', async () => {
    await render(`<sf-checkbox disabled>Off</sf-checkbox>`, { imports: [SfCheckboxComponent] });

    expect(screen.getByRole('checkbox', { name: 'Off' })).toBeDisabled();
  });

  it('works with a reactive FormControl', async () => {
    @Component({
      standalone: true,
      imports: [SfCheckboxComponent, ReactiveFormsModule],
      template: `<sf-checkbox [formControl]="control">Visible</sf-checkbox>`,
    })
    class Host {
      readonly control = new FormControl(true, { nonNullable: true });
    }
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.control;
    const box = screen.getByRole('checkbox', { name: 'Visible' });
    expect(box).toBeChecked();

    fireEvent.click(box);
    expect(control.value).toBe(false);
    fireEvent.blur(box);
    expect(control.touched).toBe(true);

    control.setValue(true);
    fixture.detectChanges();
    expect(box).toBeChecked();

    control.disable();
    fixture.detectChanges();
    expect(box).toBeDisabled();
  });
});
