import { Component, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SfTab, SfTabsComponent, fitTabs } from './sf-tabs.component';

const TABS: SfTab[] = [
  { id: 'content', label: 'Content' },
  { id: 'body', label: 'Body', errors: 2 },
  { id: 'rules', label: 'Rules', dirty: true },
  { id: 'html', label: 'HTML', note: 'disabled' },
];

@Component({
  standalone: true,
  imports: [SfTabsComponent],
  template: `<sf-tabs label="CDL" [tabs]="tabs" [selected]="selected()" (selectTab)="selected.set($event)"
    ><button type="button">Add channel</button></sf-tabs
  >`,
})
class TabsHost {
  readonly tabs = TABS;
  readonly selected = signal('content');
}

describe('fitTabs', () => {
  it('keeps every tab when all fit', () => {
    expect([...fitTabs([50, 50, 50], 200, 40, 0)]).toEqual([]);
  });

  it('moves the trailing tabs into the menu, keeping room for it', () => {
    expect([...fitTabs([50, 50, 50, 50], 160, 40, 0)]).toEqual([2, 3]);
  });

  it('keeps the selected tab visible in place of the last ones that fit', () => {
    expect([...fitTabs([50, 50, 50, 50], 160, 40, 3)]).toEqual([1, 2]);
  });

  it('treats an unmeasured strip as fitting', () => {
    expect([...fitTabs([0, 0], 0, 40, 0)]).toEqual([]);
  });
});

describe('SfTabsComponent (tabs mode)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders a labelled tablist with one tab stop on the selected tab', async () => {
    await render(TabsHost);

    expect(screen.getByRole('tablist', { name: 'CDL' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(screen.getByRole('tab', { name: 'Content' })).toHaveAttribute('aria-selected', 'true');
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
  });

  it('announces error counts, unsaved state and notes in the tab names', async () => {
    await render(TabsHost);

    expect(screen.getByRole('tab', { name: 'Body 2 errors' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Rules (unsaved)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'HTML disabled' })).toBeInTheDocument();
  });

  it('selects and focuses with the arrow keys, Home and End (wrapping)', async () => {
    const { fixture } = await render(TabsHost);
    const host = fixture.componentInstance;
    const content = screen.getByRole('tab', { name: 'Content' });

    fireEvent.keyDown(content, { key: 'ArrowRight' });
    expect(host.selected()).toBe('body');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /^Body/ }));

    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(host.selected()).toBe('html');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(host.selected()).toBe('content');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(host.selected()).toBe('html');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(host.selected()).toBe('content');
  });

  it('links each tab to its panel id', async () => {
    const { fixture } = await render(TabsHost);
    const tabs = fixture.debugElement.query((el) => el.name === 'sf-tabs').componentInstance as SfTabsComponent;

    const body = screen.getByRole('tab', { name: /^Body/ });
    expect(body.id).toBe(tabs.tabId('body'));
    expect(body).toHaveAttribute('aria-controls', tabs.panelId('body'));
  });

  it('renders projected controls outside the tab list', async () => {
    await render(TabsHost);

    const add = screen.getByRole('button', { name: 'Add channel' });
    expect(screen.getByRole('tablist').contains(add)).toBe(false);
  });

  it('moves tabs that do not fit into a "More" menu and keeps the selected one visible', async () => {
    // 4 tabs of 100 px in a 250 px strip: two fit next to the menu button.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset['sfTab'] ? 100 : this.classList.contains('sf-tabs__more') ? 40 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('sf-tabs__list') ? 250 : 0;
    });
    const { fixture } = await render(TabsHost);
    const host = fixture.componentInstance;

    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));
    const more = screen.getByRole('button', { name: 'More' });
    fireEvent.click(more);
    const menu = await screen.findByRole('menu', { name: 'More tabs' });
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual([
      'Rules · (unsaved)',
      'HTML · disabled',
    ]);

    fireEvent.click(screen.getByRole('menuitem', { name: 'HTML · disabled' }));
    expect(host.selected()).toBe('html');
    expect(menu.isConnected).toBe(false);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'HTML disabled' })).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'HTML disabled' })));
  });
});

describe('SfTabsComponent (nav mode)', () => {
  @Component({
    standalone: true,
    imports: [SfTabsComponent],
    template: `<sf-tabs mode="nav" label="Settings" [tabs]="tabs" />`,
  })
  class NavHost {
    readonly tabs: SfTab[] = [
      { id: 'general', label: 'General', link: '/settings/general' },
      { id: 'members', label: 'Members', link: '/settings/members' },
    ];
  }

  @Component({ standalone: true, template: '' })
  class Blank {}

  it('renders router links in a labelled nav with aria-current on the active one', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'settings/general', component: NavHost },
          { path: 'settings/members', component: NavHost },
          { path: '**', component: Blank },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/settings/members');

    expect(screen.getByRole('navigation', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    const members = screen.getByRole('link', { name: 'Members' });
    expect(members).toHaveAttribute('href', '/settings/members');
    await waitFor(() => expect(members).toHaveAttribute('aria-current', 'page'));
    expect(screen.getByRole('link', { name: 'General' })).not.toHaveAttribute('aria-current');
  });
});
