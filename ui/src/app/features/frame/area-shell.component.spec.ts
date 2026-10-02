import '@angular/compiler';
import { Component, computed, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { parseFrameLocation } from '../../core/frame/frame-location';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { SettingsShellComponent } from '../settings/settings-shell.component';
import { AreaShellComponent } from './area-shell.component';

@Component({ standalone: true, template: 'page' })
class PageComponent {}

async function setup(url: string, { developerMode = true, projectAdmin = true } = {}) {
  const location = signal(parseFrameLocation(url));
  const view = await render(AreaShellComponent, {
    componentInputs: { area: url.split('/')[3] as 'settings' | 'publishing' },
    providers: [
      provideRouter([
        {
          path: 'p/:projectKey/settings',
          children: [{ path: ':page', component: PageComponent }],
        },
        { path: 'p/:projectKey/publishing', children: [{ path: ':page', component: PageComponent }] },
      ]),
      { provide: FrameContextStore, useValue: { location, projectKey: computed(() => location().projectKey) } },
      { provide: DeveloperModeService, useValue: { enabled: signal(developerMode) } },
      { provide: ProjectPermissionsStore, useValue: { readsAsProjectAdmin: signal(projectAdmin) } },
    ],
  });
  return { ...view, location };
}

describe('AreaShellComponent', () => {
  it('shows the Settings groups with their pages, and the open page as the h1', async () => {
    await setup('/p/acme/settings/languages');
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(nav).toBeTruthy();
    for (const name of ['General', 'Languages', 'Channels', 'Media', 'Code highlighting', 'Compaction', 'Import / export', 'Members']) {
      expect(screen.getByRole('link', { name })).toBeTruthy();
    }
    for (const heading of ['Project', 'Maintenance', 'People']) {
      expect(screen.getByText(heading)).toBeTruthy();
    }
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Languages');
  });

  it('shows Publishing as its own menu with the checks grouped', async () => {
    await setup('/p/acme/publishing/targets');
    expect(screen.getByRole('navigation', { name: 'Publishing sections' })).toBeTruthy();
    for (const name of ['Runs', 'Targets', 'Publish policy', 'Quality', 'Redirects', 'URLs']) {
      expect(screen.getByRole('link', { name })).toBeTruthy();
    }
    expect(screen.getByText('Checks')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Targets');
  });

  it('links each page below the area, from the shell route (as Settings and Publishing mount it)', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'p/:projectKey/settings',
            component: SettingsShellComponent,
            children: [{ path: ':page', component: PageComponent }],
          },
        ]),
        { provide: FrameContextStore, useValue: { location: signal(parseFrameLocation('/p/acme/settings/general')) } },
        { provide: DeveloperModeService, useValue: { enabled: signal(true) } },
        { provide: ProjectPermissionsStore, useValue: { readsAsProjectAdmin: signal(true) } },
      ],
    });
    const harness = await RouterTestingHarness.create('/p/acme/settings/general');
    const members = harness.routeNativeElement?.querySelector('a[href$="/members"]');
    expect(members?.getAttribute('href')).toBe('/p/acme/settings/members');
    expect(members?.getAttribute('aria-current')).toBeNull();
    expect(harness.routeNativeElement?.querySelector('a[href$="/general"]')?.getAttribute('aria-current')).toBe('page');
  });

  it('leaves out Channels in the editor view and Compaction for non-admins', async () => {
    await setup('/p/acme/settings/general', { developerMode: false, projectAdmin: false });
    expect(screen.queryByRole('link', { name: 'Channels' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Compaction' })).toBeNull();
    expect(screen.getByRole('link', { name: 'General' })).toBeTruthy();
  });

  it('follows the page the user opens', async () => {
    const { location, fixture } = await setup('/p/acme/settings/general');
    location.set(parseFrameLocation('/p/acme/settings/members'));
    fixture.detectChanges();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Members');
  });
});
