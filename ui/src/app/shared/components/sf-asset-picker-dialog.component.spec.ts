import { render, screen, fireEvent, waitFor } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ContentService, type RecordSetSummaryView } from '../../features/content/content.service';
import { SfAssetPickerDialogComponent, type AssetPicked } from './sf-asset-picker-dialog.component';

const sets: RecordSetSummaryView[] = [
  { uuid: 'set-1', uid: 'leadership', displayName: 'Leadership', dataset: { uuid: 'ds-1', uid: 'team', displayName: 'Team' }, recordCount: 3 },
  { uuid: 'set-2', uid: 'staff', displayName: 'Staff', dataset: { uuid: 'ds-1', uid: 'team', displayName: 'Team' }, recordCount: 1 },
  { uuid: 'set-3', uid: 'featured', displayName: 'Featured', dataset: { uuid: 'ds-2', uid: 'products', displayName: 'Products' }, recordCount: 8 },
];

async function renderPicker(inputs: { allowedTypes: string[] | null; dataset: string | null }) {
  const content = {
    listRecordSets: vi.fn().mockReturnValue(of(sets)),
    listDatasets: vi.fn().mockReturnValue(of([{ uuid: 'ds-1', uid: 'team', displayName: 'Team' }])),
    listRecords: vi.fn().mockReturnValue(of({ content: [] })),
  };
  const picked = vi.fn<(value: AssetPicked) => void>();
  await render(SfAssetPickerDialogComponent, {
    componentInputs: { projectKey: 'acme', ...inputs },
    on: { picked },
    providers: [
      { provide: ContentService, useValue: content },
      { provide: ApiClient, useValue: { listAssets: vi.fn().mockReturnValue(of({ content: [] })) } },
      { provide: ProjectContextStore, useValue: { pageFolderTree: () => [], mediaFolderTree: () => [] } },
    ],
  });
  return { content, picked };
}

describe('SfAssetPickerDialogComponent — record sets', () => {
  it("lists only the restricted dataset's sets with dataset and record count, and emits the pick", async () => {
    const { content, picked } = await renderPicker({ allowedTypes: ['RECORD_SET'], dataset: 'team' });

    const leadership = await screen.findByRole('button', { name: /Leadership/ });
    expect(leadership.textContent).toContain('Team');
    expect(leadership.textContent).toContain('3 records');
    expect(screen.getByRole('button', { name: /Staff/ }).textContent).toContain('1 record ·');
    expect(screen.queryByRole('button', { name: /Featured/ })).toBeNull();
    // A single allowed type: no type switch.
    expect(screen.queryByRole('combobox', { name: 'Asset type' })).toBeNull();
    expect(content.listRecordSets).toHaveBeenCalledTimes(1);

    fireEvent.click(leadership);
    expect(picked).toHaveBeenCalledWith({
      uuid: 'set-1',
      assetType: 'RECORD_SET',
      label: 'Leadership',
      dataset: 'Team',
      recordCount: 3,
    });
  });

  it('offers records and record sets for a dataset restriction without assetTypes', async () => {
    await renderPicker({ allowedTypes: null, dataset: 'team' });

    const typeSwitch = (await screen.findByRole('combobox', { name: 'Asset type' })) as HTMLSelectElement;
    expect(Array.from(typeSwitch.options).map((o) => o.textContent?.trim())).toEqual(['Records', 'Record sets']);

    fireEvent.change(typeSwitch, { target: { value: 'RECORD_SET' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Leadership/ })).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Featured/ })).toBeNull();
  });

  it('lists every set without a restriction', async () => {
    await renderPicker({ allowedTypes: ['RECORD_SET'], dataset: null });

    expect(await screen.findByRole('button', { name: /Featured/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Leadership/ })).toBeTruthy();
  });
});
