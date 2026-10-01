import { render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfSpinnerComponent } from './sf-spinner.component';

describe('SfSpinnerComponent', () => {
  it('is a status reading "Loading…" with a decorative ring', async () => {
    await render(SfSpinnerComponent);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading…');
    expect(status.querySelector('.sf-spinner__ring')).toHaveAttribute('aria-hidden', 'true');
    expect(status).not.toHaveClass('sf-spinner--sm');
    expect(status).not.toHaveClass('sf-spinner--inline');
  });

  it('takes a label, the small size and inline mode', async () => {
    await render(`<sf-spinner label="Saving…" size="sm" inline />`, { imports: [SfSpinnerComponent] });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Saving…');
    expect(status).toHaveClass('sf-spinner--sm', 'sf-spinner--inline');
  });
});
