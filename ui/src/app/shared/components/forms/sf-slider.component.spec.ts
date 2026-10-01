import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfFieldComponent } from '../sf-field.component';
import { SfSliderComponent } from './sf-slider.component';

@Component({
  standalone: true,
  imports: [SfSliderComponent, SfFieldComponent, ReactiveFormsModule],
  template: `
    <sf-field label="Image quality" hint="Higher means larger files" [error]="error">
      <sf-slider [min]="10" [max]="100" [step]="5" unit="%" [readonly]="readonly" [formControl]="control" />
    </sf-field>
  `,
})
class Host {
  error: string | null = null;
  readonly = false;
  readonly control = new FormControl<number | null>(80);
}

describe('SfSliderComponent', () => {
  it('is a slider labelled and described by its field, announcing the value with its unit', async () => {
    await render(Host);

    const slider = screen.getByRole('slider', { name: 'Image quality' });
    expect(slider).toHaveAccessibleDescription('Higher means larger files');
    expect(slider).toHaveAttribute('min', '10');
    expect(slider).toHaveAttribute('max', '100');
    expect(slider).toHaveAttribute('step', '5');
    expect(slider).toHaveValue('80');
    expect(slider).toHaveAttribute('aria-valuetext', '80 %');
    expect(screen.getByText('80 %')).toHaveAttribute('aria-hidden', 'true');
  });

  it('writes user changes to the form and shows them', async () => {
    const { fixture } = await render(Host);
    const slider = screen.getByRole('slider');

    fireEvent.input(slider, { target: { value: '45' } });
    fixture.detectChanges();
    expect(fixture.componentInstance.control.value).toBe(45);
    expect(slider).toHaveAttribute('aria-valuetext', '45 %');
    fireEvent.blur(slider);
    expect(fixture.componentInstance.control.touched).toBe(true);
  });

  it('follows form writes and clamps out-of-range values for display', async () => {
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.control;

    control.setValue(30);
    fixture.detectChanges();
    expect(screen.getByRole('slider')).toHaveValue('30');
    control.setValue(500);
    fixture.detectChanges();
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '100 %');
    control.setValue(null);
    fixture.detectChanges();
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '10 %');
  });

  it('is disabled by its form, and read-only keeps its value', async () => {
    const { fixture } = await render(Host, { componentProperties: { readonly: true } });
    const slider = screen.getByRole('slider');

    expect(slider).toHaveAttribute('aria-readonly', 'true');
    fireEvent.input(slider, { target: { value: '20' } });
    expect(fixture.componentInstance.control.value).toBe(80);
    expect(slider).toHaveValue('80');

    fixture.componentInstance.control.disable();
    fixture.detectChanges();
    expect(slider).toBeDisabled();
  });

  it('takes an error from its field and an aria-label outside one', async () => {
    await render(Host, { componentProperties: { error: 'Too low' } });
    expect(screen.getByRole('slider')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('slider')).toHaveAccessibleDescription('Higher means larger files Too low');
  });

  it('can hide the value display', async () => {
    await render(`<sf-slider aria-label="Volume" [showValue]="false" />`, { imports: [SfSliderComponent] });

    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveAttribute('aria-valuetext', '0');
    expect(document.querySelector('output')).toBeNull();
  });
});
