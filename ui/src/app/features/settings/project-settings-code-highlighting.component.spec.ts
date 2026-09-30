import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ProjectSettingsCodeHighlightingComponent } from './project-settings-code-highlighting.component';

async function setup(overrides: { extensions?: Record<string, string>; mimeTypes?: Record<string, string> } | null, api: object) {
  const view = await render(ProjectSettingsCodeHighlightingComponent, {
    componentInputs: { projectKey: 'acme', overrides },
    providers: [provideRouter([]), { provide: ApiClient, useValue: api }, provideProjectPermissions({ projectKey: 'acme' })],
  });
  return view;
}

describe('ProjectSettingsCodeHighlightingComponent', () => {
  it('lists the overrides and saves an added extension normalized', async () => {
    const saved = { key: 'acme', codeHighlighting: { extensions: { tpl: 'HTML' }, mimeTypes: { 'text/x-conf': 'YAML' } } };
    const api = { updateCodeHighlighting: vi.fn().mockReturnValue(of(saved)) };
    await setup({ extensions: {}, mimeTypes: { 'text/x-conf': 'YAML' } }, api);

    expect(await screen.findByDisplayValue('text/x-conf')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save code highlighting' });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Add extension' }));
    const input = screen.getByRole('textbox', { name: 'File extension' });
    fireEvent.input(input, { target: { value: 't/pl' } });
    expect(await screen.findByText('Use 1–10 lower-case letters or digits.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save code highlighting' })).toBeDisabled();

    fireEvent.input(input, { target: { value: '.TPL' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Save code highlighting' }));
    expect(api.updateCodeHighlighting).toHaveBeenCalledWith('acme', {
      extensions: { tpl: 'HTML' },
      mimeTypes: { 'text/x-conf': 'YAML' },
    });
  });

  it('removes an entry and shows what the server rejects', async () => {
    const api = {
      updateCodeHighlighting: vi
        .fn()
        .mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { errors: ['MIME type bad'] } }))),
    };
    await setup({ extensions: { tpl: 'HTML', md: 'MARKDOWN' } }, api);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove md' }));
    expect(screen.queryByDisplayValue('md')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Save code highlighting' }));
    expect(api.updateCodeHighlighting).toHaveBeenCalledWith('acme', { extensions: { tpl: 'HTML' }, mimeTypes: {} });
    expect(await screen.findByRole('alert')).toHaveTextContent('MIME type bad');
  });

  it('flags a key listed twice', async () => {
    await setup({ extensions: { tpl: 'HTML' } }, { updateCodeHighlighting: vi.fn() });
    await screen.findByDisplayValue('tpl');
    fireEvent.click(screen.getByRole('button', { name: 'Add extension' }));
    const inputs = screen.getAllByRole('textbox', { name: 'File extension' });
    fireEvent.input(inputs[1], { target: { value: 'tpl' } });
    expect(await screen.findByText('Listed twice.')).toBeInTheDocument();
  });
});
