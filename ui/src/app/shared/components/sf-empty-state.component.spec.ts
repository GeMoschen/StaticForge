import { render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfEmptyStateComponent } from './sf-empty-state.component';

describe('SfEmptyStateComponent', () => {
  it('renders its default empty-state title', async () => {
    await render(SfEmptyStateComponent);

    const heading = screen.getByRole('heading');
    expect(heading.textContent).toBe('Nothing here yet');
  });
});
