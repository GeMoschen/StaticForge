import { fireEvent, render, screen } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SF_BROWSER_LOCALE } from '../../../core/i18n/i18n-format.service';
import { RELATIVE_TIME_REFRESH_MS, SfRelativeTimeComponent } from './sf-relative-time.component';

const NOW = new Date('2026-08-20T12:00:00Z');

describe('SfRelativeTimeComponent', () => {
  afterEach(() => vi.useRealTimers());

  async function renderTime(value: unknown) {
    return render(`<sf-relative-time [value]="value" />`, {
      imports: [SfRelativeTimeComponent],
      componentProperties: { value },
      providers: [{ provide: SF_BROWSER_LOCALE, useValue: 'en-US' }],
    });
  }

  it('renders a <time> with the ISO datetime and the relative wording', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setInterval', 'clearInterval'] });
    await renderTime('2026-08-20T11:55:00Z');

    const time = screen.getByText('5 min ago');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-08-20T11:55:00.000Z');
  });

  it('is focusable and shows the absolute time as tooltip, describing the element', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setInterval', 'clearInterval'] });
    await renderTime('2026-08-20T11:55:00Z');
    const time = screen.getByText('5 min ago');
    expect(time).toHaveAttribute('tabindex', '0');

    vi.spyOn(time, 'matches').mockReturnValue(true);
    fireEvent.focusIn(time);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent(/Aug 20, 2026/);
    expect(time).toHaveAccessibleDescription(tooltip.textContent!);
  });

  it('refreshes the wording as time passes', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setInterval', 'clearInterval'] });
    const { fixture } = await renderTime('2026-08-20T11:59:40Z');
    expect(screen.getByText('just now')).toBeInTheDocument();

    vi.advanceTimersByTime(2 * RELATIVE_TIME_REFRESH_MS);
    fixture.detectChanges();

    expect(screen.getByText('1 min ago')).toBeInTheDocument();
  });

  it('stops refreshing when destroyed', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setInterval', 'clearInterval'] });
    const { fixture } = await renderTime(NOW);
    expect(vi.getTimerCount()).toBe(1);

    fixture.destroy();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders an em dash for invalid input, without datetime, tooltip or tab stop', async () => {
    await renderTime('not-a-date');

    const time = screen.getByText('—');
    expect(time).not.toHaveAttribute('datetime');
    expect(time).not.toHaveAttribute('tabindex');
  });
});
