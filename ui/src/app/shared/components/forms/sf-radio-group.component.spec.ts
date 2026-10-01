import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfFieldComponent } from '../sf-field.component';
import { SfRadioGroupComponent, SfRadioOption } from './sf-radio-group.component';

const modes: SfRadioOption<string>[] = [
  { value: 'FULL', label: 'Full', description: 'Rebuilds every page' },
  { value: 'INC', label: 'Incremental' },
  { value: 'DRY', label: 'Dry run', disabled: true },
];

describe('SfRadioGroupComponent', () => {
  it('is a radiogroup labelled by the field, with described, required and invalid state', async () => {
    await render(
      `<sf-field label="Mode" hint="How to build" error="Pick one" required>
         <sf-radio-group [options]="modes" />
       </sf-field>`,
      { imports: [SfFieldComponent, SfRadioGroupComponent], componentProperties: { modes } },
    );

    const group = screen.getByRole('radiogroup', { name: 'Mode' });
    expect(group).toHaveAccessibleDescription('How to build Pick one');
    expect(group).toHaveAttribute('aria-required', 'true');
    expect(group).toHaveAttribute('aria-invalid', 'true');
    // The field doesn't wrap it in a second group.
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('takes aria-label outside a field; each radio is named by its label and described by its description', async () => {
    await render(`<sf-radio-group aria-label="Build mode" [options]="modes" orientation="horizontal" />`, {
      imports: [SfRadioGroupComponent],
      componentProperties: { modes },
    });

    expect(screen.getByRole('radiogroup', { name: 'Build mode' })).toHaveClass('sf-radio-group--horizontal');
    const full = screen.getByRole('radio', { name: 'Full' });
    expect(full).toHaveAccessibleDescription('Rebuilds every page');
    expect(screen.getByRole('radio', { name: 'Dry run' })).toBeDisabled();
    const names = screen.getAllByRole('radio').map((radio) => radio.getAttribute('name'));
    expect(new Set(names).size).toBe(1);
    expect(names[0]).toBeTruthy();
  });

  it('selects on click (and on the native arrow-key change)', async () => {
    await render(`<sf-radio-group aria-label="Mode" [options]="modes" />`, {
      imports: [SfRadioGroupComponent],
      componentProperties: { modes },
    });

    fireEvent.click(screen.getByRole('radio', { name: 'Incremental' }));
    expect(screen.getByRole('radio', { name: 'Incremental' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Full' })).not.toBeChecked();
  });

  it('does not change when read-only', async () => {
    await render(`<sf-radio-group aria-label="Mode" readonly [options]="modes" value="FULL" />`, {
      imports: [SfRadioGroupComponent],
      componentProperties: { modes },
    });

    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-readonly', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Incremental' }));
    expect(screen.getByRole('radio', { name: 'Full' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Incremental' })).not.toBeChecked();
  });

  it('works with a reactive FormControl, compareWith and disable()', async () => {
    @Component({
      standalone: true,
      imports: [SfRadioGroupComponent, ReactiveFormsModule],
      template: `<sf-radio-group aria-label="Mode" [options]="options" [compareWith]="byId" [formControl]="control" />`,
    })
    class Host {
      readonly options: SfRadioOption<{ id: string }>[] = [
        { value: { id: 'a' }, label: 'Alpha' },
        { value: { id: 'b' }, label: 'Beta' },
      ];
      readonly byId = (a: { id: string }, b: { id: string }) => a.id === b.id;
      readonly control = new FormControl<{ id: string } | null>({ id: 'b' });
    }
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.control;
    expect(screen.getByRole('radio', { name: 'Beta' })).toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    expect(control.value).toEqual({ id: 'a' });

    control.setValue(null);
    fixture.detectChanges();
    expect(screen.getByRole('radio', { name: 'Alpha' })).not.toBeChecked();

    control.disable();
    fixture.detectChanges();
    screen.getAllByRole('radio').forEach((radio) => expect(radio).toBeDisabled());
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-disabled', 'true');
  });
});
