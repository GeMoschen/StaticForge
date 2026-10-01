import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfFieldComponent } from '../sf-field.component';
import { SfSelectComponent, SfSelectOption } from './sf-select.component';

const MODES: SfSelectOption<string>[] = [
  { value: 'FULL', label: 'Full' },
  { value: 'INC', label: 'Incremental' },
  { value: 'OFF', label: 'Off', disabled: true },
];

/** The text of the option the select displays. */
const shown = (select: HTMLElement) => (select as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? '';

describe('SfSelectComponent', () => {
  it('is a combobox labelled by its field, described by hint and error', async () => {
    await render(
      `<sf-field label="Mode" hint="How to build" error="Pick one" required><sf-select [options]="modes" /></sf-field>`,
      { imports: [SfFieldComponent, SfSelectComponent], componentProperties: { modes: MODES } },
    );

    const select = screen.getByRole('combobox', { name: 'Mode' });
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveAccessibleDescription('How to build Pick one');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAttribute('aria-required', 'true');
    expect(screen.getByRole('option', { name: 'Off' })).toBeDisabled();
  });

  it('takes aria-label outside a field', async () => {
    await render(`<sf-select aria-label="Mode" [options]="modes" />`, {
      imports: [SfSelectComponent],
      componentProperties: { modes: MODES },
    });

    expect(screen.getByRole('combobox', { name: 'Mode' })).not.toHaveAttribute('aria-invalid');
  });

  it('never shows an option the model did not choose', async () => {
    @Component({
      standalone: true,
      imports: [SfSelectComponent, ReactiveFormsModule],
      template: `<sf-select aria-label="Mode" [options]="modes" [formControl]="mode" />`,
    })
    class Host {
      readonly modes = MODES;
      readonly mode = new FormControl<string | null>('MISSING');
    }
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.mode;
    const select = screen.getByRole('combobox', { name: 'Mode' }) as HTMLSelectElement;

    // Unmatched: a hidden blank option is shown, not "Full".
    expect(select.value).toBe('');
    expect(shown(select)).toBe('');
    expect(select.options[0]).toHaveAttribute('hidden');

    control.setValue('INC');
    fixture.detectChanges();
    expect(shown(select)).toBe('Incremental');
    // Matched and no placeholder: the blank option is gone.
    expect(select.options).toHaveLength(3);

    control.setValue(null);
    fixture.detectChanges();
    expect(shown(select)).toBe('');
    expect(select.value).toBe('');
  });

  it('shows the placeholder while nothing is chosen and lets an optional select go back to null', async () => {
    @Component({
      standalone: true,
      imports: [SfSelectComponent, ReactiveFormsModule],
      template: `<sf-select aria-label="Mode" placeholder="Choose…" [options]="modes" [formControl]="mode" />`,
    })
    class Host {
      readonly modes = MODES;
      readonly mode = new FormControl<string | null>(null);
    }
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.mode;
    const select = screen.getByRole('combobox', { name: 'Mode' }) as HTMLSelectElement;
    expect(shown(select)).toBe('Choose…');

    fireEvent.change(select, { target: { value: '0' } });
    expect(control.value).toBe('FULL');
    fixture.detectChanges();
    expect(shown(select)).toBe('Full');

    fireEvent.change(select, { target: { value: '' } });
    expect(control.value).toBeNull();
  });

  it('keeps the placeholder unselectable when required', async () => {
    await render(`<sf-select aria-label="Mode" placeholder="Choose…" required [options]="modes" />`, {
      imports: [SfSelectComponent],
      componentProperties: { modes: MODES },
    });

    expect(screen.getByRole('option', { name: 'Choose…' })).toBeDisabled();
  });

  it('maps object values by index and matches them with compareWith', async () => {
    interface Locale {
      code: string;
    }
    @Component({
      standalone: true,
      imports: [SfSelectComponent, ReactiveFormsModule],
      template: `<sf-select aria-label="Locale" [options]="options" [compareWith]="sameCode" [formControl]="locale" />`,
    })
    class Host {
      readonly options: SfSelectOption<Locale>[] = [
        { value: { code: 'en' }, label: 'English' },
        { value: { code: 'de' }, label: 'German' },
      ];
      readonly sameCode = (a: Locale | null, b: Locale | null) => a?.code === b?.code;
      readonly locale = new FormControl<Locale | null>({ code: 'de' });
    }
    const { fixture } = await render(Host);
    const host = fixture.componentInstance;
    const select = screen.getByRole('combobox', { name: 'Locale' });
    expect(shown(select)).toBe('German');

    fireEvent.change(select, { target: { value: '0' } });
    expect(host.locale.value).toBe(host.options[0].value);
  });

  it('is a ControlValueAccessor: touched on blur, disabled with the control', async () => {
    @Component({
      standalone: true,
      imports: [SfSelectComponent, ReactiveFormsModule],
      template: `<sf-select aria-label="Mode" [options]="modes" [formControl]="mode" />`,
    })
    class Host {
      readonly modes = MODES;
      readonly mode = new FormControl<string | null>('FULL');
    }
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.mode;
    const select = screen.getByRole('combobox', { name: 'Mode' });
    expect(shown(select)).toBe('Full');

    fireEvent.blur(select);
    expect(control.touched).toBe(true);

    control.disable();
    fixture.detectChanges();
    expect(select).toBeDisabled();
  });

  it('read-only: shows the value but ignores changes and change keys', async () => {
    @Component({
      standalone: true,
      imports: [SfSelectComponent, ReactiveFormsModule],
      template: `<sf-select aria-label="Mode" readonly [options]="modes" [formControl]="mode" />`,
    })
    class Host {
      readonly modes = MODES;
      readonly mode = new FormControl<string | null>('FULL');
    }
    const { fixture } = await render(Host);
    const select = screen.getByRole('combobox', { name: 'Mode' }) as HTMLSelectElement;
    expect(select).toHaveAttribute('aria-readonly', 'true');
    expect(select).not.toBeDisabled();

    expect(fireEvent.keyDown(select, { key: 'ArrowDown' })).toBe(false);
    expect(fireEvent.keyDown(select, { key: 'Tab' })).toBe(true);

    fireEvent.change(select, { target: { value: '1' } });
    expect(fixture.componentInstance.mode.value).toBe('FULL');
    expect(shown(select)).toBe('Full');
  });
});
