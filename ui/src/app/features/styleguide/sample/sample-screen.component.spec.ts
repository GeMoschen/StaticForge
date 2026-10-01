import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SampleScreenComponent } from './sample-screen.component';

async function setup(query: Record<string, string> = {}) {
  const result = await render(SampleScreenComponent, {
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
    ],
  });
  // The tree loads its root asynchronously.
  await screen.findAllByRole('treeitem');
  return result;
}

/** The query string the screen last wrote (it replaces the history entry, so the path stays). */
function watchQuery(): () => string {
  const replace = vi.spyOn(TestBed.inject(Location), 'replaceState');
  return () => String(replace.mock.lastCall?.[1] ?? '');
}

const h1 = () => screen.getByRole('heading', { level: 1 });
const rail = () => screen.getByRole('navigation', { name: 'Project' });

describe('SampleScreenComponent', () => {
  afterEach(() => {
    delete document.documentElement.dataset['theme'];
    delete document.documentElement.dataset['density'];
  });

  it('has the frame landmarks and one h1', async () => {
    await setup();

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(rail()).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    // No view parameter: the Pages root.
    expect(h1()).toHaveTextContent('Pages');
  });

  it('opens the fixed page editor from the query parameters, in the editor view with a collapsed rail', async () => {
    await setup({ view: 'editor', dev: '0', rail: 'collapsed', theme: 'dark', density: 'comfortable' });

    expect(h1()).toHaveTextContent('Spring harvest arrives');
    expect(screen.getByRole('listbox', { name: 'Outline' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Title/ })).toHaveValue('Spring harvest arrives');
    expect(screen.getByText(/Keep it under 160 characters/)).toBeInTheDocument();
    // Editor view: no Develop group, no UID.
    expect(within(rail()).queryByRole('button', { name: /Templates/ })).not.toBeInTheDocument();
    expect(screen.queryByText('spring_harvest')).not.toBeInTheDocument();
    // Collapsed rail: icons with names, the toggle offers to expand.
    expect(within(rail()).getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(document.documentElement.dataset['density']).toBe('comfortable');
  });

  it('shows UIDs, paths and the Develop group in developer mode', async () => {
    await setup({ view: 'editor', dev: '1' });

    expect(within(rail()).getByRole('button', { name: /Templates/ })).toBeInTheDocument();
    expect(screen.getAllByText('spring_harvest').length).toBeGreaterThan(0);
    expect(screen.getByText('/news/spring-harvest')).toBeInTheDocument();
  });

  it('selects the fixed folder with two rows selected, so the bulk bar shows', async () => {
    await setup({ view: 'folder' });

    expect(h1()).toHaveTextContent('News');
    const bulk = await screen.findByRole('group', { name: /bulk/i });
    expect(within(bulk).getByText(/2 selected/)).toBeInTheDocument();
    expect(within(bulk).getByRole('button', { name: /Delete/ })).toBeInTheDocument();
  });

  it('shows a folder table from the tree and opens a page in the editor', async () => {
    await setup();
    const query = watchQuery();

    fireEvent.click(await screen.findByRole('treeitem', { name: /^News/ }));
    await waitFor(() => expect(h1()).toHaveTextContent('News'));
    expect(screen.getByRole('grid', { name: 'Contents of News' })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('treeitem', { name: /^New roastery in Hamburg/ }));
    await waitFor(() => expect(h1()).toHaveTextContent('New roastery in Hamburg'));
    expect(screen.getByRole('listbox', { name: 'Outline' })).toBeInTheDocument();
    await waitFor(() => expect(query()).toContain('view=editor'));
  });

  it('collapses and expands the rail', async () => {
    await setup();
    const query = watchQuery();

    fireEvent.click(within(rail()).getByRole('button', { name: 'Collapse sidebar' }));
    expect(await within(rail()).findByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(within(rail()).getByRole('button', { name: 'Changes (7)' })).toBeInTheDocument();
    await waitFor(() => expect(query()).toContain('rail=collapsed'));
  });
});
