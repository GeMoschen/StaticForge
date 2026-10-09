import { fireEvent, render, screen, within } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { SfFilterGroup, SfFilterPopoverComponent } from './sf-filter-popover.component';

const GROUPS: SfFilterGroup[] = [
  { id: 'type', label: 'Type', options: [{ value: 'PAGE', label: 'Page', icon: 'description' }, { value: 'MEDIA', label: 'Media' }] },
  { id: 'status', label: 'Status', options: [{ value: 'CHANGED', label: 'Changed' }] },
];

async function setup(picked: Record<string, string[]> = {}) {
  const toggled = vi.fn();
  const cleared = vi.fn();
  await render(SfFilterPopoverComponent, {
    providers: [provideTranslocoTesting()],
    inputs: { groups: GROUPS, picked },
    on: { toggled, cleared },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  return { toggled, cleared };
}

describe('SfFilterPopoverComponent', () => {
  it('shows a group per filter with a toggle tag per option', async () => {
    await setup({ type: ['MEDIA'] });

    const type = await screen.findByRole('group', { name: 'Type' });
    expect(within(type).getByRole('button', { name: 'Page' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(type).getByRole('button', { name: 'Media' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name: 'Changed' })).toBeInTheDocument();
  });

  it('reports a toggle and clears', async () => {
    const { toggled, cleared } = await setup({ status: ['CHANGED'] });

    fireEvent.click(within(await screen.findByRole('group', { name: 'Type' })).getByRole('button', { name: 'Page' }));
    expect(toggled).toHaveBeenCalledWith({ group: 'type', value: 'PAGE' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(cleared).toHaveBeenCalled();
  });

  it('offers no clear while nothing is picked', async () => {
    await setup();
    await screen.findByRole('group', { name: 'Type' });
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });
});
