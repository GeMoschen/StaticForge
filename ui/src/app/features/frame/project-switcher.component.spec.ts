import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, within } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { ProjectSwitcherComponent } from './project-switcher.component';

const PROJECTS = [
  { key: 'acme', name: 'Acme Website', yourRole: 'EDITOR' },
  { key: 'blog', name: 'Company Blog', yourRole: 'EDITOR', archived: true },
  { key: 'docs', name: 'Docs', yourRole: 'VIEWER' },
];

async function setup(projectKey: string | null = 'acme') {
  const view = await render(ProjectSwitcherComponent, {
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      {
        provide: FrameContextStore,
        useValue: { projectKey: signal(projectKey), projectName: computed(() => (projectKey === 'acme' ? 'Acme Website' : null)) },
      },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const open = async () => {
    fireEvent.click(screen.getAllByRole('button')[0]);
    view.fixture.detectChanges();
    http.expectOne('/api/v1/projects').flush(PROJECTS);
    view.fixture.detectChanges();
  };
  return { ...view, http, open, preferences: TestBed.inject(PreferencesService) };
}

describe('ProjectSwitcherComponent', () => {
  it('names the open project on its button', async () => {
    await setup('acme');
    expect(screen.getByRole('button', { name: /Acme Website/ })).toBeTruthy();
  });

  it('has no project name to show outside a project', async () => {
    await setup(null);
    expect(screen.getByRole('button', { name: /Projects/ })).toBeTruthy();
  });

  it('remembers the open project as a recent one', async () => {
    const { preferences, fixture } = await setup('acme');
    TestBed.flushEffects();
    fixture.detectChanges();
    expect(preferences.recentProjects()).toEqual(['acme']);
  });

  it('lists the projects when opened, with a link to each and to the whole list', async () => {
    const { open } = await setup();
    await open();
    expect(screen.getByRole('dialog', { name: 'Switch project' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Docs' }).getAttribute('href')).toBe('/p/docs/pages');
    expect(screen.getByRole('link', { name: /Company Blog/ }).textContent).toContain('Archived');
    expect(screen.getByRole('link', { name: 'All projects' }).getAttribute('href')).toBe('/');
    // The open project is in both the recent and the all-projects list.
    for (const link of screen.getAllByRole('link', { name: /Acme Website/ })) {
      expect(link.getAttribute('aria-current')).toBe('true');
    }
  });

  it('filters by name or key, and says when nothing matches', async () => {
    const { open, fixture } = await setup();
    await open();
    const search = screen.getByRole('searchbox', { name: 'Find a project' });
    fireEvent.input(search, { target: { value: 'blog' } });
    fixture.detectChanges();
    expect(screen.queryByRole('link', { name: 'Docs' })).toBeNull();
    expect(screen.getByRole('link', { name: /Company Blog/ })).toBeTruthy();

    fireEvent.input(search, { target: { value: 'zzz' } });
    fixture.detectChanges();
    expect(screen.getByText('No project matches “zzz”.')).toBeTruthy();
  });

  it('stars a project into the favorites group, and unstars it again', async () => {
    const { open, fixture, preferences } = await setup();
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Add Docs to favorites' }));
    fixture.detectChanges();
    expect(preferences.favoriteProjects()).toEqual(['docs']);
    const favorites = screen.getByRole('region', { name: 'Favorites' });
    expect(within(favorites).getByRole('link', { name: 'Docs' })).toBeTruthy();

    fireEvent.click(within(favorites).getByRole('button', { name: 'Remove Docs from favorites' }));
    fixture.detectChanges();
    expect(preferences.favoriteProjects()).toEqual([]);
  });

  it('moves between the rows with the arrow keys and back into the search box', async () => {
    const { open, fixture } = await setup();
    await open();
    const search = screen.getByRole('searchbox', { name: 'Find a project' });
    search.focus();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fixture.detectChanges();
    const rows = screen.getAllByRole('link').filter((link) => link.classList.contains('switcher__link'));
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1], { key: 'ArrowUp' });
    fireEvent.keyDown(rows[0], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(search);
  });

  it('says so when the projects cannot be loaded', async () => {
    const { fixture, http } = await setup();
    fireEvent.click(screen.getAllByRole('button')[0]);
    fixture.detectChanges();
    http.expectOne('/api/v1/projects').flush('', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(screen.getByRole('alert').textContent).toContain('could not be loaded');
  });
});
