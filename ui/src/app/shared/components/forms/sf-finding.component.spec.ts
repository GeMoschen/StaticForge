import { render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfFindingComponent } from './sf-finding.component';

describe('SfFindingComponent', () => {
  it.each(['hint', 'info', 'warning'] as const)('says a %s politely and names its level for screen readers', async (level) => {
    await render(SfFindingComponent, { inputs: { level, message: 'Looks unusual' } });
    const finding = screen.getByRole('status');
    expect(finding).toHaveTextContent(`${level}: Looks unusual`);
    expect(finding.className).toContain(`sf-finding--${level}`);
  });

  it('announces an error assertively', async () => {
    await render(SfFindingComponent, { inputs: { level: 'error', message: 'Required' } });
    expect(screen.getByRole('alert')).toHaveTextContent('error: Required');
  });

  it('uses a translated level word when given', async () => {
    await render(SfFindingComponent, { inputs: { level: 'warning', message: 'Check', levelLabel: 'Warnung' } });
    expect(screen.getByRole('status')).toHaveTextContent('Warnung: Check');
  });
});
