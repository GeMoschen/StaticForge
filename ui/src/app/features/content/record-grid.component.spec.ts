import '@angular/compiler';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ContentService, type DatasetDetailView, type RecordSetGridQuery } from './content.service';
import { EXCLUDED_BY_QUERY, EXCLUDED_INVALID_QUERY, RecordGridComponent } from './record-grid.component';

// `compiledDefinition` / `values` are `JsonNode` on the server (`Record<string, never>` in the generated types).
const DATASET = {
  uuid: 'ds-team',
  uid: 'team',
  displayName: 'Team',
  compiledDefinition: { editors: [{ name: 'role', type: 'TEXT', label: 'Role' }], bodies: [] },
} as unknown as DatasetDetailView;

const ROWS = [
  { uuid: 'r1', uid: 'ada', displayName: 'Ada', values: { role: 'lead' } },
  { uuid: 'r2', uid: 'bob', displayName: 'Bob', values: { role: 'staff' } },
];

function page(rows: unknown[]) {
  return of({ content: rows, page: { size: 50, number: 0, totalElements: rows.length, totalPages: 1 } });
}

/** Every record for the grid; for the membership probe (applySetQuery + `_uuid` where) only Ada. */
function contentStub() {
  return {
    listSetRecords: vi.fn().mockImplementation((_key: string, _uuid: string, query: RecordSetGridQuery) => {
      if (query.applySetQuery && query.where?.includes('_uuid')) {
        return page([ROWS[0]]);
      }
      return page(query.applySetQuery ? [ROWS[0]] : ROWS);
    }),
  };
}

async function setup(content: ReturnType<typeof contentStub>, inputs: Record<string, unknown> = {}) {
  const useAsSetQuery = vi.fn();
  const view = await render(RecordGridComponent, {
    componentInputs: { projectKey: 'proj', dataset: DATASET, recordSetUuid: 'set-uuid', canEditQuery: true, ...inputs },
    providers: [{ provide: ContentService, useValue: content }],
    on: { useAsSetQuery },
  });
  return { ...view, useAsSetQuery };
}

function rowOf(name: string): HTMLTableRowElement {
  return screen.getByText(name).closest('tr') as HTMLTableRowElement;
}

describe('RecordGridComponent (record set grid)', () => {
  it('lists every record by default and dims the ones the set query leaves out', async () => {
    const content = contentStub();
    await setup(content);

    await waitFor(() => expect(rowOf('Bob').classList).toContain('record-grid__row--excluded'));
    expect(content.listSetRecords.mock.calls[0][2]).toMatchObject({ applySetQuery: false, page: 0 });
    expect(content.listSetRecords.mock.calls[1][2]).toMatchObject({
      applySetQuery: true,
      where: "_uuid == 'r1' || _uuid == 'r2'",
      size: 2,
    });
    expect(rowOf('Bob').getAttribute('title')).toBe(EXCLUDED_BY_QUERY);
    expect(rowOf('Ada').classList).not.toContain('record-grid__row--excluded');
    expect(rowOf('Ada').getAttribute('title')).toBeNull();
    expect(screen.getByRole('radio', { name: 'All records' }).getAttribute('aria-checked')).toBe('true');
  });

  it('"Show as rendered" applies the set query and hides what it leaves out, undimmed', async () => {
    const content = contentStub();
    await setup(content);
    await waitFor(() => expect(rowOf('Bob')).toBeTruthy());
    content.listSetRecords.mockClear();

    fireEvent.click(screen.getByRole('radio', { name: 'Show as rendered' }));

    await waitFor(() => expect(screen.queryByText('Bob')).toBeNull());
    expect(content.listSetRecords).toHaveBeenCalledTimes(1);
    expect(content.listSetRecords.mock.calls[0][2]).toMatchObject({ applySetQuery: true, page: 0 });
    expect(rowOf('Ada').classList).not.toContain('record-grid__row--excluded');
    expect(screen.getByRole('radio', { name: 'Show as rendered' }).getAttribute('aria-checked')).toBe('true');
  });

  it('dims every row while the stored set query is invalid, without asking which it keeps', async () => {
    const content = contentStub();
    await setup(content, { queryValid: false });

    await waitFor(() => expect(rowOf('Ada').classList).toContain('record-grid__row--excluded'));
    expect(rowOf('Bob').getAttribute('title')).toBe(EXCLUDED_INVALID_QUERY);
    expect(content.listSetRecords).toHaveBeenCalledTimes(1);
  });

  /** The grid's own filter is ephemeral: it narrows the listing but only a click hands it to the query. */
  it('keeps its filter out of the set query until "Use as set query" hands it over', async () => {
    const content = contentStub();
    const { useAsSetQuery } = await setup(content);
    await waitFor(() => expect(rowOf('Ada')).toBeTruthy());
    const use = screen.getByRole('button', { name: 'Use as set query' }) as HTMLButtonElement;
    expect(use.disabled).toBe(true);

    fireEvent.input(screen.getByLabelText('Filter expression'), { target: { value: "role == 'lead'" } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    fireEvent.click(screen.getByRole('button', { name: /^Role/ }));

    await waitFor(() => expect(use.disabled).toBe(false));
    expect(useAsSetQuery).not.toHaveBeenCalled();
    const lastListing = content.listSetRecords.mock.calls.filter((call) => !String(call[2].where).includes('_uuid')).at(-1);
    expect(lastListing?.[2]).toMatchObject({ where: "role == 'lead'", sort: [{ field: 'role', direction: 'asc' }] });

    fireEvent.click(use);

    expect(useAsSetQuery).toHaveBeenCalledWith({ where: "role == 'lead'", sort: [{ field: 'role', direction: 'asc' }] });
  });

  it('offers "Use as set query" only to someone who may edit the query', async () => {
    await setup(contentStub(), { canEditQuery: false });

    await waitFor(() => expect(rowOf('Ada')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Use as set query' })).toBeNull();
  });
});
