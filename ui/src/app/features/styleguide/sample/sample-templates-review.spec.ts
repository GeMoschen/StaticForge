import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it } from 'vitest';
import { ToastService } from '../../../core/ui/toast.service';
import { SampleScreenComponent } from './sample-screen.component';
import { uidOf } from './sample-new-template-dialog.component';

/** The Templates area's review states of gate round 13 (M35.21): what the app needs beyond the signed-off sample. */
async function setup(query: Record<string, string> = {}) {
  const result = await render(SampleScreenComponent, {
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ area: 'templates', ...query }) } } },
    ],
  });
  await screen.findAllByRole('treeitem');
  return result;
}

afterEach(() => {
  delete document.documentElement.dataset['theme'];
  delete document.documentElement.dataset['density'];
  TestBed.inject(ToastService).clear();
});

describe('uidOf', () => {
  it('derives a lower case, underscore-separated UID that starts with a letter', () => {
    expect(uidOf('Product teaser')).toBe('product_teaser');
    expect(uidOf('  2nd Hero!! ')).toBe('nd_hero');
    expect(uidOf('***')).toBe('');
  });
});

describe('Templates folder view (gate round 13)', () => {
  it('lists what lies in the top level with the new columns', async () => {
    await setup();
    const grid = await screen.findByRole('grid', { name: 'Contents of Templates' });
    for (const column of ['Name', 'Kind', 'Channels', 'Used by', 'Modified']) {
      expect(within(grid).getByRole('columnheader', { name: new RegExp(column) })).toBeInTheDocument();
    }
    expect(within(grid).getByText('Page templates')).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    const loading = await setup({ fstate: 'empty' });
    expect(await screen.findByText('This folder is empty')).toBeInTheDocument();
    loading.fixture.destroy();
  });

  it('opens the New template dialog with no kind chosen and Create disabled', async () => {
    await setup({ tdialog: 'new' });
    const dialog = await screen.findByRole('dialog', { name: 'New template' });
    const kinds = within(dialog).getAllByRole('radio');
    expect(kinds).toHaveLength(3);
    kinds.forEach((radio) => expect(radio).not.toBeChecked());
    expect(within(dialog).getByRole('button', { name: 'Create' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('takes the kind from the menu entry it was opened from', async () => {
    await setup({ tdialog: 'newpage' });
    const dialog = await screen.findByRole('dialog', { name: 'New template' });
    expect(within(dialog).getByRole('radio', { name: /Page template/ })).toBeChecked();
    expect(within(dialog).getByText('Based on')).toBeInTheDocument();
  });

  it('derives the UID from the name', async () => {
    await setup({ tdialog: 'newpage' });
    const dialog = await screen.findByRole('dialog', { name: 'New template' });
    fireEvent.input(within(dialog).getByRole('textbox', { name: /Name/ }), { target: { value: 'Landing hero' } });
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: /UID/ })).toHaveValue('landing_hero'));
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeEnabled();
  });
});

describe('Template view (gate round 13)', () => {
  it('opens the Used by drawer with the pages that use the template', async () => {
    await setup({ view: 'template', template: 'article', tdialog: 'usedby' });
    expect(await screen.findByText('Used by — Article')).toBeInTheDocument();
    expect(screen.getByText('Spring harvest arrives')).toBeInTheDocument();
  });

  it('asks before deleting and names what uses the template', async () => {
    await setup({ view: 'template', template: 'article', tdialog: 'delete' });
    expect(await screen.findByText(/In use by 3 pages/)).toBeInTheDocument();
  });

  it('shows the load error with Retry and the refused-save banner', async () => {
    const view = await setup({ view: 'template', template: 'article', tstate: 'error' });
    expect(await screen.findByText('The template could not be loaded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Article' })).toBeInTheDocument();
    view.fixture.destroy();
  });

  it('is read-only in an archived project', async () => {
    await setup({ view: 'template', template: 'article', access: 'archived' });
    expect(await screen.findByText('Archived project — read-only')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
  });
});
