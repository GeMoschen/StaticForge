import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { parseFrameLocation } from '../../core/frame/frame-location';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { ReleaseEventsStore } from '../release/release-events.store';
import { FrameRailComponent } from './frame-rail.component';

const BASE = '/api/v1/projects/proj';

async function setup(url = '/p/proj/pages', developerMode = true) {
  const location = signal(parseFrameLocation(url));
  const enabled = signal(developerMode);
  const view = await render(FrameRailComponent, {
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: FrameContextStore, useValue: { location, projectKey: computed(() => location().projectKey) } },
      { provide: DeveloperModeService, useValue: { enabled } },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  return { ...view, http, location, enabled };
}

describe('FrameRailComponent', () => {
  it('shows the groups of a project with their links, and marks the open area', async () => {
    const { http } = await setup('/p/proj/media');
    http.expectOne(`${BASE}/changes/count`).flush({ total: 0 });

    const nav = screen.getByRole('navigation', { name: 'Project navigation' });
    expect(nav).toBeTruthy();
    for (const name of ['Home', 'Pages', 'Media', 'Content', 'Navigation', 'Globals', 'Changes', 'Publishing', 'Schedules', 'Templates', 'Settings']) {
      expect(screen.getByRole('link', { name })).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: 'Media' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Pages' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Pages' }).getAttribute('href')).toBe('/p/proj/pages');
    expect(screen.getByRole('link', { name: 'Publishing' }).getAttribute('href')).toBe('/p/proj/settings/generation');
  });

  it('hides the Develop group and Templates with developer mode off', async () => {
    const { http, enabled, fixture } = await setup('/p/proj/pages', false);
    http.expectOne(`${BASE}/changes/count`).flush({ total: 0 });
    expect(screen.queryByRole('link', { name: 'Templates' })).toBeNull();
    expect(screen.queryByText('Develop')).toBeNull();

    enabled.set(true);
    TestBed.flushEffects();
    fixture.detectChanges();
    expect(screen.getByRole('link', { name: 'Templates' })).toBeTruthy();
    expect(screen.getByText('Develop')).toBeTruthy();
  });

  it('shows the administration sections in the rail of the admin area', async () => {
    const { fixture } = await setup('/admin/jobs');
    fixture.detectChanges();
    expect(screen.getByRole('navigation', { name: 'Administration navigation' })).toBeTruthy();
    for (const name of ['Users', 'Projects', 'Jobs', 'Audit']) {
      expect(screen.getByRole('link', { name })).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: 'Jobs' }).getAttribute('href')).toBe('/admin/jobs');
    expect(screen.getByRole('link', { name: 'Jobs' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('shows the count of unreleased changes and re-reads it after a release action', async () => {
    const { http, fixture } = await setup();
    http.expectOne(`${BASE}/changes/count`).flush({ NEW: 1, CHANGED: 2, total: 3 });
    fixture.detectChanges();
    expect(screen.getByRole('link', { name: 'Changes 3' })).toBeTruthy();

    TestBed.inject(ReleaseEventsStore).changed();
    TestBed.flushEffects();
    http.expectOne(`${BASE}/changes/count`).flush({ NEW: 1, total: 1 });
    fixture.detectChanges();
    expect(screen.getByRole('link', { name: 'Changes 1' })).toBeTruthy();
    http.verify();
  });

  it('collapses to icons with a name on each item, and remembers it in the preferences', async () => {
    const { http, fixture } = await setup();
    http.expectOne(`${BASE}/changes/count`).flush({ NEW: 2, total: 2 });
    const preferences = TestBed.inject(PreferencesService);
    expect(preferences.railCollapsed()).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    fixture.detectChanges();
    expect(preferences.railCollapsed()).toBe(true);
    expect(fixture.nativeElement.classList.contains('is-collapsed')).toBe(true);
    // Collapsed, the visible label is gone: the link keeps its name (with the count) for assistive technology.
    expect(screen.getByRole('link', { name: 'Changes (2)' }).getAttribute('aria-label')).toBe('Changes (2)');
    expect(screen.getByRole('button', { name: 'Expand sidebar' }).getAttribute('aria-expanded')).toBe('false');
  });
});
