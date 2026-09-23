import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentService, type DatasetDetailView, type RecordSetDetailView } from './content.service';
import { RecordSetQueryPanelComponent } from './record-set-query-panel.component';

const SET: RecordSetDetailView = {
  uuid: 'set-uuid',
  uid: 'leads',
  displayName: 'Leads',
  dataset: { uuid: 'ds-team', uid: 'team', displayName: 'Team' },
  query: { where: "role == 'lead'", sort: '-joined' },
  queryValid: true,
  queryDiagnostics: [],
  recordCount: 12,
  revision: 5,
};

// `compiledDefinition` is `JsonNode` on the server (`Record<string, never>` in the generated types).
const DATASET = {
  uuid: 'ds-team',
  uid: 'team',
  displayName: 'Team',
  compiledDefinition: {
    editors: [
      { name: 'name', type: 'TEXT', label: 'Name field' },
      { name: 'role', type: 'SELECT', label: 'Role' },
      { name: 'joined', type: 'DATE', label: 'Joined' },
    ],
    bodies: [],
  },
} as unknown as DatasetDetailView;

function contentStub(overrides: Record<string, unknown> = {}) {
  return {
    previewSetQuery: vi.fn().mockReturnValue(of({ valid: true, diagnostics: [], matchCount: 4, selectedCount: 4 })),
    updateRecordSet: vi.fn().mockImplementation((_k: string, _u: string, req: { query: unknown }) =>
      of({ ...SET, query: req.query, revision: 6 }),
    ),
    ...overrides,
  };
}

async function setup(
  content: ReturnType<typeof contentStub>,
  inputs: Partial<{ set: RecordSetDetailView; readOnly: boolean; debounceMs: number }> = {},
) {
  const saved = vi.fn();
  const stale = vi.fn();
  const view = await render(RecordSetQueryPanelComponent, {
    componentInputs: { projectKey: 'proj', set: SET, dataset: DATASET, debounceMs: 0, ...inputs },
    providers: [{ provide: ContentService, useValue: content }],
    on: { saved, stale },
  });
  return { ...view, saved, stale };
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Save query' }) as HTMLButtonElement;
}

function revertButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Revert' }) as HTMLButtonElement;
}

describe('RecordSetQueryPanelComponent', () => {
  afterEach(() => vi.useRealTimers());

  it('checks the stored query at once and shows the live count', async () => {
    const content = contentStub({
      previewSetQuery: vi.fn().mockReturnValue(of({ valid: true, diagnostics: [], matchCount: 4, selectedCount: 3 })),
    });
    await setup(content);

    expect(content.previewSetQuery).toHaveBeenCalledWith('proj', 'set-uuid', { where: "role == 'lead'", sort: '-joined' });
    expect(await screen.findByText('4 of 12 records match · the set shows 3')).toBeTruthy();
    expect((screen.getByLabelText('Where') as HTMLTextAreaElement).value).toBe("role == 'lead'");
  });

  it('checks a burst of edits once, after the debounce', async () => {
    const content = contentStub();
    const { fixture } = await setup(content, { debounceMs: 400 });
    await screen.findByText('4 of 12 records match');
    vi.useFakeTimers();

    const where = screen.getByLabelText('Where');
    fireEvent.input(where, { target: { value: 'role' } });
    fireEvent.input(where, { target: { value: "role == 'le" } });
    fireEvent.input(where, { target: { value: "role == 'staff'" } });
    expect(screen.getByText('Checking the query…')).toBeTruthy();

    vi.advanceTimersByTime(399);
    expect(content.previewSetQuery).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    expect(content.previewSetQuery).toHaveBeenCalledTimes(2);
    expect(content.previewSetQuery).toHaveBeenLastCalledWith('proj', 'set-uuid', { where: "role == 'staff'", sort: '-joined' });
    expect(screen.getByText('4 of 12 records match')).toBeTruthy();
  });

  it("lists the server's diagnostics for an invalid draft and blocks Save", async () => {
    const content = contentStub();
    await setup(content);
    await screen.findByText('4 of 12 records match');
    content.previewSetQuery.mockReturnValue(
      of({
        valid: false,
        matchCount: 0,
        selectedCount: 0,
        diagnostics: [
          { field: 'where', severity: 'ERROR', code: 'SF-TPL-0141', message: 'Unknown dataset field in where: rank', line: 1, column: 1 },
        ],
      }),
    );

    fireEvent.input(screen.getByLabelText('Where'), { target: { value: 'rank > 2' } });

    expect(await screen.findByText('Unknown dataset field in where: rank')).toBeTruthy();
    expect(screen.getByText('SF-TPL-0141')).toBeTruthy();
    expect(screen.getByText('The query has errors — a set with this query shows no records.')).toBeTruthy();
    expect(screen.getByLabelText('Where').getAttribute('aria-invalid')).toBe('true');
    expect(saveButton().disabled).toBe(true);
  });

  it('catches a limit that is not a whole number without asking the server', async () => {
    const content = contentStub();
    await setup(content);
    await screen.findByText('4 of 12 records match');

    fireEvent.input(screen.getByLabelText('Limit'), { target: { value: '-1' } });

    expect(await screen.findByText('Limit must be a whole number, 0 or more.')).toBeTruthy();
    expect(content.previewSetQuery).toHaveBeenCalledTimes(1);
    expect(saveButton().disabled).toBe(true);
  });

  /** Save and Revert are gated on a real difference from the stored query, not just on validity. */
  it('enables Save and Revert only for a changed query, and Revert restores the stored one', async () => {
    const content = contentStub();
    await setup(content);
    await screen.findByText('4 of 12 records match');
    expect(saveButton().disabled).toBe(true);
    expect(revertButton().disabled).toBe(true);

    fireEvent.input(screen.getByLabelText('Limit'), { target: { value: '3' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(screen.getByText('Unsaved')).toBeTruthy();

    fireEvent.click(revertButton());

    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect((screen.getByLabelText('Limit') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('Unsaved')).toBeNull();
  });

  it('counts only a real change as dirty: whitespace around the same where is not one', async () => {
    const content = contentStub();
    await setup(content);
    await screen.findByText('4 of 12 records match');

    fireEvent.input(screen.getByLabelText('Where'), { target: { value: "  role == 'lead'  " } });

    await waitFor(() => expect(content.previewSetQuery).toHaveBeenCalledTimes(2));
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByText('Unsaved')).toBeNull();
  });

  it('saves the whole query with If-Match and hands the saved set up', async () => {
    const content = contentStub();
    const { saved } = await setup(content);
    await screen.findByText('4 of 12 records match');

    fireEvent.input(screen.getByLabelText('Limit'), { target: { value: '3' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());

    expect(content.updateRecordSet).toHaveBeenCalledWith(
      'proj',
      'set-uuid',
      { query: { where: "role == 'lead'", sort: '-joined', limit: 3 } },
      '"rev-5"',
    );
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ revision: 6 }));
  });

  it('asks for a reload after a 409 instead of retrying', async () => {
    const content = contentStub({
      updateRecordSet: vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: {} }))),
    });
    const { stale } = await setup(content);
    await screen.findByText('4 of 12 records match');

    fireEvent.input(screen.getByLabelText('Limit'), { target: { value: '3' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());

    expect(stale).toHaveBeenCalledTimes(1);
    expect(content.updateRecordSet).toHaveBeenCalledTimes(1);
  });

  it('shows the diagnostics of a save rejected with 422', async () => {
    const content = contentStub({
      updateRecordSet: vi.fn().mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 422,
              error: { diagnostics: [{ field: 'sort', severity: 'ERROR', code: 'SF-TPL-0142', message: 'Cannot sort by bio' }] },
            }),
        ),
      ),
    });
    await setup(content);
    await screen.findByText('4 of 12 records match');

    fireEvent.input(screen.getByLabelText('Limit'), { target: { value: '3' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());

    expect(await screen.findByText('Cannot sort by bio')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it('adds a sort key on the first unused field, set explicitly', async () => {
    const content = contentStub();
    await setup(content, { set: { ...SET, query: {} } });
    await screen.findByText('4 of 12 records match');

    fireEvent.click(screen.getByRole('button', { name: 'Add sort key' }));

    const field = screen.getByLabelText('Sort key 1 field') as HTMLSelectElement;
    expect(field.value).toBe('_displayName');
    await waitFor(() => expect(content.previewSetQuery).toHaveBeenLastCalledWith('proj', 'set-uuid', { sort: '_displayName' }));
  });

  it('reorders and removes sort keys', async () => {
    const content = contentStub();
    await setup(content, { set: { ...SET, query: { sort: 'role,-joined' } } });
    await screen.findByText('4 of 12 records match');

    fireEvent.click(screen.getByRole('button', { name: 'Move sort key 2 up' }));
    await waitFor(() => expect(content.previewSetQuery).toHaveBeenLastCalledWith('proj', 'set-uuid', { sort: '-joined,role' }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove sort key 1' }));
    await waitFor(() => expect(content.previewSetQuery).toHaveBeenLastCalledWith('proj', 'set-uuid', { sort: 'role' }));
  });

  it("takes over the grid's filter and sort as an unsaved draft", async () => {
    const content = contentStub();
    const { fixture } = await setup(content);
    await screen.findByText('4 of 12 records match');

    fixture.componentInstance.adopt("role == 'staff'", [{ field: 'name', direction: 'asc' }]);
    fixture.detectChanges();

    expect((screen.getByLabelText('Where') as HTMLTextAreaElement).value).toBe("role == 'staff'");
    expect((screen.getByLabelText('Sort key 1 field') as HTMLSelectElement).value).toBe('name');
    expect(screen.getByText('Unsaved')).toBeTruthy();
    expect(content.updateRecordSet).not.toHaveBeenCalled();
  });

  it('read-only: shows the stored query and its stored findings, never previews, offers no Save', async () => {
    const content = contentStub();
    await setup(content, {
      readOnly: true,
      set: {
        ...SET,
        queryValid: false,
        queryDiagnostics: [{ field: 'where', severity: 'ERROR', code: 'SF-TPL-0141', message: 'Unknown dataset field in where: role' }],
      },
    });

    expect(await screen.findByText('Unknown dataset field in where: role')).toBeTruthy();
    expect((screen.getByLabelText('Where') as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save query' })).toBeNull();
    expect(content.previewSetQuery).not.toHaveBeenCalled();
  });
});
