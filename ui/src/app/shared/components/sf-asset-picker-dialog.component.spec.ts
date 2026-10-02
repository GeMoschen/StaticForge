import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ContentService, type RecordSetSummaryView } from '../../features/content/content.service';
import { SfAssetPickerDialogComponent, type AssetPicked } from './sf-asset-picker-dialog.component';

const sets: RecordSetSummaryView[] = [
  { uuid: 'set-1', uid: 'leadership', displayName: 'Leadership', dataset: { uuid: 'ds-1', uid: 'team', displayName: 'Team' }, recordCount: 3 },
  { uuid: 'set-2', uid: 'staff', displayName: 'Staff', dataset: { uuid: 'ds-1', uid: 'team', displayName: 'Team' }, recordCount: 1 },
  { uuid: 'set-3', uid: 'featured', displayName: 'Featured', dataset: { uuid: 'ds-2', uid: 'products', displayName: 'Products' }, recordCount: 8 },
];

const datasets = [
  { uuid: 'ds-1', uid: 'team', displayName: 'Team' },
  { uuid: 'ds-2', uid: 'products', displayName: 'Products' },
];

const pages = [
  { uuid: 'p-1', uid: 'home', displayName: 'Home', type: 'PAGE', folderPath: '/pages_root/', release: { '': { status: 'PUBLISHED' } } },
  { uuid: 'p-2', uid: 'our_story', displayName: 'Our story', type: 'PAGE', folderPath: '/pages_root/about/', release: { '': { status: 'CHANGED' } } },
];

const folderTree = [
  {
    uuid: 'root',
    displayName: 'All pages',
    path: '/pages_root/',
    children: [
      { uuid: 'f-about', uid: 'about', displayName: 'About us', path: '/pages_root/about/', children: [{ uuid: 'f-team', uid: 'team', displayName: 'Team', path: '/pages_root/about/team/', children: [] }] },
      { uuid: 'f-news', uid: 'news', displayName: 'News', path: '/pages_root/news/', children: [] },
    ],
  },
];

interface Options {
  allowedTypes?: string[] | null;
  dataset?: string | null;
  initialType?: string | null;
  listAssets?: ReturnType<typeof vi.fn>;
  listRecords?: ReturnType<typeof vi.fn>;
  listFolders?: ReturnType<typeof vi.fn>;
  dev?: boolean;
}

async function renderPicker(options: Options = {}) {
  const content = {
    listRecordSets: vi.fn().mockReturnValue(of(sets)),
    listDatasets: vi.fn().mockReturnValue(of(datasets)),
    listRecords: options.listRecords ?? vi.fn().mockReturnValue(of({ content: [{ uuid: 'r-1', uid: 'ada', displayName: 'Ada' }] })),
  };
  const listAssets = options.listAssets ?? vi.fn().mockReturnValue(of({ content: pages }));
  const listFolders = options.listFolders ?? vi.fn().mockReturnValue(of([]));
  const picked = vi.fn<(value: AssetPicked) => void>();
  const closed = vi.fn();
  await render(SfAssetPickerDialogComponent, {
    componentInputs: {
      projectKey: 'acme',
      allowedTypes: options.allowedTypes === undefined ? null : options.allowedTypes,
      dataset: options.dataset ?? null,
      initialType: options.initialType ?? null,
    },
    on: { picked, closed },
    providers: [
      provideTranslocoTesting(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ContentService, useValue: content },
      { provide: ApiClient, useValue: { listAssets, listFolders, mediaThumbnailBlob: () => throwError(() => new Error('none')) } },
      { provide: ProjectContextStore, useValue: { pageFolderTree: () => folderTree, mediaFolderTree: () => [] } },
      { provide: DeveloperModeService, useValue: { enabled: signal(options.dev ?? false) } },
      { provide: EditingLocaleStore, useValue: { locale: signal<string | null>(null) } },
    ],
  });
  return { content, listAssets, listFolders, picked, closed };
}

const dialog = () => within(screen.getByRole('dialog'));
const chooseButton = () => dialog().getByRole('button', { name: 'Choose' }) as HTMLButtonElement;

describe('SfAssetPickerDialogComponent — record sets', () => {
  it("lists only the restricted dataset's sets with dataset and record count, and emits the pick", async () => {
    const { content, picked } = await renderPicker({ allowedTypes: ['RECORD_SET'], dataset: 'team' });

    const leadership = await screen.findByRole('option', { name: /Leadership/ });
    expect(leadership.textContent).toContain('Team');
    expect(leadership.textContent).toContain('3 records');
    expect(screen.getByRole('option', { name: /Staff/ }).textContent).toContain('1 record');
    expect(screen.queryByRole('option', { name: /Featured/ })).toBeNull();
    // A single allowed type: no type switch, the title says what is picked.
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Choose a record set' })).toBeTruthy();
    expect(content.listRecordSets).toHaveBeenCalledTimes(1);

    fireEvent.click(leadership);
    fireEvent.click(chooseButton());
    expect(picked).toHaveBeenCalledWith({
      uuid: 'set-1',
      assetType: 'RECORD_SET',
      label: 'Leadership',
      dataset: 'Team',
      recordCount: 3,
    });
  });

  it('offers only records for a dataset restriction without assetTypes, as the server validates it', async () => {
    const { content } = await renderPicker({ allowedTypes: null, dataset: 'team' });

    await waitFor(() => expect(content.listDatasets).toHaveBeenCalled());
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(content.listRecordSets).not.toHaveBeenCalled();
  });

  it('offers records and record sets when assetTypes names both', async () => {
    await renderPicker({ allowedTypes: ['RECORD', 'RECORD_SET'], dataset: 'team' });

    const records = await screen.findByRole('radio', { name: 'Records' });
    expect(screen.getByRole('radio', { name: 'Record sets' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Record sets' }));
    await waitFor(() => expect(screen.getByRole('option', { name: /Leadership/ })).toBeTruthy());
    expect(screen.queryByRole('option', { name: /Featured/ })).toBeNull();
    expect(records).toBeTruthy();
  });

  it('lists every set without a restriction', async () => {
    await renderPicker({ allowedTypes: ['RECORD_SET'], dataset: null });

    expect(await screen.findByRole('option', { name: /Featured/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Leadership/ })).toBeTruthy();
  });
});

describe('SfAssetPickerDialogComponent — the picker', () => {
  it('shows the type switch only for more than one allowed type, and a dataset select only for records', async () => {
    await renderPicker({ allowedTypes: ['PAGE', 'MEDIA', 'RECORD'] });
    expect(await screen.findByRole('radiogroup', { name: 'Asset type' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Dataset' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Records' }));
    expect(await screen.findByRole('combobox', { name: 'Dataset' })).toBeTruthy();
  });

  it('hides the switch for a single type and titles the dialog after it', async () => {
    await renderPicker({ allowedTypes: ['PAGE'] });
    expect(await screen.findByRole('heading', { name: 'Choose a page' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('lists pages with their place and a status badge, and the uid only in developer mode', async () => {
    await renderPicker({ allowedTypes: ['PAGE'] });
    const story = await screen.findByRole('option', { name: /Our story/ });
    expect(story.textContent).toContain('about');
    expect(story.textContent).toContain('Changed');
    expect(story.textContent).not.toContain('our_story');
    expect(screen.getByRole('option', { name: /Home/ }).textContent).not.toContain('Published');
  });

  it('shows the uid instead of the place in developer mode', async () => {
    await renderPicker({ allowedTypes: ['PAGE'], dev: true });
    expect((await screen.findByRole('option', { name: /Our story/ })).textContent).toContain('our_story');
  });

  it('searches, debounced, and says when nothing matches with a way to clear the search', async () => {
    const listAssets = vi.fn().mockReturnValue(of({ content: pages }));
    await renderPicker({ allowedTypes: ['PAGE'], listAssets });
    await screen.findByRole('option', { name: /Home/ });

    listAssets.mockReturnValue(of({ content: [] }));
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    await waitFor(() => expect(listAssets).toHaveBeenLastCalledWith('acme', expect.objectContaining({ q: 'zzz' })));
    expect(await screen.findByText('No pages match “zzz”')).toBeTruthy();

    listAssets.mockReturnValue(of({ content: pages }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear search' }).at(-1)!);
    await waitFor(() => expect(screen.getByRole('option', { name: /Home/ })).toBeTruthy());
  });

  it('filters by the folder chosen in the tree and shows it in the breadcrumb', async () => {
    const listAssets = vi.fn().mockReturnValue(of({ content: pages }));
    await renderPicker({ allowedTypes: ['PAGE'], listAssets });
    await screen.findByRole('option', { name: /Home/ });

    fireEvent.click(await screen.findByRole('treeitem', { name: /About us/ }));
    await waitFor(() => expect(listAssets).toHaveBeenLastCalledWith('acme', expect.objectContaining({ folder: '/pages_root/about/' })));
    const crumbs = screen.getByRole('navigation', { name: 'Location' });
    expect(within(crumbs).getByText('About us')).toBeTruthy();

    fireEvent.click(within(crumbs).getByRole('button', { name: 'All pages' }));
    await waitFor(() => expect(listAssets).toHaveBeenLastCalledWith('acme', expect.objectContaining({ folder: undefined })));
  });

  it('keeps Choose disabled until a row is selected, then names the selection in the footer', async () => {
    const { picked } = await renderPicker({ allowedTypes: ['PAGE'] });
    await screen.findByRole('option', { name: /Home/ });
    expect(chooseButton().disabled).toBe(true);
    expect(screen.getByText('Nothing selected yet.')).toBeTruthy();

    fireEvent.click(screen.getByRole('option', { name: /Our story/ }));
    expect(chooseButton().disabled).toBe(false);
    expect(screen.getByText('Our story', { selector: 'strong' })).toBeTruthy();
    expect(picked).not.toHaveBeenCalled();
  });

  it('chooses with Enter on the selected row and with a double click', async () => {
    const { picked } = await renderPicker({ allowedTypes: ['PAGE'] });
    const story = await screen.findByRole('option', { name: /Our story/ });

    fireEvent.click(story);
    fireEvent.keyDown(story, { key: 'Enter' });
    expect(picked).toHaveBeenCalledWith({ uuid: 'p-2', assetType: 'PAGE', label: 'Our story', dataset: undefined, recordCount: undefined });

    fireEvent.dblClick(screen.getByRole('option', { name: /Home/ }));
    expect(picked).toHaveBeenLastCalledWith(expect.objectContaining({ uuid: 'p-1' }));
  });

  it('moves the selection with the arrow keys, Home and End', async () => {
    await renderPicker({ allowedTypes: ['PAGE'] });
    const home = await screen.findByRole('option', { name: /Home/ });

    const selected = () =>
      Array.from(document.querySelectorAll('.picker__row[aria-selected="true"]')).map((row) => row.textContent).join('|');
    fireEvent.keyDown(home, { key: 'ArrowDown' });
    expect(selected()).toContain('Home');
    fireEvent.keyDown(home, { key: 'ArrowDown' });
    expect(selected()).toContain('Our story');
    fireEvent.keyDown(home, { key: 'ArrowUp' });
    expect(selected()).toContain('Home');
    fireEvent.keyDown(home, { key: 'End' });
    expect(screen.getByRole('option', { name: /Our story/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(home, { key: 'Home' });
    expect(screen.getByRole('option', { name: /Home/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows an error with Retry, and loads again on Retry', async () => {
    const listAssets = vi.fn().mockReturnValueOnce(throwError(() => new Error('boom'))).mockReturnValue(of({ content: pages }));
    await renderPicker({ allowedTypes: ['PAGE'], listAssets });

    expect(await screen.findByText('The list could not be loaded.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('option', { name: /Home/ })).toBeTruthy();
    expect(listAssets).toHaveBeenCalledTimes(2);
  });

  it('closes with Cancel without picking', async () => {
    const { closed, picked } = await renderPicker({ allowedTypes: ['PAGE'] });
    await screen.findByRole('option', { name: /Home/ });
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }));
    expect(closed).toHaveBeenCalled();
    expect(picked).not.toHaveBeenCalled();
  });

  it('gives a type without a folder tree the whole dialog width, and one with a tree two columns', async () => {
    await renderPicker({ allowedTypes: ['RECORD_SET'] });
    await screen.findByRole('option', { name: /Leadership/ });
    expect(document.querySelector('.picker__body')?.classList.contains('picker__body--flat')).toBe(true);
    expect(document.querySelector('.picker__tree')).toBeNull();
  });

  it('keeps the tree beside the results for pages', async () => {
    await renderPicker({ allowedTypes: ['PAGE'] });
    await screen.findByRole('option', { name: /Home/ });
    expect(document.querySelector('.picker__body')?.classList.contains('picker__body--flat')).toBe(false);
    expect(document.querySelector('.picker__tree')).not.toBeNull();
  });

  it('lists navigation entries from the asset listing, with the Navigation folders as the tree, and picks one', async () => {
    const entries = [
      { uuid: 'ne-1', uid: 'nav_shop', displayName: 'Shop', type: 'PAGE_REFERENCE', folderPath: '/navigation_root/main/', release: { '': { status: 'CHANGED' } } },
    ];
    const listAssets = vi.fn().mockReturnValue(of({ content: entries }));
    const listFolders = vi.fn().mockReturnValue(
      of([{ uuid: 'nroot', uid: 'navigation_root', displayName: 'All navigation', protectedFolder: true, path: '/navigation_root/', children: [{ uuid: 'nf-main', uid: 'main', displayName: 'Main menu', path: '/navigation_root/main/', children: [] }] }]),
    );
    const { picked } = await renderPicker({ allowedTypes: ['PAGE_REFERENCE'], listAssets, listFolders });

    expect(await screen.findByRole('heading', { name: 'Choose a navigation entry' })).toBeTruthy();
    const row = await screen.findByRole('option', { name: /Shop/ });
    expect(listAssets).toHaveBeenCalledWith('acme', expect.objectContaining({ type: 'PAGE_REFERENCE' }));
    expect(listFolders).toHaveBeenCalledWith('acme', 'NAVIGATION', 10);
    expect(row.textContent).toContain('main');
    expect(row.textContent).toContain('Changed');
    expect(await screen.findByRole('treeitem', { name: /Main menu/ })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'All navigation entries' }).length).toBeGreaterThan(0);

    fireEvent.dblClick(row);
    expect(picked).toHaveBeenCalledWith({ uuid: 'ne-1', assetType: 'PAGE_REFERENCE', label: 'Shop', dataset: undefined, recordCount: undefined });
  });

  it('filters the navigation entries by the folder chosen in the tree', async () => {
    const listAssets = vi.fn().mockReturnValue(of({ content: [] }));
    const listFolders = vi.fn().mockReturnValue(of([{ uuid: 'nf-main', uid: 'main', displayName: 'Main menu', path: '/navigation_root/main/', children: [] }]));
    await renderPicker({ allowedTypes: ['PAGE_REFERENCE'], listAssets, listFolders });
    fireEvent.click(await screen.findByRole('treeitem', { name: /Main menu/ }));
    await waitFor(() => expect(listAssets).toHaveBeenLastCalledWith('acme', expect.objectContaining({ folder: '/navigation_root/main/' })));
  });

  it('is in the all-types switch', async () => {
    await renderPicker({ allowedTypes: null });
    expect(await screen.findByRole('combobox', { name: 'Asset type' })).toBeTruthy();
    fireEvent.click(screen.getByRole('combobox', { name: 'Asset type' }));
    expect(await screen.findByRole('option', { name: 'Navigation entries' })).toBeTruthy();
  });

  it('lists the datasets of a pagination source pick and hands the dataset back', async () => {
    const { picked } = await renderPicker({ allowedTypes: ['DATASET'] });
    expect(await screen.findByRole('heading', { name: 'Choose a source' })).toBeTruthy();
    fireEvent.dblClick(await screen.findByRole('option', { name: /Products/ }));
    expect(picked).toHaveBeenCalledWith(expect.objectContaining({ uuid: 'ds-2', assetType: 'DATASET', label: 'Products' }));
  });
});
