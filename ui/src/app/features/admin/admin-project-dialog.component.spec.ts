import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { AdminProjectDialogComponent } from './admin-project-dialog.component';
import type { AdminProjectRow } from './admin-projects.util';

const acme: AdminProjectRow = { key: 'acme', name: 'ACME Website', description: 'Main site' };

async function setup(inputs: Record<string, unknown> = {}) {
  const api = {
    createProject: vi.fn().mockReturnValue(of({ key: 'lumen' })),
    getProject: vi.fn().mockReturnValue(of({ key: 'acme', allowedMimeTypes: ['image/png'] })),
    updateProject: vi.fn().mockReturnValue(of({ key: 'acme' })),
  };
  const done = vi.fn();
  const closed = vi.fn();
  await render(AdminProjectDialogComponent, {
    inputs,
    on: { done, closed },
    providers: [provideTranslocoTesting(), { provide: ApiClient, useValue: api }],
  });
  return { api, done, closed };
}

const key = () => screen.getByLabelText(/Project key/) as HTMLInputElement;
const name = () => screen.getByLabelText(/^Name/) as HTMLInputElement;
const create = () => screen.getByRole('button', { name: 'Create project' }) as HTMLButtonElement;
const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

describe('AdminProjectDialogComponent — new project', () => {
  it('keeps Create project disabled until the key and the name are valid', async () => {
    await setup();
    expect(create().disabled).toBe(true);

    fireEvent.input(key(), { target: { value: 'lumen' } });
    expect(create().disabled).toBe(true);
    fireEvent.input(name(), { target: { value: 'Lumen Coffee' } });
    expect(create().disabled).toBe(false);
  });

  it('checks the key as you type: upper case, format and a key that is taken — and says nothing while empty', async () => {
    await setup({ takenKeys: ['acme'] });
    expect(screen.queryByText(/lower case letters only/i)).toBeNull();

    fireEvent.input(key(), { target: { value: 'Lumen' } });
    expect(await screen.findByText('Use lower case letters only.')).toBeTruthy();

    fireEvent.input(key(), { target: { value: '9lumen' } });
    expect(await screen.findByText(/Start with a letter/)).toBeTruthy();

    fireEvent.input(key(), { target: { value: 'acme' } });
    expect(await screen.findByText('A project with this key already exists.')).toBeTruthy();
    fireEvent.input(name(), { target: { value: 'Another' } });
    expect(create().disabled).toBe(true);
  });

  it('creates the project with the trimmed name and description, then reports it and closes', async () => {
    const { api, done, closed } = await setup();
    fireEvent.input(key(), { target: { value: 'lumen' } });
    fireEvent.input(name(), { target: { value: '  Lumen Coffee ' } });
    fireEvent.click(create());

    expect(api.createProject).toHaveBeenCalledWith({ key: 'lumen', name: 'Lumen Coffee', description: '' });
    expect(done).toHaveBeenCalledWith('Lumen Coffee');
    expect(closed).toHaveBeenCalled();
  });

  it('shows what the server refused under the key and stays open', async () => {
    const { api, closed } = await setup();
    api.createProject.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'SF-API-0409', detail: 'Project key already in use.' } })),
    );
    fireEvent.input(key(), { target: { value: 'lumen' } });
    fireEvent.input(name(), { target: { value: 'Lumen' } });
    fireEvent.click(create());

    expect(await screen.findByText('Project key already in use.')).toBeTruthy();
    expect(closed).not.toHaveBeenCalled();
  });
});

describe('AdminProjectDialogComponent — edit project', () => {
  it('shows the key read-only, and enables Save only once the name or description changed', async () => {
    await setup({ project: acme });
    expect(key().value).toBe('acme');
    expect(key().readOnly).toBe(true);
    expect(screen.getByText('The key cannot be changed.')).toBeTruthy();
    expect(save().disabled).toBe(true);

    fireEvent.input(name(), { target: { value: 'ACME Corporate' } });
    expect(save().disabled).toBe(false);
    fireEvent.input(name(), { target: { value: 'ACME Website' } });
    expect(save().disabled).toBe(true);
  });

  it('saves name and description and sends the MIME type override back unchanged', async () => {
    const { api, done } = await setup({ project: acme });
    fireEvent.input(name(), { target: { value: 'ACME Corporate' } });
    fireEvent.click(save());

    await waitFor(() => expect(api.updateProject).toHaveBeenCalled());
    expect(api.getProject).toHaveBeenCalledWith('acme');
    expect(api.updateProject).toHaveBeenCalledWith('acme', { name: 'ACME Corporate', description: 'Main site', allowedMimeTypes: ['image/png'] });
    expect(done).toHaveBeenCalledWith('ACME Corporate');
  });

  it('refuses an empty name', async () => {
    await setup({ project: acme });
    fireEvent.input(name(), { target: { value: '   ' } });
    expect(save().disabled).toBe(true);
  });
});
