import '@angular/compiler';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectSettingsLocalesComponent } from './project-settings-locales.component';

type ProjectLocalesView = components['schemas']['ProjectLocalesView'];

const TEMPLATE = '44444444-4444-4444-4444-444444444444';

const ONE_LANGUAGE: ProjectLocalesView = {
  locales: [{ code: 'de', label: 'Deutsch' }],
  defaultLocale: 'de',
  fallbacks: {},
  defaultWithoutPrefix: false,
  urlsWillChange: false,
  removedLocales: [],
  retainedValueCount: 0,
  confirmationRequired: false,
  discardedLocaleValues: 0,
  affectedAssets: [],
  warnings: [],
  warningCount: 0,
};

/** What `PUT` answers after adding English: saved, with one page template path lacking `{locale}` (M35.1). */
const TWO_LANGUAGES_WARNED: ProjectLocalesView = {
  ...ONE_LANGUAGE,
  locales: [
    { code: 'de', label: 'Deutsch' },
    { code: 'en', label: 'English' },
  ],
  warnings: [
    {
      code: 'SF-GEN-0112',
      message: 'Output path has no {locale} segment.',
      templateUuid: TEMPLATE,
      templateUid: 'landing',
      templateName: 'Landing page',
      channel: 'html',
      outputPath: '{folder}{uid}.{ext}',
    },
  ],
  warningCount: 3,
};

async function setup(updateResults: ProjectLocalesView[]) {
  const update = vi.fn();
  updateResults.forEach((result) => update.mockReturnValueOnce(of(result)));
  const api = {
    getProjectLocales: vi.fn().mockReturnValue(of(ONE_LANGUAGE)),
    updateProjectLocales: update,
    listPages: vi.fn().mockReturnValue(of([])),
  };
  await render(ProjectSettingsLocalesComponent, {
    componentInputs: { projectKey: 'proj' },
    providers: [{ provide: ApiClient, useValue: api }, provideRouter([])],
  });
  await screen.findByText('Deutsch', { selector: 'option' });
  return api;
}

/** The text inputs (language tag, label) of the language rows, `[row][field]`. */
function rowInputs(): HTMLInputElement[][] {
  return Array.from(document.querySelectorAll('.locale')).map((row) =>
    Array.from(row.querySelectorAll<HTMLInputElement>('input.input')),
  );
}

/** Adds a second language row (`en`) and saves. */
async function addEnglishAndSave(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Add language' }));
  await waitFor(() => expect(rowInputs()).toHaveLength(2));
  fireEvent.input(rowInputs()[1][0], { target: { value: 'en' } });
  const save = screen.getByRole('button', { name: 'Save languages' }) as HTMLButtonElement;
  await waitFor(() => expect(save.disabled).toBe(false));
  fireEvent.click(save);
}

describe('ProjectSettingsLocalesComponent output path warnings (M35.1)', () => {
  it('lists the page templates whose output path lacks {locale} after a save, linked to the template', async () => {
    const api = await setup([TWO_LANGUAGES_WARNED]);
    expect(screen.queryByRole('status', { name: 'Output path warnings' })).toBeNull();

    await addEnglishAndSave();

    const banner = await screen.findByRole('status', { name: 'Output path warnings' });
    expect(api.updateProjectLocales).toHaveBeenCalledTimes(1);
    // The save went through; the banner says how many templates there are in all, and lists the ones sent.
    expect(banner.textContent).toContain('3 page templates have an output path without {locale}');
    expect(banner.textContent).toContain('SF-GEN-0111');
    const link = banner.querySelector('a') as HTMLAnchorElement;
    expect(link.textContent?.trim()).toBe('Landing page');
    expect(link.getAttribute('href')).toBe(`/p/proj/templates?asset=${TEMPLATE}`);
    expect(banner.textContent).toContain('channel html');
    expect(banner.textContent).toContain('{folder}{uid}.{ext}');
    expect(banner.textContent).toContain('and 2 more');
  });

  it('keeps the warnings until they are dismissed', async () => {
    await setup([TWO_LANGUAGES_WARNED]);
    await addEnglishAndSave();
    await screen.findByRole('status', { name: 'Output path warnings' });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(screen.queryByRole('status', { name: 'Output path warnings' })).toBeNull());
  });

  it('replaces them with the next save’s answer: a clean save clears the list', async () => {
    const clean: ProjectLocalesView = { ...TWO_LANGUAGES_WARNED, warnings: [], warningCount: 0 };
    await setup([TWO_LANGUAGES_WARNED, clean]);
    await addEnglishAndSave();
    await screen.findByRole('status', { name: 'Output path warnings' });

    // Another edit, another save.
    fireEvent.input(rowInputs()[1][1], { target: { value: 'English (UK)' } });
    const save = screen.getByRole('button', { name: 'Save languages' }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);

    await waitFor(() => expect(screen.queryByRole('status', { name: 'Output path warnings' })).toBeNull());
  });

  it('shows nothing for a save without warnings, and tolerates an answer without the field', async () => {
    const old: ProjectLocalesView = { ...TWO_LANGUAGES_WARNED, warnings: undefined, warningCount: undefined };
    const api = await setup([old]);

    await addEnglishAndSave();

    await waitFor(() => expect(api.updateProjectLocales).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('status', { name: 'Output path warnings' })).toBeNull();
  });
});
