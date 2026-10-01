import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { SfEmptyStateComponent } from './sf-empty-state.component';

describe('SfEmptyStateComponent', () => {
  it('renders its default empty-state title as an h2', async () => {
    await render(SfEmptyStateComponent);

    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('Nothing here yet');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders title, description, a decorative illustration and projected content', async () => {
    await render(
      `<sf-empty-state title="No pages" description="Create the first page." icon="description"><p>Extra</p></sf-empty-state>`,
      { imports: [SfEmptyStateComponent] },
    );

    expect(screen.getByRole('heading', { level: 2, name: 'No pages' })).toBeInTheDocument();
    expect(screen.getByText('Create the first page.')).toBeInTheDocument();
    expect(screen.getByText('Extra')).toBeInTheDocument();
    expect(document.querySelector('.sf-empty-state__icon .material-symbols-outlined')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it.each([3, 4, 5, 6])('renders a real h%i for level %i', async (level) => {
    await render(`<sf-empty-state title="Empty" [level]="level" />`, {
      imports: [SfEmptyStateComponent],
      componentProperties: { level },
    });

    expect(screen.getByRole('heading', { level, name: 'Empty' }).tagName).toBe(`H${level}`);
  });

  it('renders primary and secondary actions that emit', async () => {
    const primary = vi.fn();
    const secondary = vi.fn();
    await render(
      `<sf-empty-state title="No pages" primaryLabel="New page" primaryIcon="add" secondaryLabel="Import" (primary)="primary()" (secondary)="secondary()" />`,
      { imports: [SfEmptyStateComponent], componentProperties: { primary, secondary } },
    );

    const create = screen.getByRole('button', { name: 'New page' });
    expect(create).toHaveClass('sf-button--primary');
    expect(create.querySelector('.material-symbols-outlined')?.textContent?.trim()).toBe('add');
    fireEvent.click(create);
    expect(primary).toHaveBeenCalledTimes(1);

    const importButton = screen.getByRole('button', { name: 'Import' });
    expect(importButton).toHaveClass('sf-button--secondary');
    fireEvent.click(importButton);
    expect(secondary).toHaveBeenCalledTimes(1);
  });
});
