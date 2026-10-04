import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { AuthStore } from '../../core/auth/auth.store';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { codeOf, codeView, typeCode } from '../../shared/code-editor/code-editor.testing';
import { ChannelsService } from '../channels/channels.service';
import { ContentService, etagFor, type DatasetDetailView } from '../content/content.service';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { DatasetEditorComponent } from './dataset-editor.component';
import { TemplatesItemActions } from './templates-item-actions.service';
import { TemplatesStoreRefresh } from './templates-store-refresh.service';
import { TemplatesStore } from './templates.store';
import { TemplatesService } from './templates.service';

/** The dataset's Content section (M34): the editors, without `content { … }`. */
const CDL = `editor text name { label "Name" required }
editor text role { label "Role" }
`;

const RULES = 'state name { requiredWhen "true" }';
const HTML_TEMPLATE = '<li>\n  $CMS_VALUE(name)$\n</li>';

// `compiledDefinition` / `channelTemplates` are `JsonNode` on the server (`Record<string, never>` in the types).
const DATASET = {
  uuid: 'ds-team',
  uid: 'team',
  displayName: 'Team',
  description: '',
  contentCdl: CDL,
  rulesCdl: RULES,
  compiledDefinition: {
    editors: [
      { name: 'name', type: 'TEXT', label: 'Name', required: true, localizable: true },
      { name: 'role', type: 'TEXT', label: 'Role' },
    ],
    bodies: [],
  },
  channelTemplates: { html: { source: HTML_TEMPLATE, compiledHash: 'h1' }, rss: { source: '<item/>', compiledHash: 'h2' } },
  recordCount: 3,
  revision: 7,
  folderUuid: 'folder-datasets',
  folderPath: '/datasets',
} as unknown as DatasetDetailView;

const CHANNELS = [
  { key: 'html', name: 'HTML', enabled: true, position: 0 },
  { key: 'md', name: 'Markdown', enabled: true, position: 1, settings: { highlightAs: 'PLAIN' } },
  { key: 'rss', name: 'RSS', enabled: false, position: 2 },
];

const USAGES = [
  { fromUuid: 'set-leads', fromUid: 'leads', fromType: 'RECORD_SET', kind: 'DATASET', sourcePath: 'dataset' },
  { fromUuid: 'tpl-article', fromUid: 'article', fromType: 'PAGE_TEMPLATE', kind: 'LOOP', sourcePath: 'channels.html' },
];

function contentStub() {
  return {
    getDataset: vi.fn().mockReturnValue(of(DATASET)),
    updateDataset: vi.fn(),
    validateCdl: vi.fn().mockReturnValue(of({ diagnostics: [] })),
    deleteDataset: vi.fn(),
  };
}

function templatesStub() {
  return { validateOctl: vi.fn().mockReturnValue(of({ diagnostics: [] })) };
}

function actionsStub(confirm: ReturnType<typeof vi.fn>) {
  return {
    usages: vi.fn().mockReturnValue(of(USAGES)),
    confirmDelete: confirm,
    duplicate: vi.fn().mockResolvedValue('ds-copy'),
    rename: vi.fn().mockReturnValue(of({ revision: 8 })),
  };
}

async function setup(options: { role?: string; revision?: number; confirm?: ReturnType<typeof vi.fn> } = {}) {
  const content = contentStub();
  const templates = templatesStub();
  const actions = actionsStub(options.confirm ?? vi.fn().mockResolvedValue(true));
  const area = { usedByUuid: signal<string | null>(null) };
  const refresh = { notify: vi.fn() };
  const timeTravel = new TimeTravelStore();
  if (options.revision != null) {
    timeTravel.enter(options.revision);
  }
  const view = await render(DatasetEditorComponent, {
    componentInputs: { projectKey: 'proj', uuid: 'ds-team' },
    providers: [
      provideRouter([]),
      { provide: ContentService, useValue: content },
      { provide: TemplatesService, useValue: templates },
      { provide: ChannelsService, useValue: { list: vi.fn().mockReturnValue(of(CHANNELS)) } },
      { provide: ApiClient, useValue: {} },
      { provide: TemplatesItemActions, useValue: actions },
      { provide: TemplatesStore, useValue: area },
      { provide: TemplatesStoreRefresh, useValue: refresh },
      { provide: ProjectContextStore, useValue: { project: () => ({ key: 'acme', codeHighlighting: {} }) } },
      { provide: AuthStore, useValue: { roleFor: () => options.role ?? 'DEVELOPER', isArchived: () => false } },
      { provide: TimeTravelStore, useValue: timeTravel },
      provideProjectPermissions({ role: () => options.role ?? 'DEVELOPER', readOnly: () => timeTravel.isTimeTravel() }),
    ],
  });
  // Part of the application's view tree, as in the app: after-render hooks then run after this view rendered.
  TestBed.inject(ApplicationRef).attachView(view.fixture.componentRef.hostView);
  await screen.findByRole('tab', { name: /^Schema/ });
  return { ...view, content, templates, actions, area, refresh };
}

function tabNames(): string[] {
  return screen.getAllByRole('tab').map((tab) => (tab.textContent ?? '').replace(/\s+/g, ' ').trim());
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Save dataset' }) as HTMLButtonElement;
}

async function openTab(name: RegExp): Promise<void> {
  fireEvent.click(screen.getByRole('tab', { name }));
  await waitFor(() => expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true'));
}

function cdlEditor(section = 'Content'): HTMLElement {
  return screen.getByRole('textbox', { name: `Record fields (CDL) — ${section}` });
}

function editor(channel: string): HTMLElement {
  return screen.getByRole('textbox', { name: `Record template for channel ${channel}` });
}

async function choose(item: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
}

describe('DatasetEditorComponent — overview (M35.21 C)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('has a header with the name and the Dataset badge, and the Overview tab first', async () => {
    await setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Team' })).toBeTruthy();
    expect(screen.getByText('Dataset')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Overview/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('lists the fields of the schema with type, required, localized and rule count', async () => {
    await setup();
    const table = await screen.findByRole('grid', { name: 'Fields of Team' });
    const rows = within(table).getAllByRole('row');
    const text = rows.map((row) => (row.textContent ?? '').replace(/\s+/g, ' '));
    expect(text.some((row) => row.includes('Name') && row.includes('name') && row.includes('text'))).toBe(true);
    expect(text.some((row) => row.includes('Role'))).toBe(true);
  });

  it('lists what uses the dataset, each linking to its screen', async () => {
    const { actions } = await setup();
    expect(actions.usages).toHaveBeenCalledWith('proj', 'ds-team');
    const leads = (await screen.findByRole('link', { name: 'leads' })) as HTMLAnchorElement;
    expect(leads.getAttribute('href')).toContain('/p/proj/content');
    expect(leads.getAttribute('href')).toContain('set-leads');
    expect((screen.getByRole('link', { name: 'article' }) as HTMLAnchorElement).getAttribute('href')).toContain('tpl-article');
    expect(screen.getByText('3 records')).toBeTruthy();
  });

  it('offers the title field and description, and saves their change', async () => {
    const { content } = await setup();
    const description = screen.getByRole('textbox', { name: /Description/ });
    fireEvent.input(description, { target: { value: 'The team' } });
    fireEvent.change(screen.getByRole('combobox', { name: /Title field/ }), { target: { value: 'role' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    content.updateDataset.mockReturnValue(of({ ...DATASET, revision: 8, description: 'The team', titleEditor: 'role' }));
    fireEvent.click(saveButton());
    const [, , body] = content.updateDataset.mock.calls[0];
    expect(body).toMatchObject({ description: 'The team', titleEditor: 'role', displayName: 'Team' });
  });
});

describe('DatasetEditorComponent — schema, rules and record templates (M25.5.2)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows Overview, Schema and Rules beside one record template tab per enabled channel, plus a disabled one holding a template', async () => {
    await setup();
    expect(tabNames()).toEqual(['Overview', 'Schema', 'Rules', 'html', 'md', 'rss disabled']);

    await openTab(/^Schema/);
    expect(codeOf(cdlEditor())).toBe(CDL);
    await openTab(/^Rules/);
    expect(codeOf(cdlEditor('Rules'))).toBe(RULES);

    await openTab(/^html/);
    expect(codeOf(editor('html'))).toBe(HTML_TEMPLATE);
    // Highlighted as the channel's format (M33 follow-up): detected from the key, or the channel's own choice.
    const formatIn = (channel: string) => editor(channel).closest('[role="tabpanel"]')?.querySelector('[data-format]')?.getAttribute('data-format');
    expect(formatIn('html')).toBe('HTML');
    await openTab(/^md/);
    expect(formatIn('md')).toBe('PLAIN');

    await openTab(/^rss/);
    expect(screen.getByText(/channel is disabled/)).toBeTruthy();
  });

  it('explains a channel without a template: record sets render nothing there', async () => {
    await setup();
    await openTab(/^md/);
    expect(screen.getByText('No record template for md')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('$CMS_VALUE(recordset:…)$');
    expect(codeOf(editor('md'))).toBe('');
  });

  it('tracks dirty state across the schema and the templates, and saves both in one request', async () => {
    const { content } = await setup();
    expect(saveButton().disabled).toBe(true);

    await openTab(/^md/);
    typeCode(editor('md'), '- $CMS_VALUE(name)$');
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(screen.getByRole('tab', { name: /^md/ }).textContent).toContain('(unsaved)');

    // Back to its stored (empty) state: nothing to save again.
    typeCode(editor('md'), '  ');
    await waitFor(() => expect(saveButton().disabled).toBe(true));

    typeCode(editor('md'), '- $CMS_VALUE(name)$');
    await openTab(/^Schema/);
    typeCode(cdlEditor(), CDL.replace('role', 'title'));
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Schema/ }).textContent).toContain('(unsaved)'));
    await openTab(/^Rules/);
    typeCode(cdlEditor('Rules'), 'state title requiredWhen "true"');
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Rules/ }).textContent).toContain('(unsaved)'));

    content.updateDataset.mockReturnValue(
      of({
        ...DATASET,
        revision: 8,
        contentCdl: CDL.replace('role', 'title'),
        rulesCdl: 'state title requiredWhen "true"',
        channelTemplates: { html: { source: HTML_TEMPLATE }, md: { source: '- $CMS_VALUE(name)$' }, rss: { source: '<item/>' } },
        recordTemplateDiagnostics: {},
        brokenRecordSets: [],
      }),
    );
    fireEvent.click(saveButton());

    expect(content.updateDataset).toHaveBeenCalledTimes(1);
    const [, , body, etag] = content.updateDataset.mock.calls[0];
    expect(body).toMatchObject({
      contentCdl: CDL.replace('role', 'title'),
      rulesCdl: 'state title requiredWhen "true"',
      channelTemplates: { html: HTML_TEMPLATE, md: '- $CMS_VALUE(name)$', rss: '<item/>' },
    });
    expect(etag).toBe(etagFor(7));
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(tabNames().some((name) => name.includes('(unsaved)'))).toBe(false);
  });

  it('registers as the active editor: unsaved edits are known to the frame and Ctrl+S saves', async () => {
    const { content } = await setup();
    const editors = TestBed.inject(ActiveEditorService);
    expect(editors.hasUnsaved()).toBe(false);
    await openTab(/^Schema/);
    typeCode(cdlEditor(), CDL + 'editor text extra { label "Extra" }\n');
    await waitFor(() => expect(editors.hasUnsaved()).toBe(true));
    content.updateDataset.mockReturnValue(of({ ...DATASET, revision: 8, contentCdl: CDL + 'editor text extra { label "Extra" }\n' }));
    await editors.saveActive();
    expect(content.updateDataset).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(editors.hasUnsaved()).toBe(false));
  });

  it('keeps the edited template after a rejected save and shows the diagnostic at its line', async () => {
    const { content } = await setup();
    await openTab(/^html/);
    const broken = '<li>\n  $CMS_VALUE(nme)$\n</li>';
    typeCode(editor('html'), broken);
    const diagnostic = { severity: 'ERROR', code: 'SF-TPL-0103', message: 'Unknown editor name: nme', line: 2, column: 14 };
    content.updateDataset.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 422,
            error: { code: 'SF-API-0422', channel: 'html', diagnostics: [diagnostic], channelDiagnostics: { html: [diagnostic] } },
          }),
      ),
    );

    // Save with another channel open: the failing channel's tab opens.
    await openTab(/^md/);
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());

    const area = await screen.findByRole('textbox', { name: 'Record template for channel html' });
    expect(codeOf(area)).toBe(broken);
    expect(screen.getByText(/SF-TPL-0103/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^html/ }).textContent).toMatch(/1\s*error/);
    // The caret moves once the tab switch has rendered (an after-render hook of the application tick).
    await waitFor(() => expect(codeView(area).state.selection.main.head).toBe(broken.indexOf('nme')));
    expect(document.activeElement).toBe(area);
    // Still unsaved: the rejected edit can be fixed and saved again, and the header says it was refused.
    expect(saveButton().disabled).toBe(false);
    expect(screen.getByText(/Not saved/)).toBeTruthy();
  });

  it('shows schema errors of a rejected save on the failing CDL tab, not in a template tab', async () => {
    const { content } = await setup();
    await openTab(/^html/);
    typeCode(editor('html'), '<p/>');
    // Save enables once the edit has rendered; a real click can't hit it earlier.
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    content.updateDataset.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 422,
            error: {
              diagnostics: [{ severity: 'ERROR', code: 'SF-CDL-0001', message: 'Syntax', line: 1, column: 1, field: 'rules' }],
            },
          }),
      ),
    );
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Rules/ }).getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByRole('tab', { name: /^Rules/ }).textContent).toMatch(/1\s*error/);
    expect(screen.getByText(/SF-CDL-0001/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^html/ }).textContent).not.toMatch(/error/);
  });

  it('lists the record sets a save broke, each linking to its set, and shows template warnings', async () => {
    const { content } = await setup();
    await openTab(/^html/);
    typeCode(editor('html'), '<li>$CMS_VALUE(role)$</li>');
    // Save enables once the edit has rendered; a real click can't hit it earlier.
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    content.updateDataset.mockReturnValue(
      of({
        ...DATASET,
        revision: 8,
        channelTemplates: { html: { source: '<li>$CMS_VALUE(role)$</li>' }, rss: { source: '<item/>' } },
        recordTemplateDiagnostics: {
          html: [{ severity: 'WARNING', code: 'SF-TPL-0301', message: 'Unescaped value', line: 1, column: 5 }],
        },
        brokenRecordSets: [
          {
            uuid: 'set-leads',
            uid: 'leads',
            displayName: 'Leads',
            diagnostics: [{ field: 'where', severity: 'ERROR', code: 'SF-TPL-0140', message: 'Unknown field: role' }],
          },
        ],
      }),
    );
    fireEvent.click(saveButton());

    const link = (await screen.findByRole('link', { name: 'Leads' })) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/p/proj/content/sets/set-leads');
    expect(screen.getByText('where: Unknown field: role')).toBeTruthy();
    expect(screen.getByText(/SF-TPL-0301/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Leads' })).toBeNull());
  });

  it('inserts fields of the schema as edited and the meta names at the caret', async () => {
    await setup();
    await openTab(/^md/);
    fireEvent.click(screen.getByRole('button', { name: 'role' }));
    await waitFor(() => expect(codeOf(editor('md'))).toBe('$CMS_VALUE(role)$'));
    fireEvent.click(screen.getByRole('button', { name: '_first' }));
    await waitFor(() => expect(codeOf(editor('md'))).toBe('$CMS_VALUE(role)$$CMS_IF(_first)$$CMS_END_IF$'));
    for (const meta of ['_uid', '_displayName', '_index', '_last', '_count']) {
      expect(screen.getByRole('button', { name: meta })).toBeTruthy();
    }
  });

  it('checks the schema live while typing and lists its diagnostics on the tab', async () => {
    vi.useFakeTimers();
    try {
      const { content, fixture } = await setup();
      fireEvent.click(screen.getByRole('tab', { name: /^Schema/ }));
      fixture.detectChanges();
      content.validateCdl.mockReturnValue(
        of({ diagnostics: [{ severity: 'ERROR', code: 'SF-CDL-0007', message: 'Bad editor', line: 1, column: 1, field: 'content' }] }),
      );
      typeCode(cdlEditor(), 'editor nope');
      vi.advanceTimersByTime(450);
      fixture.detectChanges();
      expect(content.validateCdl).toHaveBeenCalledWith('proj', { content: 'editor nope', bodies: '', rules: RULES });
      expect(screen.getByText(/SF-CDL-0007/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('checks the open template live, per channel', async () => {
    vi.useFakeTimers();
    try {
      const { templates, fixture } = await setup();
      fireEvent.click(screen.getByRole('tab', { name: /^md/ }));
      fixture.detectChanges();
      templates.validateOctl.mockReturnValue(
        of({ diagnostics: [{ severity: 'ERROR', code: 'SF-TPL-0001', message: 'Unclosed', line: 1, column: 1 }] }),
      );
      typeCode(editor('md'), '$CMS_IF(x)$');
      vi.advanceTimersByTime(350);
      fixture.detectChanges();
      expect(templates.validateOctl).toHaveBeenCalledWith('proj', {
        source: '$CMS_IF(x)$',
        channelKey: 'md',
        datasetUuid: 'ds-team',
        contentCdl: CDL,
        rulesCdl: RULES,
      });
      expect(screen.getByText(/SF-TPL-0001/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  /** The live check knows the dataset: fields are checked against the CDL being edited, not only on save. */
  it('checks fields against the schema as edited and re-checks a template when its tab opens again', async () => {
    vi.useFakeTimers();
    try {
      const { templates, fixture } = await setup();
      const unknownSquad = {
        diagnostics: [{ severity: 'ERROR', code: 'SF-TPL-0103', message: 'Unknown editor: squad', line: 1, column: 1 }],
      };
      templates.validateOctl.mockReturnValue(of(unknownSquad));
      fireEvent.click(screen.getByRole('tab', { name: /^html/ }));
      fixture.detectChanges();
      typeCode(editor('html'), '$CMS_VALUE(squad)$');
      vi.advanceTimersByTime(350);
      fixture.detectChanges();
      expect(screen.getByText(/Unknown editor: squad/)).toBeTruthy();

      // Declare the field, then come back to the template: it is checked against the new CDL.
      const withSquad = `editor text squad { label "Squad" }\n${CDL}`;
      fireEvent.click(screen.getByRole('tab', { name: /^Schema/ }));
      fixture.detectChanges();
      typeCode(cdlEditor(), withSquad);
      templates.validateOctl.mockReturnValue(of({ diagnostics: [] }));
      fireEvent.click(screen.getByRole('tab', { name: /^html/ }));
      vi.advanceTimersByTime(350);
      fixture.detectChanges();

      expect(templates.validateOctl).toHaveBeenLastCalledWith('proj', {
        source: '$CMS_VALUE(squad)$',
        channelKey: 'html',
        datasetUuid: 'ds-team',
        contentCdl: withSquad,
        rulesCdl: RULES,
      });
      expect(screen.queryByText(/Unknown editor: squad/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is read-only for an editor: templates shown but not editable, no helpers, no save', async () => {
    const { templates } = await setup({ role: 'EDITOR' });
    expect(screen.getByText(/Only a developer can change/)).toBeTruthy();
    await openTab(/^html/);
    expect(codeView(editor('html')).state.readOnly).toBe(true);
    expect(screen.queryByRole('group', { name: /Insert/ })).toBeNull();
    expect(saveButton().disabled).toBe(true);

    // A channel without a template shows only the explanation.
    await openTab(/^md/);
    expect(screen.getByText('No record template for md')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Record template for channel md' })).toBeNull();
    expect(templates.validateOctl).not.toHaveBeenCalled();
  });

  it('is read-only in time travel and reads the dataset at the revision', async () => {
    const { content } = await setup({ revision: 4 });
    expect(content.getDataset).toHaveBeenCalledWith('proj', 'ds-team', 4);
    await openTab(/^html/);
    expect(codeView(editor('html')).state.readOnly).toBe(true);
    expect(screen.queryByRole('group', { name: /Insert/ })).toBeNull();
    expect(saveButton().disabled).toBe(true);
  });
});

describe('DatasetEditorComponent — the ⋮ menu (M35.13, M35.21)', () => {
  it('confirms with the templates delete question, deletes, and hands the deleted dataset to the screen (which offers Undo)', async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const { content, fixture } = await setup({ confirm });
    content.deleteDataset.mockReturnValue(of(undefined));
    // Only an empty dataset can be deleted.
    content.getDataset.mockReturnValue(of({ ...DATASET, recordCount: 0 }));
    fixture.componentRef.setInput('uuid', 'ds-other');
    fixture.componentRef.setInput('uuid', 'ds-team');
    fixture.detectChanges();
    const deleted: unknown[] = [];
    fixture.componentInstance.deleted.subscribe((d: unknown) => deleted.push(d));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Team' })).toBeTruthy());

    await choose('Delete');

    await waitFor(() => expect(content.deleteDataset).toHaveBeenCalledWith('proj', 'ds-team'));
    expect(confirm.mock.calls[0][1][0]).toMatchObject({ kind: 'dataset', uuid: 'ds-team', name: 'Team' });
    expect(deleted).toEqual([{ uuid: 'ds-team', name: 'Team' }]);
  });

  it('does not delete when the confirmation is declined', async () => {
    const { content, fixture } = await setup({ confirm: vi.fn().mockResolvedValue(false) });
    content.getDataset.mockReturnValue(of({ ...DATASET, recordCount: 0 }));
    fixture.componentRef.setInput('uuid', 'ds-other');
    fixture.componentRef.setInput('uuid', 'ds-team');
    fixture.detectChanges();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Team' })).toBeTruthy());

    await choose('Delete');

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Team' })).toBeTruthy());
    expect(content.deleteDataset).not.toHaveBeenCalled();
  });

  it('cannot delete while records exist', async () => {
    const { content, actions } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const item = await screen.findByRole('menuitem', { name: /Delete/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(item);
    expect(actions.confirmDelete).not.toHaveBeenCalled();
    expect(content.deleteDataset).not.toHaveBeenCalled();
  });

  it('opens Used by in the area, and duplicates next to the original', async () => {
    const { area, actions, refresh } = await setup();
    await choose('Used by');
    expect(area.usedByUuid()).toBe('ds-team');

    await choose('Duplicate');
    await waitFor(() => expect(actions.duplicate).toHaveBeenCalled());
    const [key, entry, folder, changed] = actions.duplicate.mock.calls[0];
    expect(key).toBe('proj');
    expect(entry).toMatchObject({ uuid: 'ds-team', kind: 'dataset' });
    expect(folder).toBe('folder-datasets');
    changed();
    expect(refresh.notify).toHaveBeenCalled();
  });

  it('disables Rename, Duplicate and Delete for an editor but keeps Used by', async () => {
    await setup({ role: 'EDITOR' });
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    for (const name of [/Rename/, /Duplicate/, /Delete/]) {
      expect((await screen.findByRole('menuitem', { name })).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.getByRole('menuitem', { name: /Used by/ }).getAttribute('aria-disabled')).not.toBe('true');
  });
});
