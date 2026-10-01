import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { SfFieldComponent } from '../sf-field.component';
import { SfSegmentedComponent, SfSegmentedOption } from './sf-segmented.component';

const views: SfSegmentedOption<string>[] = [
  { value: 'list', label: 'List', icon: 'list', iconOnly: true },
  { value: 'grid', label: 'Grid', icon: 'grid_view', iconOnly: true },
  { value: 'tree', label: 'Tree', disabled: true },
  { value: 'table', label: 'Table' },
];

async function setup(value: string | null = null) {
  const result = await render(`<sf-segmented aria-label="View" [options]="views" [(value)]="value" />`, {
    imports: [SfSegmentedComponent],
    componentProperties: { views, value },
  });
  const radios = () => screen.getAllByRole('radio');
  const tabbable = () => radios().filter((radio) => radio.getAttribute('tabindex') === '0');
  return { ...result, radios, tabbable };
}

describe('SfSegmentedComponent', () => {
  it('is a radiogroup of role=radio buttons; icon-only segments are named by their label', async () => {
    const { radios } = await setup('grid');

    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument();
    expect(radios().map((radio) => radio.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON', 'BUTTON']);
    expect(screen.getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Table' }).textContent?.trim()).toBe('Table');
    expect(screen.getByRole('radio', { name: 'Tree' })).toBeDisabled();
  });

  it('shows the label of an icon-only segment as tooltip on keyboard focus', async () => {
    await setup();
    const list = screen.getByRole('radio', { name: 'List' });

    vi.spyOn(list, 'matches').mockImplementation((selector: string) => selector === ':focus-visible');
    fireEvent.focusIn(list);
    expect(screen.getByRole('tooltip')).toHaveTextContent('List');
    fireEvent.focusOut(list);
  });

  it('keeps only the checked segment tabbable (the first one when none is checked)', async () => {
    const { tabbable, fixture } = await setup();
    expect(tabbable().map((radio) => radio.getAttribute('aria-label') ?? radio.textContent?.trim())).toEqual(['List']);

    (fixture.componentInstance as unknown as { value: string }).value = 'table';
    fixture.detectChanges();
    expect(tabbable()).toEqual([screen.getByRole('radio', { name: 'Table' })]);
  });

  it('moves and selects with the arrow keys, skipping disabled segments and wrapping; Home and End', async () => {
    const { fixture, tabbable } = await setup('list');
    const host = fixture.componentInstance as unknown as { value: string };
    const list = screen.getByRole('radio', { name: 'List' });
    list.focus();

    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(host.value).toBe('grid');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Grid' }));
    expect(tabbable()).toEqual([document.activeElement]);

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(host.value).toBe('table'); // Tree is disabled
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(host.value).toBe('list'); // wraps
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(host.value).toBe('table');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(host.value).toBe('grid');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(host.value).toBe('list');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(host.value).toBe('table');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Table' }));
  });

  it('selects on click', async () => {
    const { fixture } = await setup('list');

    fireEvent.click(screen.getByRole('radio', { name: 'Table' }));
    expect((fixture.componentInstance as unknown as { value: string }).value).toBe('table');
  });

  it('moves without selecting when read-only', async () => {
    await render(`<sf-segmented aria-label="View" readonly [options]="views" value="list" />`, {
      imports: [SfSegmentedComponent],
      componentProperties: { views },
    });
    const list = screen.getByRole('radio', { name: 'List' });
    list.focus();

    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-readonly', 'true');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Grid' }));
    expect(list).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Table' }));
    expect(list).toHaveAttribute('aria-checked', 'true');
  });

  it('is labelled by a field and carries its description, invalid and required state; size sm', async () => {
    await render(
      `<sf-field label="Density" hint="Row height" error="Pick one" required>
         <sf-segmented size="sm" [options]="views" />
       </sf-field>`,
      { imports: [SfFieldComponent, SfSegmentedComponent], componentProperties: { views } },
    );

    const group = screen.getByRole('radiogroup', { name: 'Density' });
    expect(group).toHaveAccessibleDescription('Row height Pick one');
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group).toHaveAttribute('aria-required', 'true');
    expect(group).toHaveClass('sf-segmented--sm');
  });

  it('works with a reactive FormControl', async () => {
    @Component({
      standalone: true,
      imports: [SfSegmentedComponent, ReactiveFormsModule],
      template: `<sf-segmented aria-label="View" [options]="views" [formControl]="control" />`,
    })
    class Host {
      readonly views = views;
      readonly control = new FormControl<string | null>('grid');
    }
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.control;
    expect(screen.getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('radio', { name: 'Table' }));
    expect(control.value).toBe('table');

    control.setValue('list');
    fixture.detectChanges();
    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');

    control.disable();
    fixture.detectChanges();
    screen.getAllByRole('radio').forEach((radio) => expect(radio).toBeDisabled());
  });
});
