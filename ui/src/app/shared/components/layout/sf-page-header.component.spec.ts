import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { SfButtonComponent } from '../sf-button.component';
import { SfMenuItem } from '../menu/sf-menu.component';
import { SfPageHeaderComponent } from './sf-page-header.component';

describe('SfPageHeaderComponent', () => {
  const items: SfMenuItem[] = [
    { id: 'duplicate', label: 'Duplicate' },
    { id: 'delete', label: 'Delete', danger: true },
  ];

  it('renders the title as the h1 with subtitle and projected slots in place', async () => {
    await render(
      `<sf-page-header title="Home page" subtitle="Last edited by Ada">
        <nav sfPageHeaderBreadcrumb aria-label="Breadcrumb">Pages</nav>
        <span sfPageHeaderStatus>Draft</span>
        <sf-button sfPageHeaderActions>Publish</sf-button>
      </sf-page-header>`,
      { imports: [SfPageHeaderComponent, SfButtonComponent] },
    );

    const heading = screen.getByRole('heading', { level: 1, name: 'Home page' });
    expect(screen.getByText('Last edited by Ada')).toBeInTheDocument();

    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    // Breadcrumb above the title, status beside it, actions after it.
    expect(breadcrumb.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.parentElement).toContainElement(screen.getByText('Draft'));
    expect(document.querySelector('.sf-page-header__actions')).toContainElement(
      screen.getByRole('button', { name: 'Publish' }),
    );
    // No secondary actions: no menu.
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('puts secondary actions in a "More actions" menu and emits the chosen one', async () => {
    const chosen = vi.fn();
    await render(
      `<sf-page-header title="Home page" [secondaryActions]="items" (secondaryAction)="chosen($event)" />`,
      { imports: [SfPageHeaderComponent], componentProperties: { items, chosen } },
    );

    const trigger = screen.getByRole('button', { name: 'More actions' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu', { name: 'More actions' });
    expect(menu).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Duplicate' }));

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.click(document.activeElement!);

    expect(chosen).toHaveBeenCalledWith(items[1]);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
