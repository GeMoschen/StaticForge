import '@angular/compiler';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../../core/auth/auth.store';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { GlobalSetDetailComponent } from './global-set-detail.component';
import { GlobalsService, type GlobalSetDetailView } from './globals.service';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';

// `compiledDefinition`/`content` are `JsonNode` on the server, which openapi-typescript renders as
// `Record<string, never>`; the fixture carries real JSON, so it is cast rather than typed field by field.
const SET = {
  uuid: 'set-uuid',
  uid: 'site',
  displayName: 'Site',
  folderPath: '/globals_root/',
  contentDefinition: 'content { editor text title { label "Site title" } }',
  compiledDefinition: { editors: [{ name: 'title', type: 'TEXT', label: 'Site title' }], bodies: [] },
  content: { title: 'Acme Outdoor' },
  revision: 4,
} as unknown as GlobalSetDetailView;

function globalsStub(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn().mockReturnValue(of(SET)),
    updateSchema: vi.fn().mockReturnValue(of(SET)),
    updateContent: vi.fn().mockReturnValue(of(SET)),
    validateCdl: vi.fn().mockReturnValue(of({ diagnostics: [] })),
    delete: vi.fn().mockReturnValue(of(void 0)),
    ...overrides,
  };
}

function setup(role: string, globals: ReturnType<typeof globalsStub>, revision: number | null = null) {
  const timeTravel = new TimeTravelStore();
  if (revision != null) {
    timeTravel.enter(revision);
  }
  return render(GlobalSetDetailComponent, {
    componentInputs: { projectKey: 'proj', uuid: 'set-uuid' },
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: GlobalsService, useValue: globals },
      { provide: AuthStore, useValue: { roleFor: () => role } },
      { provide: TimeTravelStore, useValue: timeTravel },
      provideProjectPermissions({ role: () => role, readOnly: () => timeTravel.isTimeTravel() }),
    ],
  });
}

describe('GlobalSetDetailComponent', () => {
  it('loads the set and renders its values form from the compiled definition', async () => {
    const globals = globalsStub();
    await setup('DEVELOPER', globals);

    expect(globals.get).toHaveBeenCalledWith('proj', 'set-uuid', null);
    await waitFor(() => expect(screen.getByText('Site')).toBeTruthy());
  });

  it('saves values with the If-Match built from the loaded revision', async () => {
    const globals = globalsStub();
    await setup('EDITOR', globals);

    await waitFor(() => screen.getByText('Save values').click());

    await waitFor(() =>
      expect(globals.updateContent).toHaveBeenCalledWith('proj', 'set-uuid', expect.anything(), '"rev-4"'),
    );
  });

  /**
   * The schema is a developer's to change. An editor sees the tab — they need to read what the
   * fields mean — but every control on it is disabled, and the server returns 403 regardless.
   */
  it('disables the schema controls for an editor and leaves the values editable', async () => {
    const globals = globalsStub();
    await setup('EDITOR', globals);

    await waitFor(() => screen.getByText('Schema').click());

    await waitFor(() => {
      const save = screen.getByText('Save schema').closest('button');
      expect(save?.hasAttribute('disabled')).toBe(true);
    });
    expect(screen.getByText('You need the developer role to change this schema.')).toBeTruthy();
  });

  it('leaves both tabs read-only for a viewer', async () => {
    const globals = globalsStub();
    await setup('VIEWER', globals);

    await waitFor(() => {
      const save = screen.getByText('Save values').closest('button');
      expect(save?.hasAttribute('disabled')).toBe(true);
    });
  });

  /** A 409 means someone else wrote a newer version: reload rather than retry over their edit. */
  it('reloads the set after a 409 instead of retrying the save', async () => {
    const globals = globalsStub({
      updateContent: vi
        .fn()
        .mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: {} }))),
    });
    await setup('EDITOR', globals);

    await waitFor(() => screen.getByText('Save values').click());

    await waitFor(() => expect(globals.get).toHaveBeenCalledTimes(2));
    expect(globals.updateContent).toHaveBeenCalledTimes(1);
  });

  it('shows field-level messages when a save is rejected with 422 issues', async () => {
    const globals = globalsStub({
      updateContent: vi.fn().mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 422,
              error: { issues: [{ path: 'title', code: 'type', message: 'Content must be an object.' }] },
            }),
        ),
      ),
    });
    await setup('EDITOR', globals);

    await waitFor(() => screen.getByText('Save values').click());

    await waitFor(() => expect(screen.getByText(/Content must be an object./)).toBeTruthy());
  });

  it('shows CDL diagnostics when a schema save is rejected', async () => {
    const globals = globalsStub({
      updateSchema: vi.fn().mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 422,
              error: {
                diagnostics: [
                  {
                    severity: 'ERROR',
                    code: 'SF-CDL-0107',
                    message: "body 'main' is not allowed in a global property set",
                  },
                ],
              },
            }),
        ),
      ),
    });
    await setup('DEVELOPER', globals);

    await waitFor(() => screen.getByText('Schema').click());
    await waitFor(() => screen.getByText('Save schema').click());

    await waitFor(() => expect(screen.getByText(/SF-CDL-0107/)).toBeTruthy());
  });

  /** Time travel is read-only for everyone, whatever their role, and reads the historical version. */
  it('is entirely read-only during time travel and loads the historical revision', async () => {
    const globals = globalsStub();
    await setup('DEVELOPER', globals, 3);

    expect(globals.get).toHaveBeenCalledWith('proj', 'set-uuid', 3);
    await waitFor(() => {
      const save = screen.getByText('Save values').closest('button');
      expect(save?.hasAttribute('disabled')).toBe(true);
    });
    expect(screen.getByText(/read-only until you leave time travel/)).toBeTruthy();
  });

  it('offers the CMS_GLOBAL snippet a developer pastes into a template', async () => {
    await setup('DEVELOPER', globalsStub());

    await waitFor(() => expect(screen.getByText('$CMS_VALUE(CMS_GLOBAL.site.title)$')).toBeTruthy());
  });
});
