import '@angular/compiler';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../../core/auth/auth.store';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { GlobalSetDetailComponent } from './global-set-detail.component';
import { GlobalsService, type GlobalSetDetailView } from './globals.service';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { typeCode } from '../../shared/code-editor/code-editor.testing';

// `compiledDefinition`/`content` are `JsonNode` on the server, which openapi-typescript renders as
// `Record<string, never>`; the fixture carries real JSON, so it is cast rather than typed field by field.
const SET = {
  uuid: 'set-uuid',
  uid: 'site',
  displayName: 'Site',
  folderPath: '/globals_root/',
  contentCdl: 'editor text title { label "Site title" }',
  rulesCdl: '',
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

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
}

/** Edits the title value, which makes the values form dirty. */
async function editTitle(value = 'Acme Indoor'): Promise<void> {
  const input = await screen.findByLabelText(/Site title/);
  fireEvent.input(input, { target: { value } });
}

/** Edits the schema's Content tab. */
async function editSchema(content: string): Promise<void> {
  (await screen.findByRole('tab', { name: /^Schema/ })).click();
  const editor = await screen.findByRole('textbox', { name: 'Content definition (CDL) — Content' });
  typeCode(editor, content);
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

    await waitFor(() => expect(saveButton().disabled).toBe(true));
    await editTitle();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    saveButton().click();

    await waitFor(() =>
      expect(globals.updateContent).toHaveBeenCalledWith('proj', 'set-uuid', { title: 'Acme Indoor' }, '"rev-4"'),
    );
    expect(globals.updateSchema).not.toHaveBeenCalled();
  });

  /** M34: one Save writes a schema change and the values edited with it — one request, one revision. */
  it('saves schema and edited values together in one request', async () => {
    const globals = globalsStub();
    await setup('DEVELOPER', globals);

    await editTitle();
    await editSchema('editor text title { label "Site title" }\neditor text claim { label "Claim" }');
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Content/ }).textContent).toContain('(unsaved)'));
    saveButton().click();

    await waitFor(() =>
      expect(globals.updateSchema).toHaveBeenCalledWith(
        'proj',
        'set-uuid',
        { content: 'editor text title { label "Site title" }\neditor text claim { label "Claim" }', bodies: '', rules: '' },
        { title: 'Acme Indoor' },
        '"rev-4"',
      ),
    );
    expect(globals.updateContent).not.toHaveBeenCalled();
  });

  it('saves on Ctrl+S', async () => {
    const globals = globalsStub();
    const view = await setup('EDITOR', globals);
    await editTitle();
    const root = (view.fixture.nativeElement as HTMLElement).querySelector('.global-detail')!;
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    await waitFor(() => expect(globals.updateContent).toHaveBeenCalledTimes(1));
  });

  /**
   * The schema is a developer's to change. An editor sees the tab — they need to read what the
   * fields mean — but every control on it is disabled, and the server returns 403 regardless.
   */
  it('disables the schema controls for an editor and leaves the values editable', async () => {
    const globals = globalsStub();
    await setup('EDITOR', globals);

    await editTitle();
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    await waitFor(() => screen.getByRole('tab', { name: /^Schema/ }).click());
    await waitFor(() => expect(screen.getByText('You need the developer role to change this schema.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Delete property set' }).hasAttribute('disabled')).toBe(true);
  });

  it('leaves both tabs read-only for a viewer', async () => {
    const globals = globalsStub();
    await setup('VIEWER', globals);

    await waitFor(() => expect(saveButton().disabled).toBe(true));
  });

  /** A 409 means someone else wrote a newer version: reload rather than retry over their edit. */
  it('reloads the set after a 409 instead of retrying the save', async () => {
    const globals = globalsStub({
      updateContent: vi
        .fn()
        .mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: {} }))),
    });
    await setup('EDITOR', globals);

    await editTitle();
    await waitFor(() => saveButton().click());

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

    await editTitle();
    await waitFor(() => saveButton().click());

    await waitFor(() => expect(screen.getByText(/Content must be an object./)).toBeTruthy());
  });

  it('shows CDL diagnostics on the failing tab when a schema save is rejected', async () => {
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
                    message: "editor catalog 'cards' is not allowed in a global property set",
                    field: 'rules',
                  },
                ],
              },
            }),
        ),
      ),
    });
    await setup('DEVELOPER', globals);

    await editSchema('editor catalog cards { }');
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Schema/ }).textContent).toContain('(unsaved)'));
    screen.getByRole('tab', { name: /^Values/ }).click();
    await waitFor(() => saveButton().click());

    await waitFor(() => expect(globals.updateSchema).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/SF-CDL-0107/)).toBeTruthy());
    expect(screen.getByRole('tab', { name: /^Schema/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /^Rules/ }).getAttribute('aria-selected')).toBe('true');
  });

  /** Time travel is read-only for everyone, whatever their role, and reads the historical version. */
  it('is entirely read-only during time travel and loads the historical revision', async () => {
    const globals = globalsStub();
    await setup('DEVELOPER', globals, 3);

    expect(globals.get).toHaveBeenCalledWith('proj', 'set-uuid', 3);
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(screen.getByText(/read-only until you leave time travel/)).toBeTruthy();
  });

  it('offers the CMS_GLOBAL snippet a developer pastes into a template', async () => {
    await setup('DEVELOPER', globalsStub());

    await waitFor(() => expect(screen.getByText('$CMS_VALUE(CMS_GLOBAL.site.title)$')).toBeTruthy());
  });
});
