import { render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfBadgeComponent } from './sf-badge.component';

describe('SfBadgeComponent', () => {
  it('renders its label with the tone class and a decorative icon', async () => {
    await render(`<sf-badge tone="success" icon="check" label="Live" />`, { imports: [SfBadgeComponent] });

    const badge = screen.getByText('Live').closest('sf-badge')!;
    expect(badge).toHaveClass('sf-badge', 'sf-badge--success');
    expect(badge.querySelector('.material-symbols-outlined')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders projected text and defaults to neutral', async () => {
    await render(`<sf-badge class="extra">12</sf-badge>`, { imports: [SfBadgeComponent] });

    const badge = document.querySelector('sf-badge')!;
    expect(badge).toHaveTextContent('12');
    expect(badge).toHaveClass('sf-badge--neutral', 'extra');
    expect(badge.querySelector('sf-icon')).toBeNull();
  });
});
