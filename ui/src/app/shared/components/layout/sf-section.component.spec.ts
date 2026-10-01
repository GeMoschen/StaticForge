import { render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfButtonComponent } from '../sf-button.component';
import { SfSectionComponent } from './sf-section.component';

describe('SfSectionComponent', () => {
  it('is a region labelled by its h2 heading, with description, actions and body', async () => {
    await render(
      `<sf-section heading="Publishing" description="Where the site goes">
        <sf-button sfSectionActions>Add target</sf-button>
        <p>Body text</p>
      </sf-section>`,
      { imports: [SfSectionComponent, SfButtonComponent] },
    );

    const region = screen.getByRole('region', { name: 'Publishing' });
    expect(screen.getByRole('heading', { level: 2, name: 'Publishing' })).toBeInTheDocument();
    expect(region).toHaveTextContent('Where the site goes');
    expect(region.querySelector('.sf-section__actions')).toContainElement(
      screen.getByRole('button', { name: 'Add target' }),
    );
    expect(region.querySelector('.sf-section__body')).toContainElement(screen.getByText('Body text'));
  });

  it.each([3, 4, 5, 6])('renders a real h%i for level %i', async (level) => {
    await render(`<sf-section heading="Details" [level]="level" />`, {
      imports: [SfSectionComponent],
      componentProperties: { level },
    });

    expect(screen.getByRole('heading', { level, name: 'Details' }).tagName).toBe(`H${level}`);
  });

  it('accepts the level as an attribute string and clamps it', async () => {
    await render(`<sf-section heading="A" level="3" /><sf-section heading="B" level="9" />`, {
      imports: [SfSectionComponent],
    });

    expect(screen.getByRole('heading', { name: 'A' }).tagName).toBe('H3');
    expect(screen.getByRole('heading', { name: 'B' }).tagName).toBe('H6');
  });
});
