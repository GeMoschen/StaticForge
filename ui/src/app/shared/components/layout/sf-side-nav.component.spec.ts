import { Location } from '@angular/common';
import { Component } from '@angular/core';
import { RouterOutlet, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { SfSideNavComponent, SfSideNavItem } from './sf-side-nav.component';

@Component({ standalone: true, template: '' })
class BlankComponent {}

/** A routed area page whose side nav uses links relative to its route. */
@Component({
  standalone: true,
  imports: [SfSideNavComponent, RouterOutlet],
  template: `<sf-side-nav [mode]="mode" label="Settings" [items]="items" /><router-outlet />`,
})
class SettingsPageComponent {
  static mode: 'list' | 'select' = 'select';
  readonly mode = SettingsPageComponent.mode;
  readonly items: SfSideNavItem[] = [
    { id: 'general', label: 'General', link: 'general' },
    { id: 'languages', label: 'Languages', link: ['languages'] },
  ];
}

const SECTIONS: SfSideNavItem[] = [
  { id: 'runs', label: 'Runs', icon: 'history', badge: 1, badgeTone: 'info' },
  { id: 'targets', label: 'Targets', icon: 'dns' },
  { id: 'quality', label: 'Quality', group: 'Checks', badge: 3 },
  { id: 'redirects', label: 'Redirects', group: 'Checks' },
];

describe('SfSideNavComponent', () => {
  it('is a labelled nav of buttons; the current one has aria-current and a click emits select', async () => {
    const select = vi.fn();
    await render(`<sf-side-nav label="Publishing" [items]="items" current="targets" (select)="select($event)" />`, {
      imports: [SfSideNavComponent],
      componentProperties: { items: SECTIONS, select },
    });

    const nav = screen.getByRole('navigation', { name: 'Publishing' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Targets/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /Runs/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: /Runs/ })).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: /Quality/ }));
    expect(select).toHaveBeenCalledWith('quality');
  });

  it('lists grouped items under a heading that labels their list', async () => {
    await render(`<sf-side-nav label="Publishing" [items]="items" />`, {
      imports: [SfSideNavComponent],
      componentProperties: { items: SECTIONS },
    });

    const group = screen.getByRole('list', { name: 'Checks' });
    expect(group.querySelectorAll('li')).toHaveLength(2);
    // Not a document heading: the host owns the heading hierarchy.
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('renders router items as links with aria-current on the active route', async () => {
    const items: SfSideNavItem[] = [
      { id: 'general', label: 'General', link: '/settings/general' },
      { id: 'languages', label: 'Languages', link: '/settings/languages' },
    ];
    const { navigate } = await render(`<sf-side-nav label="Settings" [items]="items" />`, {
      imports: [SfSideNavComponent],
      componentProperties: { items },
      routes: [{ path: 'settings/:page', component: BlankComponent }],
    });

    await navigate('/settings/languages');

    expect(await screen.findByRole('link', { name: 'Languages' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'General' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'General' })).toHaveAttribute('href', '/settings/general');
  });

  it('collapses into a labelled select in narrow mode; picking an entry emits select', async () => {
    const select = vi.fn();
    await render(`<sf-side-nav mode="select" label="Publishing" [items]="items" current="runs" (select)="select($event)" />`, {
      imports: [SfSideNavComponent],
      componentProperties: { items: SECTIONS, select },
      providers: [provideRouter([])],
    });

    expect(document.querySelector('sf-side-nav')).toHaveClass('sf-side-nav--narrow');
    expect(screen.queryByRole('button')).toBeNull();
    const combo = screen.getByRole('combobox', { name: 'Publishing' }) as HTMLSelectElement;
    const labels = Array.from(combo.options).filter((o) => !o.hidden).map((o) => o.textContent?.trim());
    expect(labels).toEqual(['Runs (1)', 'Targets', 'Checks › Quality (3)', 'Checks › Redirects']);
    expect(combo.options[combo.selectedIndex].textContent?.trim()).toBe('Runs (1)');

    const quality = Array.from(combo.options).findIndex((o) => o.textContent?.includes('Quality'));
    combo.selectedIndex = quality;
    fireEvent.change(combo);
    expect(select).toHaveBeenCalledWith('quality');
  });

  it('navigates when a router item is picked from the narrow select', async () => {
    const items: SfSideNavItem[] = [
      { id: 'general', label: 'General', link: '/settings/general' },
      { id: 'languages', label: 'Languages', link: '/settings/languages' },
    ];
    const { fixture, navigate } = await render(`<sf-side-nav mode="select" label="Settings" [items]="items" />`, {
      imports: [SfSideNavComponent],
      componentProperties: { items },
      routes: [{ path: 'settings/:page', component: BlankComponent }],
    });
    await navigate('/settings/general');
    await fixture.whenStable();

    const combo = screen.getByRole('combobox', { name: 'Settings' }) as HTMLSelectElement;
    expect(combo.options[combo.selectedIndex].textContent?.trim()).toBe('General');
    combo.selectedIndex = Array.from(combo.options).findIndex((o) => o.textContent?.includes('Languages'));
    fireEvent.change(combo);
    await fixture.whenStable();

    expect(fixture.debugElement.injector.get(Location).path()).toBe('/settings/languages');
  });

  describe('relative links resolve from its route, like routerLink', () => {
    const routes = [
      { path: 'settings', component: SettingsPageComponent, children: [{ path: ':page', component: BlankComponent }] },
    ];

    it('in list mode', async () => {
      SettingsPageComponent.mode = 'list';
      const { navigate } = await render(`<router-outlet />`, { imports: [RouterOutlet], routes });
      await navigate('/settings/languages');

      expect(await screen.findByRole('link', { name: 'Languages' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('link', { name: 'General' })).toHaveAttribute('href', '/settings/general');
    });

    it('in select mode: the active entry and navigation', async () => {
      SettingsPageComponent.mode = 'select';
      const { fixture, navigate } = await render(`<router-outlet />`, { imports: [RouterOutlet], routes });
      await navigate('/settings/general');
      await fixture.whenStable();
      const combo = (await screen.findByRole('combobox', { name: 'Settings' })) as HTMLSelectElement;
      expect(combo.options[combo.selectedIndex].textContent?.trim()).toBe('General');

      combo.selectedIndex = Array.from(combo.options).findIndex((o) => o.textContent?.includes('Languages'));
      fireEvent.change(combo);
      await fixture.whenStable();
      expect(fixture.debugElement.injector.get(Location).path()).toBe('/settings/languages');
      await waitFor(() => expect(combo.options[combo.selectedIndex].textContent?.trim()).toBe('Languages'));
    });
  });
});
