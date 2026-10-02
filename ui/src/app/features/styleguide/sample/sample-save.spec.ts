import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it } from 'vitest';
import { ToastService } from '../../../core/ui/toast.service';
import { SampleScreenComponent } from './sample-screen.component';

async function setup(query: Record<string, string>) {
  const result = await render(SampleScreenComponent, {
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
    ],
  });
  return result;
}

const rail = () => screen.getByRole('navigation', { name: 'Project' });

afterEach(() => {
  delete document.documentElement.dataset['theme'];
  delete document.documentElement.dataset['density'];
  delete document.documentElement.dataset['codePalette'];
  TestBed.inject(ToastService).clear();
});

describe('Settings: one save area and the leave guard (M35.13)', () => {
  it('shows Saved, then Unsaved changes after an edit, then Not saved when the name is blank', async () => {
    await setup({ area: 'settings' });
    const header = await screen.findByRole('heading', { level: 1, name: 'General' });
    expect(header).toBeInTheDocument();
    expect(screen.getAllByRole('status').some((s) => s.textContent?.includes('Saved'))).toBe(true);

    const name = screen.getByRole('textbox', { name: /Project name/ });
    fireEvent.input(name, { target: { value: '' } });
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Not saved — 1 error')).toBeInTheDocument();
  });

  it('asks before another section opens, and a refused save keeps the person where they are', async () => {
    await setup({ area: 'settings' });
    const name = await screen.findByRole('textbox', { name: /Project name/ });
    fireEvent.input(name, { target: { value: '' } });
    fireEvent.click(await screen.findByRole('link', { name: /Languages/ }).catch(() => screen.getByRole('button', { name: /Languages/ })));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Settings › General/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/the project name is required/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeInTheDocument();

    // Discard gives the draft up and opens the section.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Languages' })).toBeInTheDocument());
  });

  it('asks before the rail leaves the screen, and Cancel stays', async () => {
    await setup({ area: 'settings' });
    const name = await screen.findByRole('textbox', { name: /Project name/ });
    fireEvent.input(name, { target: { value: 'Another name' } });
    fireEvent.click(within(rail()).getByRole('button', { name: 'Media' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
  });
});

describe('Page editor: autosave status, Save now and the leave guard (M35.13)', () => {
  it('shows Not saved — 1 error for a blank title, and asks before leaving', async () => {
    await setup({ view: 'editor' });
    const title = await screen.findByRole('textbox', { name: /^Title/ });
    fireEvent.input(title, { target: { value: '' } });
    expect(await screen.findByText('Not saved — 1 error')).toBeInTheDocument();

    fireEvent.click(within(rail()).getByRole('button', { name: 'Media' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Spring harvest arrives/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/the title is required/)).toBeInTheDocument();
  });

  it('puts Save now with its shortcut in the overflow menu', async () => {
    await setup({ view: 'editor' });
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    const item = await screen.findByRole('menuitem', { name: /Save now/ });
    expect(item).toBeInTheDocument();
  });

  it('walks Unsaved changes → Saving… → Saved after an edit', async () => {
    await setup({ view: 'editor' });
    const teaser = (await screen.findAllByRole('textbox', { name: /^Teaser/ }))[0];
    fireEvent.input(teaser, { target: { value: 'A new teaser.' } });
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();
    expect(await screen.findByText('Saving…', undefined, { timeout: 2000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('status').some((s) => /Saved \d/.test(s.textContent ?? ''))).toBe(true), { timeout: 3000 });
  }, 12_000);
});
