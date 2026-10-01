import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { SfStatusComponent, SfStatusTone } from './sf-status.component';

describe('SfStatusComponent', () => {
  const tones: [SfStatusTone, string][] = [
    ['neutral', 'radio_button_unchecked'],
    ['info', 'info'],
    ['success', 'check_circle'],
    ['warning', 'warning'],
    ['danger', 'error'],
    ['accent', 'fiber_manual_record'],
  ];

  it.each(tones)('shows a %s status with its own icon next to the text', async (tone, icon) => {
    await render(`<sf-status [tone]="tone" label="State" />`, {
      imports: [SfStatusComponent],
      componentProperties: { tone },
    });

    const status = screen.getByText('State').closest('sf-status')!;
    expect(status).toHaveClass(`sf-status--${tone}`, 'sf-status--md');
    const glyph = status.querySelector('.material-symbols-outlined')!;
    expect(glyph.textContent?.trim()).toBe(icon);
    // The icon is decoration: the text is what is read.
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
  });

  it('takes an icon override and the small size', async () => {
    await render(`<sf-status tone="info" icon="sync" size="sm" label="Running" />`, { imports: [SfStatusComponent] });

    const status = screen.getByText('Running').closest('sf-status')!;
    expect(status).toHaveClass('sf-status--sm');
    expect(status.querySelector('.material-symbols-outlined')?.textContent?.trim()).toBe('sync');
  });

  it('keeps a short label with the state as screen-reader text and tooltip (detail)', async () => {
    vi.useFakeTimers();
    await render(`<sf-status tone="success" label="DE" detail="Released" />`, { imports: [SfStatusComponent] });
    const status = document.querySelector('sf-status')!;

    expect(status.textContent?.replace(/\s+/g, ' ').trim()).toContain('DE: Released');
    fireEvent.mouseEnter(status.querySelector('.sf-status__body')!);
    vi.advanceTimersByTime(600);
    expect(screen.getByRole('tooltip')).toHaveTextContent('DE: Released');
    vi.useRealTimers();
  });

  it('shows only the icon, keeping the label for screen readers (iconOnly)', async () => {
    await render(`<sf-status tone="warning" label="Changed" iconOnly />`, { imports: [SfStatusComponent] });

    const label = screen.getByText('Changed');
    expect(label).toHaveClass('sf-sr-only');
    expect(document.querySelector('sf-status')).toHaveClass('sf-status--icon-only');
  });
});
