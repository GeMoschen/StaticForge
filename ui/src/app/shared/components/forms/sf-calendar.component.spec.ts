import { fireEvent, render, screen } from '@testing-library/angular';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SF_BROWSER_LOCALE } from '../../../core/i18n/i18n-format.service';
import { SfCalendarComponent } from './sf-calendar.component';

async function setup(inputs: Record<string, unknown> = {}) {
  const picked = vi.fn();
  const result = await render(SfCalendarComponent, {
    inputs,
    on: { picked },
    providers: [{ provide: SF_BROWSER_LOCALE, useValue: 'en-GB' }],
  });
  const grid = screen.getByRole('grid');
  const focusedCell = () => grid.querySelector<HTMLElement>('td[tabindex="0"]')!;
  const key = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(focusedCell(), { key, ...init });
  return { ...result, picked, grid, focusedCell, key };
}

describe('SfCalendarComponent', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 1, 9, 0)); // Thursday 1 October 2026
  });
  afterEach(() => vi.useRealTimers());

  it('is a grid labelled by the month, with weekday headers from the locale week start', async () => {
    const { grid } = await setup();

    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
    expect(grid).toHaveAccessibleName('October 2026');
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(7);
    expect(headers[0]).toHaveAttribute('abbr', 'Monday');
  });

  it('starts on today, marked as the current date, with one tab stop', async () => {
    const { focusedCell, grid } = await setup();

    expect(focusedCell()).toHaveAttribute('data-day', '2026-10-01');
    expect(focusedCell()).toHaveAttribute('aria-current', 'date');
    expect(focusedCell()).toHaveAccessibleName('Thursday, 1 October 2026');
    expect(grid.querySelectorAll('td[tabindex="0"]')).toHaveLength(1);
  });

  it('starts on the selected day and marks it selected', async () => {
    const { focusedCell } = await setup({ value: '2026-12-24' });

    expect(screen.getByRole('heading', { name: 'December 2026' })).toBeInTheDocument();
    expect(focusedCell()).toHaveAttribute('data-day', '2026-12-24');
    expect(focusedCell()).toHaveAttribute('aria-selected', 'true');
  });

  it('moves by day, week, week edge, month and year with the keyboard', async () => {
    const { focusedCell, key } = await setup({ value: '2026-10-15' }); // a Thursday
    const day = () => focusedCell().getAttribute('data-day');

    key('ArrowRight');
    expect(day()).toBe('2026-10-16');
    key('ArrowLeft');
    key('ArrowLeft');
    expect(day()).toBe('2026-10-14');
    key('ArrowDown');
    expect(day()).toBe('2026-10-21');
    key('ArrowUp');
    expect(day()).toBe('2026-10-14');
    key('Home');
    expect(day()).toBe('2026-10-12'); // Monday
    key('End');
    expect(day()).toBe('2026-10-18'); // Sunday
    key('PageDown');
    expect(day()).toBe('2026-11-18');
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    key('PageUp', { shiftKey: true });
    expect(day()).toBe('2025-11-18');
    expect(document.activeElement).toBe(focusedCell());
  });

  it('picks with Enter, Space and a click', async () => {
    const { key, picked } = await setup({ value: '2026-10-15' });

    key('Enter');
    expect(picked).toHaveBeenLastCalledWith('2026-10-15');
    key('ArrowRight');
    key(' ');
    expect(picked).toHaveBeenLastCalledWith('2026-10-16');
    fireEvent.click(screen.getByRole('gridcell', { name: 'Friday, 30 October 2026' }));
    expect(picked).toHaveBeenLastCalledWith('2026-10-30');
  });

  it('keeps focus and picks within min and max', async () => {
    const { focusedCell, key, picked } = await setup({ value: '2026-10-15', min: '2026-10-10', max: '2026-10-20' });

    key('PageDown');
    expect(focusedCell()).toHaveAttribute('data-day', '2026-10-20');
    key('ArrowDown');
    expect(focusedCell()).toHaveAttribute('data-day', '2026-10-20');
    const outside = screen.getByRole('gridcell', { name: 'Thursday, 22 October 2026' });
    expect(outside).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(outside);
    expect(picked).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
  });

  it('pages months with the header buttons', async () => {
    await setup();

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }));
    expect(screen.getByRole('heading', { name: 'November 2025' })).toBeInTheDocument();
  });
});
