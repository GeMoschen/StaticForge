import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfFieldComponent } from '../sf-field.component';
import { SfSwitchComponent } from './sf-switch.component';

describe('SfSwitchComponent', () => {
  it('is a role=switch button named by its own text, described by the field', async () => {
    await render(
      `<sf-field label="Preview" hint="Shows drafts" required><sf-switch>Live preview</sf-switch></sf-field>`,
      { imports: [SfFieldComponent, SfSwitchComponent] },
    );

    const toggle = screen.getByRole('switch', { name: 'Live preview' });
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAttribute('aria-required', 'true');
    expect(toggle).toHaveAccessibleDescription('Shows drafts');
  });

  it('falls back to the field label without text, and takes aria-label outside a field', async () => {
    await render(
      `<sf-field label="Dark mode" error="Not allowed"><sf-switch /></sf-field><sf-switch aria-label="Compact" />`,
      { imports: [SfFieldComponent, SfSwitchComponent] },
    );

    expect(screen.getByRole('switch', { name: 'Dark mode' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('switch', { name: 'Compact' })).toBeInTheDocument();
  });

  it('toggles on click (Space and Enter activate the native button)', async () => {
    const { fixture } = await render(`<sf-switch>On</sf-switch>`, { imports: [SfSwitchComponent] });

    const toggle = screen.getByRole('switch', { name: 'On' });
    fireEvent.click(toggle);
    fixture.detectChanges();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    fixture.detectChanges();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('does not toggle when read-only', async () => {
    const { fixture } = await render(`<sf-switch readonly [value]="true">On</sf-switch>`, {
      imports: [SfSwitchComponent],
    });

    const toggle = screen.getByRole('switch', { name: 'On' });
    expect(toggle).toHaveAttribute('aria-readonly', 'true');
    expect(toggle).not.toBeDisabled();
    fireEvent.click(toggle);
    fixture.detectChanges();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('works with a reactive FormControl', async () => {
    @Component({
      standalone: true,
      imports: [SfSwitchComponent, ReactiveFormsModule],
      template: `<sf-switch [formControl]="control">Enabled</sf-switch>`,
    })
    class Host {
      readonly control = new FormControl(false, { nonNullable: true });
    }
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.control;
    const toggle = screen.getByRole('switch', { name: 'Enabled' });

    fireEvent.click(toggle);
    expect(control.value).toBe(true);
    fireEvent.blur(toggle);
    expect(control.touched).toBe(true);

    control.setValue(false);
    fixture.detectChanges();
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    control.disable();
    fixture.detectChanges();
    expect(toggle).toBeDisabled();
  });
});
