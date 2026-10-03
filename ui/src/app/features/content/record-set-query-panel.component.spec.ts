import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { codeOf, typeCode } from '../../shared/code-editor/code-editor.testing';
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
      { name: 'role', type: 'TEXT', label: 'Role' },
      { name: 'level', type: 'SELECT', label: 'Level', options: [{ value: 'lead', label: 'Team lead' }, { value: 'staff', label: 'Staff' }] },
      { name: 'age', type: 'NUMBER', label: 'Age' },
      { name: 'active', type: 'BOOLEAN', label: 'Active' },
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
  options: { dev?: boolean } = {},
) {
  const saved = vi.fn();
  const stale = vi.fn();
  const view = await render(RecordSetQueryPanelComponent, {
    componentInputs: { projectKey: 'proj', set: SET, dataset: DATASET, debounceMs: 0, ...inputs },
    providers: [
      { provide: ContentService, useValue: content },
      { provide: DeveloperModeService, useValue: { enabled: signal(options.dev ?? false) } },
    ],
    on: { saved, stale },
  });
  return { ...view, saved, stale };
}

/** Opens the panel (it starts collapsed). */
async function expand() {
  fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
  await screen.findByRole('group', { name: 'Conditions' }).catch(() => undefined);
}

/** Chooses an option of an `sf-select` by its text (its `<option>`s are numbered). */
function pick(label: string, optionText: string) {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  const option = Array.from(select.options).find((o) => o.textContent?.trim() === optionText);
  expect(option, `option "${optionText}" of "${label}"`).toBeTruthy();
  fireEvent.change(select, { target: { value: option!.value } });
}

const saveButton = () => screen.getByRole('button', { name: 'Save filter' }) as HTMLButtonElement;
const revertButton = () => screen.getByRole('button', { name: 'Revert' }) as HTMLButtonElement;
const lastPreview = (content: ReturnType<typeof contentStub>) => content.previewSetQuery.mock.calls.at(-1)![2];

describe('RecordSetQueryPanelComponent', () => {
  afterEach(() => vi.useRealTimers());

  describe('collapsed', () => {
    it('is closed at first and says in words what the filter does and how many records match', async () => {
      const content = contentStub({
        previewSetQuery: vi.fn().mockReturnValue(of({ valid: true, diagnostics: [], matchCount: 4, selectedCount: 3 })),
      });
      await setup(content);

      expect(await screen.findByText('Where role is lead · sorted by joined, descending')).toBeTruthy();
      expect(await screen.findByText('4 of 12 records · the set shows 3')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Filter' }).getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByRole('group', { name: 'Conditions' })).toBeNull();
      expect(content.previewSetQuery).toHaveBeenCalledWith('proj', 'set-uuid', { where: "role == 'lead'", sort: '-joined' });
    });

    it('reads "All records" for a set without a filter, and names limit and offset when they are set', async () => {
      await setup(contentStub(), { set: { ...SET, query: {} } });
      expect(await screen.findByText('All records · sorted by name')).toBeTruthy();
    });

    it('says several conditions and keys in one line', async () => {
      await setup(contentStub(), {
        set: { ...SET, query: { where: "level == 'lead' && age > 30 && active == true", sort: 'name,-age', limit: 5, offset: 2 } },
      });

      expect(
        await screen.findByText(
          'Where level is Team lead and age is greater than 30 and active is yes · sorted by name field, then age (descending) · skipping the first 2 · at most 5',
        ),
      ).toBeTruthy();
    });
  });

  describe('the filter builder', () => {
    it('shows the stored conditions as rows of field, operator and value', async () => {
      await setup(contentStub());
      await expand();

      expect(screen.getByRole('button', { name: 'Filter' }).getAttribute('aria-expanded')).toBe('true');
      expect((screen.getByLabelText('Field of condition 1') as HTMLSelectElement).selectedOptions[0].textContent?.trim()).toBe('Role');
      expect((screen.getByLabelText('Operator of condition 1') as HTMLSelectElement).selectedOptions[0].textContent?.trim()).toBe('is');
      expect((screen.getByLabelText('Value of condition 1') as HTMLInputElement).value).toBe('lead');
      expect(screen.getByText('Where')).toBeTruthy();
    });

    it('writes the same expression the server stores when a value changes', async () => {
      const content = contentStub();
      await setup(content);
      await expand();

      fireEvent.input(screen.getByLabelText('Value of condition 1'), { target: { value: 'staff' } });

      await waitFor(() => expect(lastPreview(content)).toEqual({ where: "role == 'staff'", sort: '-joined' }));
      expect(screen.getByText('Unsaved')).toBeTruthy();
      expect(screen.getByText('Where role is staff · sorted by joined, descending')).toBeTruthy();
    });

    it('adds a condition that filters once it has a value, joined with "and"', async () => {
      const content = contentStub();
      await setup(content);
      await expand();

      fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));

      expect(screen.getByText('and')).toBeTruthy();
      // An empty value leaves the expression as it was.
      await waitFor(() => expect(lastPreview(content)).toEqual({ where: "role == 'lead'", sort: '-joined' }));
      pick('Field of condition 2', 'Age');
      pick('Operator of condition 2', 'is greater than');
      fireEvent.input(screen.getByLabelText('Value of condition 2'), { target: { value: '30' } });

      await waitFor(() => expect(lastPreview(content)).toEqual({ where: "role == 'lead' && age > 30", sort: '-joined' }));
    });

    it('offers a select for a field with options and yes/no for a boolean', async () => {
      const content = contentStub();
      await setup(content, { set: { ...SET, query: {} } });
      await expand();

      fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
      pick('Field of condition 1', 'Level');
      expect(within(screen.getByLabelText('Value of condition 1')).getByRole('option', { name: 'Team lead' })).toBeTruthy();
      pick('Value of condition 1', 'Staff');
      await waitFor(() => expect(lastPreview(content)).toEqual({ where: "level == 'staff'" }));

      pick('Field of condition 1', 'Active');
      pick('Value of condition 1', 'No');
      await waitFor(() => expect(lastPreview(content)).toEqual({ where: 'active == false' }));
    });

    it('resets operator and value when the field changes to one that compares differently', async () => {
      const content = contentStub();
      await setup(content);
      await expand();

      pick('Field of condition 1', 'Age');

      expect((screen.getByLabelText('Operator of condition 1') as HTMLSelectElement).selectedOptions[0].textContent?.trim()).toBe('is');
      expect((screen.getByLabelText('Value of condition 1') as HTMLInputElement).value).toBe('');
      await waitFor(() => expect(lastPreview(content)).toEqual({ sort: '-joined' }));
    });

    it('removes a condition', async () => {
      const content = contentStub();
      await setup(content);
      await expand();

      fireEvent.click(screen.getByRole('button', { name: 'Remove condition 1 (Role)' }));

      expect(await screen.findByText('No conditions — the set shows every record.')).toBeTruthy();
      await waitFor(() => expect(lastPreview(content)).toEqual({ sort: '-joined' }));
    });

    it('lists no builder for an expression it cannot show: the expression stays, Clear filter returns to the builder', async () => {
      const content = contentStub();
      const where = "role == 'lead' || (age > 3 && level == 'staff')";
      await setup(content, { set: { ...SET, query: { where } } });
      await expand();

      expect(screen.getByText(/an expression the builder can’t show/)).toBeTruthy();
      expect(screen.queryByRole('group', { name: 'Conditions' })).toBeNull();
      expect(screen.getAllByText(`Where ${where} · sorted by name`)).toBeTruthy();
      // The stored text is untouched until someone edits it.
      expect(content.previewSetQuery).toHaveBeenCalledWith('proj', 'set-uuid', { where });
      expect(screen.getByText(where, { selector: 'code' })).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));

      expect(await screen.findByRole('group', { name: 'Conditions' })).toBeTruthy();
      await waitFor(() => expect(lastPreview(content)).toEqual({}));
      expect(screen.getByText('Unsaved')).toBeTruthy();
    });

    it('steps aside for a field the dataset no longer has instead of dropping the condition', async () => {
      await setup(contentStub(), { set: { ...SET, query: { where: "rank == 'a'" } } });
      await expand();

      expect(screen.getByRole('button', { name: 'Clear filter' })).toBeTruthy();
      expect(screen.queryByLabelText('Field of condition 1')).toBeNull();
    });
  });

  describe('developer mode', () => {
    it('hides the expression from editors', async () => {
      await setup(contentStub());
      await expand();

      expect(screen.queryByLabelText('Expression')).toBeNull();
    });

    it('shows the stored expression, editable, and keeps the builder in step with it', async () => {
      const content = contentStub();
      await setup(content, {}, { dev: true });
      await expand();
      expect(codeOf(screen.getByLabelText('Expression'))).toBe("role == 'lead'");

      typeCode(screen.getByLabelText('Expression'), "age > 3 && level == 'staff'");

      await waitFor(() => expect(lastPreview(content)).toEqual({ where: "age > 3 && level == 'staff'", sort: '-joined' }));
      expect((screen.getByLabelText('Field of condition 2') as HTMLSelectElement).selectedOptions[0].textContent?.trim()).toBe('Level');
      expect((screen.getByLabelText('Value of condition 2') as HTMLSelectElement).selectedOptions[0].textContent?.trim()).toBe('Staff');
    });

    it('hands over to the expression when it is typed beyond the builder', async () => {
      const content = contentStub();
      await setup(content, {}, { dev: true });
      await expand();

      typeCode(screen.getByLabelText('Expression'), "age > 3 || role == 'x'");

      expect(await screen.findByText(/an expression the builder can’t show/)).toBeTruthy();
      expect(screen.queryByLabelText('Field of condition 1')).toBeNull();
      await waitFor(() => expect(lastPreview(content)).toEqual({ where: "age > 3 || role == 'x'", sort: '-joined' }));
    });

    it('writes what the builder builds into the expression', async () => {
      await setup(contentStub(), {}, { dev: true });
      await expand();

      fireEvent.input(screen.getByLabelText('Value of condition 1'), { target: { value: 'staff' } });

      await waitFor(() => expect(codeOf(screen.getByLabelText('Expression'))).toBe("role == 'staff'"));
    });

    it("underlines the server's diagnostics and blocks Save", async () => {
      const content = contentStub();
      await setup(content, {}, { dev: true });
      await expand();
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

      typeCode(screen.getByLabelText('Expression'), 'rank > 2');

      expect(await screen.findByText(/Unknown dataset field in where: rank/)).toBeTruthy();
      expect(screen.getByText(/SF-TPL-0141/)).toBeTruthy();
      expect(screen.getByText('The filter has errors — a set with this filter shows no records.')).toBeTruthy();
      expect(saveButton().disabled).toBe(true);
    });
  });

  it('checks a burst of edits once, after the debounce', async () => {
    const content = contentStub();
    const { fixture } = await setup(content, { debounceMs: 400 });
    await screen.findByText('4 of 12 records');
    await expand();
    vi.useFakeTimers();

    const value = screen.getByLabelText('Value of condition 1');
    fireEvent.input(value, { target: { value: 'a' } });
    fireEvent.input(value, { target: { value: 'ab' } });
    fireEvent.input(value, { target: { value: 'staff' } });
    fixture.detectChanges();
    expect(screen.getByText('Checking the filter…')).toBeTruthy();

    vi.advanceTimersByTime(399);
    expect(content.previewSetQuery).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    expect(content.previewSetQuery).toHaveBeenCalledTimes(2);
    expect(lastPreview(content)).toEqual({ where: "role == 'staff'", sort: '-joined' });
    expect(screen.getByText('4 of 12 records')).toBeTruthy();
  });

  it('catches a limit that is not a whole number without asking the server', async () => {
    const content = contentStub();
    await setup(content);
    await screen.findByText('4 of 12 records');
    await expand();

    fireEvent.input(screen.getByLabelText('Show at most'), { target: { value: '-1' } });

    expect(await screen.findByText(/Limit must be a whole number, 0 or more\./)).toBeTruthy();
    expect(content.previewSetQuery).toHaveBeenCalledTimes(1);
    expect(saveButton().disabled).toBe(true);
  });

  /** Save and Revert are gated on a real difference from the stored query, not just on validity. */
  it('enables Save and Revert only for a changed query, and Revert restores the stored one', async () => {
    const content = contentStub();
    await setup(content);
    await screen.findByText('4 of 12 records');
    await expand();
    expect(saveButton().disabled).toBe(true);
    expect(revertButton().disabled).toBe(true);

    fireEvent.input(screen.getByLabelText('Show at most'), { target: { value: '3' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(screen.getByText('Unsaved')).toBeTruthy();

    fireEvent.click(revertButton());

    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect((screen.getByLabelText('Show at most') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('Unsaved')).toBeNull();
  });

  it('counts only a real change as dirty: whitespace around the same where is not one', async () => {
    const content = contentStub();
    await setup(content, {}, { dev: true });
    await screen.findByText('4 of 12 records');
    await expand();

    typeCode(screen.getByLabelText('Expression'), "  role == 'lead'  ");

    await waitFor(() => expect(content.previewSetQuery).toHaveBeenCalledTimes(2));
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByText('Unsaved')).toBeNull();
  });

  it('saves the whole query with If-Match and hands the saved set up', async () => {
    const content = contentStub();
    const { saved } = await setup(content);
    await screen.findByText('4 of 12 records');
    await expand();

    fireEvent.input(screen.getByLabelText('Show at most'), { target: { value: '3' } });
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
    await screen.findByText('4 of 12 records');
    await expand();

    fireEvent.input(screen.getByLabelText('Show at most'), { target: { value: '3' } });
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
    await screen.findByText('4 of 12 records');
    await expand();

    fireEvent.input(screen.getByLabelText('Show at most'), { target: { value: '3' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());

    expect(await screen.findByText(/Cannot sort by bio/)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  describe('sort', () => {
    it('adds a sort key on the first unused field, set explicitly', async () => {
      const content = contentStub();
      await setup(content, { set: { ...SET, query: {} } });
      await screen.findByText('4 of 12 records');
      await expand();
      expect(screen.getByText('Default order: by name, then uid.')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Add sort key' }));

      expect((screen.getByLabelText('Field of sort key 1') as HTMLSelectElement).selectedOptions[0].textContent?.trim()).toBe('Name');
      await waitFor(() => expect(lastPreview(content)).toEqual({ sort: '_displayName' }));
    });

    it('changes the direction, reorders and removes sort keys', async () => {
      const content = contentStub();
      await setup(content, { set: { ...SET, query: { sort: 'role,-joined' } } });
      await screen.findByText('4 of 12 records');
      await expand();

      fireEvent.click(screen.getByRole('radio', { name: 'Descending', checked: false }));
      await waitFor(() => expect(lastPreview(content)).toEqual({ sort: '-role,-joined' }));

      fireEvent.click(screen.getByRole('button', { name: 'Move sort key 2 up' }));
      await waitFor(() => expect(lastPreview(content)).toEqual({ sort: '-joined,-role' }));

      fireEvent.click(screen.getByRole('button', { name: 'Remove sort key 1' }));
      await waitFor(() => expect(lastPreview(content)).toEqual({ sort: '-role' }));
    });

    it('does not offer a field another key already sorts by', async () => {
      await setup(contentStub(), { set: { ...SET, query: { sort: 'role,age' } } });
      await expand();

      const second = screen.getByLabelText('Field of sort key 2') as HTMLSelectElement;
      const role = Array.from(second.options).find((o) => o.textContent?.trim() === 'Role')!;
      expect(role.disabled).toBe(true);
    });

    it('shows a sort key on a field the schema no longer has, as unknown', async () => {
      await setup(contentStub(), { set: { ...SET, query: { sort: 'gone' } } });
      await expand();

      expect((screen.getByLabelText('Field of sort key 1') as HTMLSelectElement).selectedOptions[0].textContent?.trim()).toBe('gone (unknown field)');
    });
  });

  it("takes over the grid's filter and sort as an unsaved draft, opened", async () => {
    const content = contentStub();
    const { fixture } = await setup(content);
    await screen.findByText('4 of 12 records');

    fixture.componentInstance.adopt("age > 30", [{ field: 'name', direction: 'asc' }]);
    fixture.detectChanges();

    expect(screen.getByRole('button', { name: 'Filter' }).getAttribute('aria-expanded')).toBe('true');
    expect((screen.getByLabelText('Field of condition 1') as HTMLSelectElement).selectedOptions[0].textContent?.trim()).toBe('Age');
    expect((screen.getByLabelText('Field of sort key 1') as HTMLSelectElement).selectedOptions[0].textContent?.trim()).toBe('Name field');
    expect(screen.getByText('Unsaved')).toBeTruthy();
    expect(content.updateRecordSet).not.toHaveBeenCalled();
  });

  it('read-only: shows the stored filter and its stored findings, never previews, offers no editing', async () => {
    const content = contentStub();
    await setup(content, {
      readOnly: true,
      set: {
        ...SET,
        queryValid: false,
        queryDiagnostics: [{ field: 'where', severity: 'ERROR', code: 'SF-TPL-0141', message: 'Unknown dataset field in where: role' }],
      },
    });
    await expand();

    expect(await screen.findByText(/Unknown dataset field in where: role/)).toBeTruthy();
    expect((screen.getByLabelText('Value of condition 1') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save filter' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add condition' })).toBeNull();
    expect(screen.getAllByText('The filter has errors — a set with this filter shows no records.').length).toBeGreaterThan(0);
    expect(content.previewSetQuery).not.toHaveBeenCalled();
  });
});
