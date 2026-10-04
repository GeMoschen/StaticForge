import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { Observable, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
// Through the barrel: the forms module is an import cycle that only evaluates when entered there.
import { SfContentFormComponent } from '../forms';
import { ApiClient } from '../../core/api/api.client';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../core/ui/toast.service';
import { typeCode } from '../../shared/code-editor/code-editor.testing';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { UnsavedChangesService } from '../../shared/components/dialog/unsaved-changes.service';
import { SfCopyableComponent } from '../../shared/components/display/sf-copyable.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfSaveStatusComponent } from '../../shared/components/layout/sf-save-status.component';
import { SfSectionComponent } from '../../shared/components/layout/sf-section.component';
import { SfSkeletonComponent } from '../../shared/components/layout/sf-skeleton.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfCdlSectionsEditorComponent } from '../../shared/components/sf-cdl-sections-editor.component';
import { SfTabsComponent } from '../../shared/components/sf-tabs.component';
import { HistoryDrawerStore } from '../history/history-drawer.store';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { GlobalSetDetailComponent } from './global-set-detail.component';
import { GlobalsService, type GlobalSetDetailView } from './globals.service';

// `compiledDefinition`/`content` are `JsonNode` on the server, which openapi-typescript renders as
// `Record<string, never>`; the fixture carries real JSON, so it is cast rather than typed field by field.
const SET = {
  uuid: 'set-uuid',
  uid: 'site',
  displayName: 'Site',
  folderPath: '/globals_root/',
  contentCdl: 'editor text title { label "Site title" }',
  rulesCdl: '',
  compiledDefinition: {
    editors: [
      { name: 'title', type: 'TEXT', label: 'Site title' },
      { name: 'hours', type: 'LIST', label: 'Opening hours', items: [{ name: 'day', type: 'TEXT' }] },
    ],
    bodies: [],
  },
  content: { title: 'Acme Outdoor', hours: [] },
  revision: 4,
} as unknown as GlobalSetDetailView;

/** A failing request that fails on a later tick, like a real HTTP error (a synchronous failure trips zone.js's unhandled-rejection check before `await` attaches). */
function failing(error: HttpErrorResponse) {
  return new Observable<never>((subscriber) => {
    const id = setTimeout(() => subscriber.error(error));
    return () => clearTimeout(id);
  });
}

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

interface Options {
  role?: string;
  dev?: boolean;
  revision?: number | null;
  confirm?: boolean;
  inputs?: Record<string, unknown>;
}

async function setup(globals: ReturnType<typeof globalsStub>, options: Options = {}) {
  const role = options.role ?? 'DEVELOPER';
  const timeTravel = new TimeTravelStore();
  if (options.revision != null) {
    timeTravel.enter(options.revision);
  }
  const confirm = { confirm: vi.fn().mockResolvedValue(options.confirm ?? true) };
  const history = { toggle: vi.fn(), isOpen: signal(false) };
  // The release group and the favorite star have their own specs; only the detail's own behaviour is under test.
  TestBed.overrideComponent(GlobalSetDetailComponent, {
    set: {
      imports: [
        SfButtonComponent,
        SfCdlSectionsEditorComponent,
        SfContentFormComponent,
        SfCopyableComponent,
        SfPageHeaderComponent,
        SfSaveStatusComponent,
        SfSectionComponent,
        SfSkeletonComponent,
        SfTabsComponent,
        TranslocoPipe,
      ],
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const view = await render(GlobalSetDetailComponent, {
    componentInputs: { projectKey: 'proj', uuid: 'set-uuid', ...options.inputs },
    providers: [
      provideRouter([]),
      { provide: GlobalsService, useValue: globals },
      { provide: ApiClient, useValue: { evaluateRules: vi.fn().mockReturnValue(of({ findings: [], fills: [], fieldStates: [] })) } },
      { provide: TimeTravelStore, useValue: timeTravel },
      { provide: ConfirmService, useValue: confirm },
      { provide: HistoryDrawerStore, useValue: history },
      { provide: FrameContextStore, useValue: { setItem: vi.fn() } },
      { provide: DeveloperModeService, useValue: { enabled: signal(options.dev ?? true) } },
      { provide: EditingLocaleStore, useValue: { binding: signal(null) } },
      { provide: LocalesStore, useValue: { locales: signal([]) } },
      provideProjectPermissions({ role: () => role, readOnly: () => timeTravel.isTimeTravel() }),
    ],
  });
  await waitFor(() => expect(globals.get).toHaveBeenCalled());
  return { ...view, confirm, history, editors: TestBed.inject(ActiveEditorService), toasts: TestBed.inject(ToastService) };
}

const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

/** Edits the title value, which makes the values form dirty. */
async function editTitle(value = 'Acme Indoor'): Promise<void> {
  const input = await screen.findByLabelText(/Site title/);
  fireEvent.input(input, { target: { value } });
}

/** Edits the schema's Content tab. */
async function editSchema(content: string): Promise<void> {
  (await screen.findByRole('tab', { name: /^Schema/ })).click();
  const editor = await screen.findByRole('textbox', { name: /Content/ });
  typeCode(editor, content);
}

describe('GlobalSetDetailComponent', () => {
  it('loads the set and shows its name as the page heading, with the values form from the compiled definition', async () => {
    const globals = globalsStub();
    await setup(globals);

    expect(globals.get).toHaveBeenCalledWith('proj', 'set-uuid', null);
    expect(await screen.findByRole('heading', { level: 1, name: 'Site' })).toBeTruthy();
    expect(await screen.findByLabelText(/Site title/)).toBeTruthy();
  });

  it('shows the save status, and Save only enables with changes', async () => {
    await setup(globalsStub());
    await screen.findByLabelText(/Site title/);
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText(/^Saved/)).toBeTruthy();

    await editTitle();

    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('saves values with the If-Match built from the loaded revision, then shows Saved', async () => {
    const globals = globalsStub();
    await setup(globals, { role: 'EDITOR' });

    await editTitle();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    saveButton().click();

    await waitFor(() =>
      expect(globals.updateContent).toHaveBeenCalledWith('proj', 'set-uuid', { title: 'Acme Indoor', hours: [] }, '"rev-4"'),
    );
    expect(globals.updateSchema).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/^Saved/)).toBeTruthy());
  });

  /** M34: one Save writes a schema change and the values edited with it — one request, one revision. */
  it('saves schema and edited values together in one request', async () => {
    const globals = globalsStub();
    await setup(globals);

    await editTitle();
    await editSchema('editor text title { label "Site title" }\neditor text claim { label "Claim" }');
    saveButton().click();

    await waitFor(() =>
      expect(globals.updateSchema).toHaveBeenCalledWith(
        'proj',
        'set-uuid',
        { content: 'editor text title { label "Site title" }\neditor text claim { label "Claim" }', bodies: '', rules: '' },
        { title: 'Acme Indoor', hours: [] },
        '"rev-4"',
      ),
    );
    expect(globals.updateContent).not.toHaveBeenCalled();
  });

  it('saves through the frame (Ctrl+S) since the detail is a registered editor', async () => {
    const globals = globalsStub();
    const { editors } = await setup(globals, { role: 'EDITOR' });
    await editTitle();

    expect(editors.active()?.name()).toBe('Site');
    expect(editors.hasUnsaved()).toBe(true);
    await editors.saveActive();

    expect(globals.updateContent).toHaveBeenCalledTimes(1);
    expect(editors.hasUnsaved()).toBe(false);
  });

  describe('the unsaved guard', () => {
    it('asks before leaving with changes, and keeps the person on Cancel', async () => {
      const { editors } = await setup(globalsStub(), { role: 'EDITOR' });
      const dialog = vi.spyOn(TestBed.inject(UnsavedChangesService), 'confirmLeave').mockResolvedValue(false);
      await editTitle();

      expect(await editors.canLeave()).toBe(false);
      expect(dialog).toHaveBeenCalledWith(expect.objectContaining({ name: 'Site' }));
    });

    it('lets the person leave after Discard, which shows what is stored again', async () => {
      const { editors } = await setup(globalsStub(), { role: 'EDITOR' });
      vi.spyOn(TestBed.inject(UnsavedChangesService), 'confirmLeave').mockImplementation(async (options) => {
        await options.discard?.();
        return true;
      });
      await editTitle();

      expect(await editors.canLeave()).toBe(true);
      expect(editors.hasUnsaved()).toBe(false);
      await waitFor(() => expect((screen.getByLabelText(/Site title/) as HTMLInputElement).value).toBe('Acme Outdoor'));
    });

    it('does not ask without changes', async () => {
      const { editors } = await setup(globalsStub(), { role: 'EDITOR' });
      const dialog = vi.spyOn(TestBed.inject(UnsavedChangesService), 'confirmLeave');

      expect(await editors.canLeave()).toBe(true);
      expect(dialog).not.toHaveBeenCalled();
    });

    it('discards from the header menu', async () => {
      await setup(globalsStub(), { role: 'EDITOR' });
      await editTitle();
      await waitFor(() => expect(saveButton().disabled).toBe(false));

      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Discard changes' }));

      await waitFor(() => expect(saveButton().disabled).toBe(true));
      await waitFor(() => expect((screen.getByLabelText(/Site title/) as HTMLInputElement).value).toBe('Acme Outdoor'));
    });
  });

  describe('developer mode (decision 25)', () => {
    it('shows the Schema tab, the UID and the $CMS_VALUE usage chip', async () => {
      await setup(globalsStub(), { dev: true });

      expect(await screen.findByRole('tab', { name: /^Schema/ })).toBeTruthy();
      expect(screen.getAllByText('$CMS_VALUE(CMS_GLOBAL.site.title)$').length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Copy UID' })).toBeTruthy();
      // Lists are read with a loop.
      expect(screen.getByText('$CMS_FOR(item : CMS_GLOBAL.site.hours)$')).toBeTruthy();
    });

    it('hides all of it without developer mode, even for a developer', async () => {
      await setup(globalsStub(), { dev: false });
      await screen.findByLabelText(/Site title/);

      expect(screen.queryByRole('tab', { name: /^Schema/ })).toBeNull();
      expect(screen.queryByText(/CMS_GLOBAL/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Copy UID' })).toBeNull();
    });

    it('falls back to Values when the URL asks for the Schema tab outside developer mode', async () => {
      await setup(globalsStub(), { dev: false, inputs: { tab: 'schema' } });

      expect(await screen.findByLabelText(/Site title/)).toBeTruthy();
    });

    it('tells the parent which tab was chosen, for the URL', async () => {
      const onTab = vi.fn();
      await setup(globalsStub(), { inputs: {} }).then(({ fixture }) => fixture.componentInstance.tabChange.subscribe(onTab));

      (await screen.findByRole('tab', { name: /^Schema/ })).click();

      await waitFor(() => expect(onTab).toHaveBeenCalledWith('schema'));
    });
  });

  /**
   * The schema is a developer's to change. An editor sees it in developer mode — they need to read what the
   * fields mean — but every control on it is read-only, and the server returns 403 regardless.
   */
  it('keeps the schema read-only for an editor and leaves the values editable', async () => {
    await setup(globalsStub(), { role: 'EDITOR', dev: true });

    await editTitle();
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    (await screen.findByRole('tab', { name: /^Schema/ })).click();
    expect(await screen.findByText('You need the developer role to change this schema.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Delete…' })).toBeNull();
  });

  it('leaves everything read-only for a viewer', async () => {
    await setup(globalsStub(), { role: 'VIEWER' });

    await screen.findByLabelText(/Site title/);
    expect(screen.getByText('Read-only')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  /** A 409 means someone else wrote a newer version: reload rather than retry over their edit. */
  it('reloads the set after a 409 instead of retrying the save', async () => {
    const globals = globalsStub({
      updateContent: vi.fn().mockReturnValue(failing(new HttpErrorResponse({ status: 409, error: {} }))),
    });
    await setup(globals, { role: 'EDITOR' });

    await editTitle();
    await waitFor(() => saveButton().click());

    await waitFor(() => expect(globals.get).toHaveBeenCalledTimes(2));
    expect(globals.updateContent).toHaveBeenCalledTimes(1);
  });

  it('shows field-level messages and a Not saved status when a save is rejected with 422 issues', async () => {
    const globals = globalsStub({
      updateContent: vi.fn().mockReturnValue(
        failing(
          new HttpErrorResponse({
              status: 422,
              error: { issues: [{ path: 'title', code: 'type', message: 'Content must be an object.', severity: 'ERROR' }] },
            }),
        ),
      ),
    });
    const { editors } = await setup(globals, { role: 'EDITOR' });

    await editTitle();
    await waitFor(() => saveButton().click());

    await waitFor(() => expect(screen.getAllByText(/Content must be an object./).length).toBeGreaterThan(0));
    expect(screen.getByText(/Not saved/)).toBeTruthy();
    expect(editors.active()?.error()?.message).toBe('Some values are invalid — see the messages on the fields.');
  });

  it('shows CDL diagnostics on the failing tab when a schema save is rejected', async () => {
    const globals = globalsStub({
      updateSchema: vi.fn().mockReturnValue(
        failing(
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
    await setup(globals);

    await editSchema('editor catalog cards { }');
    screen.getByRole('tab', { name: /^Values/ }).click();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    saveButton().click();

    await waitFor(() => expect(globals.updateSchema).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/SF-CDL-0107/)).toBeTruthy());
    expect(screen.getByRole('tab', { name: /^Schema/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /^Rules/ }).getAttribute('aria-selected')).toBe('true');
  });

  /** Time travel is read-only for everyone, whatever their role, and reads the historical version. */
  it('is entirely read-only during time travel and loads the historical revision', async () => {
    const globals = globalsStub();
    await setup(globals, { revision: 3 });

    expect(globals.get).toHaveBeenCalledWith('proj', 'set-uuid', 3);
    expect(await screen.findByText('Viewing revision 3')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  describe('delete', () => {
    it('asks first, then deletes and tells the parent for the Undo; unsaved edits do not hold the area back', async () => {
      const globals = globalsStub();
      const { confirm, editors, fixture } = await setup(globals);
      const deleted = vi.fn();
      fixture.componentInstance.deleted.subscribe(deleted);
      await editTitle();

      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));

      await waitFor(() => expect(globals.delete).toHaveBeenCalledWith('proj', 'set-uuid'));
      expect(confirm.confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }));
      expect(deleted).toHaveBeenCalledWith({ uuid: 'set-uuid', name: 'Site', online: false });
      expect(editors.hasUnsaved()).toBe(false);
    });

    it('does nothing when the question is declined', async () => {
      const globals = globalsStub();
      const { confirm } = await setup(globals, { confirm: false });

      fireEvent.click(await screen.findByRole('button', { name: 'More actions' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));

      await waitFor(() => expect(confirm.confirm).toHaveBeenCalled());
      expect(globals.delete).not.toHaveBeenCalled();
    });

    it('opens the history drawer from the header menu', async () => {
      const { history } = await setup(globalsStub());

      fireEvent.click(await screen.findByRole('button', { name: 'More actions' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'History' }));

      expect(history.toggle).toHaveBeenCalled();
    });
  });
});
