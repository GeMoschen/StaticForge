import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { SfButtonComponent } from '../sf-button.component';
import { SfBannerComponent, SfBannerTone } from './sf-banner.component';

describe('SfBannerComponent', () => {
  it.each<[SfBannerTone, string, string]>([
    ['info', 'info', 'Information'],
    ['success', 'check_circle', 'Success'],
    ['warning', 'warning', 'Warning'],
    ['danger', 'error', 'Error'],
  ])('a %s banner shows its icon and says its tone to screen readers', async (tone, icon, prefix) => {
    await render(`<sf-banner [tone]="tone">Something happened.</sf-banner>`, {
      imports: [SfBannerComponent],
      componentProperties: { tone },
    });

    const banner = document.querySelector('.sf-banner')!;
    expect(banner).toHaveClass(`sf-banner--${tone}`);
    expect(banner.querySelector('.material-symbols-outlined')?.textContent?.trim()).toBe(icon);
    expect(banner.querySelector('.sf-sr-only')).toHaveTextContent(prefix);
    expect(banner).toHaveTextContent('Something happened.');
  });

  it('is no live region by default', async () => {
    await render(`<sf-banner>Read only mode.</sf-banner>`, { imports: [SfBannerComponent] });

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('is a status when polite and an alert when assertive', async () => {
    await render(
      `<sf-banner live="polite" tone="success">Saved.</sf-banner><sf-banner live="assertive" tone="danger">Failed.</sf-banner>`,
      { imports: [SfBannerComponent] },
    );

    expect(screen.getByRole('status')).toHaveTextContent('Success: Saved.');
    expect(screen.getByRole('alert')).toHaveTextContent('Error: Failed.');
  });

  it('renders the title and projected actions', async () => {
    await render(
      `<sf-banner tone="warning" title="Unpublished changes">Publish to update the site.<sf-button sfBannerActions>Publish</sf-button></sf-banner>`,
      { imports: [SfBannerComponent, SfButtonComponent] },
    );

    expect(screen.getByText('Unpublished changes').tagName).toBe('STRONG');
    expect(document.querySelector('.sf-banner__actions')).toContainElement(
      screen.getByRole('button', { name: 'Publish' }),
    );
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('can be dismissed with its button, which hides it and emits', async () => {
    const dismissed = vi.fn();
    await render(`<sf-banner dismissible (dismissed)="dismissed()">Tip.</sf-banner>`, {
      imports: [SfBannerComponent],
      componentProperties: { dismissed },
    });
    const button = screen.getByRole('button', { name: 'Dismiss' });
    button.focus();
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);

    expect(dismissed).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Tip.')).toBeNull();
    expect(document.querySelector('sf-banner')).toHaveClass('sf-banner-host--dismissed');
  });
});
