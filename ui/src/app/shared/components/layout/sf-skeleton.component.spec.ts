import { render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfSkeletonComponent } from './sf-skeleton.component';

describe('SfSkeletonComponent', () => {
  it('is a busy status announced as "Loading…" with hidden shapes', async () => {
    await render(`<sf-skeleton />`, { imports: [SfSkeletonComponent] });

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('Loading…');
    const shapes = status.querySelector('.sf-skeleton__shapes')!;
    expect(shapes).toHaveAttribute('aria-hidden', 'true');
    expect(shapes.querySelectorAll('.sf-skeleton__line')).toHaveLength(3);
  });

  it('takes its own label and line count', async () => {
    await render(`<sf-skeleton label="Loading pages" lines="5" />`, { imports: [SfSkeletonComponent] });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading pages');
    expect(status.querySelectorAll('.sf-skeleton__line')).toHaveLength(5);
  });

  it.each([
    ['row', '.sf-skeleton__row', 4],
    ['tree', '.sf-skeleton__row', 4],
    ['table', '.sf-skeleton__table-row:not(.sf-skeleton__table-row--head)', 4],
    ['form', '.sf-skeleton__field', 4],
  ])('renders the %s shape with the given rows', async (shape, selector, rows) => {
    await render(`<sf-skeleton [shape]="shape" [rows]="rows" />`, {
      imports: [SfSkeletonComponent],
      componentProperties: { shape, rows },
    });

    const status = screen.getByRole('status');
    expect(status).toHaveClass(`sf-skeleton--${shape}`);
    expect(status.querySelectorAll(selector)).toHaveLength(rows);
  });

  it('indents tree rows like a hierarchy', async () => {
    await render(`<sf-skeleton shape="tree" rows="4" />`, { imports: [SfSkeletonComponent] });

    const rows = Array.from(document.querySelectorAll('.sf-skeleton__row'));
    const indents = rows.map((row) => row.getAttribute('data-indent'));
    expect(indents).toEqual(['0', '1', '1', '2']);
  });
});
