import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { AuthStore } from '../../core/auth/auth.store';
import { ChannelsService } from '../channels/channels.service';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { TemplatesService } from '../templates/templates.service';
import { ContentService, etagFor, type DatasetDetailView } from './content.service';
import { DatasetSchemaEditorComponent } from './dataset-schema-editor.component';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { codeOf, codeView, typeCode } from '../../shared/code-editor/code-editor.testing';

const CDL = `content {
  editor text name { label "Name" required }
  editor text role { label "Role" }
}
`;

const HTML_TEMPLATE = '<li>\n  $CMS_VALUE(name)$\n</li>';

// `compiledDefinition` / `channelTemplates` are `JsonNode` on the server (`Record<string, never>` in the types).
const DATASET = {
  uuid: 'ds-team',
  uid: 'team',
  displayName: 'Team',
  description: '',
  contentDefinition: CDL,
  compiledDefinition: {
    editors: [
      { name: 'name', type: 'TEXT', label: 'Name' },
      { name: 'role', type: 'TEXT', label: 'Role' },
    ],
    bodies: [],
  },
  channelTemplates: { html: { source: HTML_TEMPLATE, compiledHash: 'h1' }, rss: { source: '<item/>', compiledHash: 'h2' } },
  recordCount: 3,
  revision: 7,
} as unknown as DatasetDetailView;

const CHANNELS = [
  { key: 'html', name: 'HTML', enabled: true, position: 0 },
  { key: 'md', name: 'Markdown', enabled: true, position: 1 },
  { key: 'rss', name: 'RSS', enabled: false, position: 2 },
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

async function setup(options: { role?: string; revision?: number } = {}) {
  const content = contentStub();
  const templates = templatesStub();
  const timeTravel = new TimeTravelStore();
  if (options.revision != null) {
    timeTravel.enter(options.revision);
  }
  const view = await render(DatasetSchemaEditorComponent, {
    componentInputs: { projectKey: 'proj', uuid: 'ds-team' },
    providers: [
      provideRouter([]),
      { provide: ContentService, useValue: content },
      { provide: TemplatesService, useValue: templates },
      { provide: ChannelsService, useValue: { list: vi.fn().mockReturnValue(of(CHANNELS)) } },
      { provide: ApiClient, useValue: {} },
      { provide: AuthStore, useValue: { roleFor: () => options.role ?? 'DEVELOPER', isArchived: () => false } },
      { provide: TimeTravelStore, useValue: timeTravel },
      provideProjectPermissions({ role: () => options.role ?? 'DEVELOPER', readOnly: () => timeTravel.isTimeTravel() }),
    ],
  });
  // Part of the application's view tree, as in the app: after-render hooks then run after this view rendered.
  TestBed.inject(ApplicationRef).attachView(view.fixture.componentRef.hostView);
  await screen.findByRole('tab', { name: /Schema \(CDL\)/ });
  return { ...view, content, templates };
}

function tabNames(): string[] {
  return screen.getAllByRole('tab').map((tab) => (tab.textContent ?? '').replace(/\s+/g, ' ').trim());
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Save dataset' }) as HTMLButtonElement;
}

async function openTab(name: RegExp): Promise<void> {
  fireEvent.click(screen.getByRole('tab', { name }));
  await screen.findByRole('tabpanel', { name: /Record template/ });
}

function editor(channel: string): HTMLElement {
  return screen.getByRole('textbox', { name: `Record template for channel ${channel}` });
}

describe('DatasetSchemaEditorComponent — record templates (M25.5.2)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the schema tab and one record template tab per enabled channel, plus a disabled one holding a template', async () => {
    await setup();
    expect(tabNames()).toEqual([
      'Schema (CDL)',
      'Record template (html)',
      'Record template (md)',
      'Record template (rss) disabled',
    ]);
    expect(screen.getByRole('tab', { name: /Schema/ }).getAttribute('aria-selected')).toBe('true');

    await openTab(/Record template \(html\)/);
    expect(codeOf(editor('html'))).toBe(HTML_TEMPLATE);
    expect(screen.getByRole('tab', { name: /Record template \(html\)/ }).getAttribute('aria-selected')).toBe('true');

    await openTab(/Record template \(rss\)/);
    expect(screen.getByText(/channel is disabled/)).toBeTruthy();
  });

  it('explains a channel without a template: record sets render nothing there', async () => {
    await setup();
    await openTab(/Record template \(md\)/);
    expect(screen.getByText('No record template for md')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('$CMS_VALUE(recordset:…)$');
    expect(codeOf(editor('md'))).toBe('');
  });

  it('tracks dirty state across the schema and the templates, and saves both in one request', async () => {
    const { content } = await setup();
    expect(saveButton().disabled).toBe(true);

    await openTab(/Record template \(md\)/);
    typeCode(editor('md'), '- $CMS_VALUE(name)$');
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(screen.getByRole('tab', { name: /Record template \(md\)/ }).textContent).toContain('(unsaved)');

    // Back to its stored (empty) state: nothing to save again.
    typeCode(editor('md'), '  ');
    await waitFor(() => expect(saveButton().disabled).toBe(true));

    typeCode(editor('md'), '- $CMS_VALUE(name)$');
    fireEvent.click(screen.getByRole('tab', { name: /Schema/ }));
    const cdl = await screen.findByRole('textbox', { name: /Record fields/ });
    typeCode(cdl, CDL.replace('role', 'title'));
    await waitFor(() => expect(screen.getByRole('tab', { name: /Schema/ }).textContent).toContain('(unsaved)'));

    content.updateDataset.mockReturnValue(
      of({
        ...DATASET,
        revision: 8,
        contentDefinition: CDL.replace('role', 'title'),
        channelTemplates: { html: { source: HTML_TEMPLATE }, md: { source: '- $CMS_VALUE(name)$' }, rss: { source: '<item/>' } },
        recordTemplateDiagnostics: {},
        brokenRecordSets: [],
      }),
    );
    fireEvent.click(saveButton());

    expect(content.updateDataset).toHaveBeenCalledTimes(1);
    const [, , body, etag] = content.updateDataset.mock.calls[0];
    expect(body).toMatchObject({
      contentDefinition: CDL.replace('role', 'title'),
      channelTemplates: { html: HTML_TEMPLATE, md: '- $CMS_VALUE(name)$', rss: '<item/>' },
    });
    expect(etag).toBe(etagFor(7));
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(tabNames().some((name) => name.includes('(unsaved)'))).toBe(false);
  });

  it('keeps the edited template after a rejected save and shows the diagnostic at its line', async () => {
    const { content } = await setup();
    await openTab(/Record template \(html\)/);
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

    // Save from the schema tab: the failing channel's tab opens.
    fireEvent.click(screen.getByRole('tab', { name: /Schema/ }));
    fireEvent.click(saveButton());

    const area = await screen.findByRole('textbox', { name: 'Record template for channel html' });
    expect(codeOf(area)).toBe(broken);
    expect(screen.getByText(/SF-TPL-0103/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to line 2, column 14' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Record template \(html\)/ }).textContent).toMatch(/1\s*errors/);
    // The caret moves once the tab switch has rendered (an after-render hook of the application tick).
    await waitFor(() => expect(codeView(area).state.selection.main.head).toBe(broken.indexOf('nme')));
    expect(document.activeElement).toBe(area);
    // Still unsaved: the rejected edit can be fixed and saved again.
    expect(saveButton().disabled).toBe(false);
  });

  it('shows schema errors of a rejected save under the CDL, not in a template tab', async () => {
    const { content } = await setup();
    await openTab(/Record template \(html\)/);
    typeCode(editor('html'), '<p/>');
    content.updateDataset.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 422,
            error: { diagnostics: [{ severity: 'ERROR', code: 'SF-CDL-0001', message: 'Syntax', line: 1, column: 1 }] },
          }),
      ),
    );
    fireEvent.click(saveButton());
    await screen.findByRole('textbox', { name: /Record fields/ });
    expect(screen.getByText(/SF-CDL-0001/)).toBeTruthy();
  });

  it('lists the record sets a save broke, each linking to its set, and shows template warnings', async () => {
    const { content } = await setup();
    await openTab(/Record template \(html\)/);
    typeCode(editor('html'), '<li>$CMS_VALUE(role)$</li>');
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
    await openTab(/Record template \(md\)/);
    fireEvent.click(screen.getByRole('button', { name: 'role' }));
    await waitFor(() => expect(codeOf(editor('md'))).toBe('$CMS_VALUE(role)$'));
    fireEvent.click(screen.getByRole('button', { name: '_first' }));
    await waitFor(() => expect(codeOf(editor('md'))).toBe('$CMS_VALUE(role)$$CMS_IF(_first)$$CMS_END_IF$'));
    for (const meta of ['_uid', '_displayName', '_index', '_last', '_count']) {
      expect(screen.getByRole('button', { name: meta })).toBeTruthy();
    }
  });

  it('checks the open template live, per channel', async () => {
    vi.useFakeTimers();
    try {
      const { templates, fixture } = await setup();
      fireEvent.click(screen.getByRole('tab', { name: /Record template \(md\)/ }));
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
        contentDefinition: CDL,
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
      fireEvent.click(screen.getByRole('tab', { name: /Record template \(html\)/ }));
      fixture.detectChanges();
      typeCode(editor('html'), '$CMS_VALUE(squad)$');
      vi.advanceTimersByTime(350);
      fixture.detectChanges();
      expect(screen.getByText(/Unknown editor: squad/)).toBeTruthy();

      // Declare the field on the schema tab, then come back: the template is checked against the new CDL.
      const withSquad = CDL.replace('content {', 'content {\n  editor text squad { label "Squad" }');
      fireEvent.click(screen.getByRole('tab', { name: /Schema \(CDL\)/ }));
      fixture.detectChanges();
      typeCode(screen.getByLabelText(/Record fields \(CDL\)/), withSquad);
      templates.validateOctl.mockReturnValue(of({ diagnostics: [] }));
      fireEvent.click(screen.getByRole('tab', { name: /Record template \(html\)/ }));
      vi.advanceTimersByTime(350);
      fixture.detectChanges();

      expect(templates.validateOctl).toHaveBeenLastCalledWith('proj', {
        source: '$CMS_VALUE(squad)$',
        channelKey: 'html',
        datasetUuid: 'ds-team',
        contentDefinition: withSquad,
      });
      expect(screen.queryByText(/Unknown editor: squad/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is read-only for an editor: templates shown but not editable, no helpers, no save', async () => {
    const { templates } = await setup({ role: 'EDITOR' });
    expect(screen.getByText(/Only a developer can change/)).toBeTruthy();
    await openTab(/Record template \(html\)/);
    expect(codeView(editor('html')).state.readOnly).toBe(true);
    expect(screen.queryByRole('group', { name: /Insert/ })).toBeNull();
    expect(saveButton().disabled).toBe(true);

    // A channel without a template shows only the explanation.
    await openTab(/Record template \(md\)/);
    expect(screen.getByText('No record template for md')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Record template for channel md' })).toBeNull();
    expect(templates.validateOctl).not.toHaveBeenCalled();
  });

  it('is read-only in time travel and reads the dataset at the revision', async () => {
    const { content } = await setup({ revision: 4 });
    expect(content.getDataset).toHaveBeenCalledWith('proj', 'ds-team', 4);
    await openTab(/Record template \(html\)/);
    expect(codeView(editor('html')).state.readOnly).toBe(true);
    expect(screen.queryByRole('group', { name: /Insert/ })).toBeNull();
    expect(saveButton().disabled).toBe(true);
  });
});
