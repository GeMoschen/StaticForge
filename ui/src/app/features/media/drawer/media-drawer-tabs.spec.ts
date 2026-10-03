import '@angular/compiler';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../../core/ui/toast.service';
import { CSS, HISTORY, PDF, PHOTO, renderDrawer } from './media-drawer.testing';
import { MEDIA_DRAWER_TABS, tabOf, tabsFor } from './media-drawer.store';

afterEach(() => {
  try {
    for (const pending of TestBed.inject(HttpTestingController).match(() => true).filter((req) => !req.cancelled)) {
      pending.flush(pending.request.responseType === 'blob' ? new Blob() : {});
    }
  } catch {
    // a spec without the HTTP testing module has nothing pending
  }
  vi.restoreAllMocks();
});

describe('which tabs apply (decision 21)', () => {
  it('Details, Languages, Used by and Versions for every file; Variants for rasters only', () => {
    expect(tabsFor(PDF, false)).toEqual(['details', 'languages', 'usedby', 'versions']);
    expect(tabsFor(PHOTO, false)).toEqual(['details', 'variants', 'languages', 'usedby', 'versions']);
    expect(tabsFor({ mimeType: 'image/svg+xml', textEditable: true }, false)).not.toContain('variants');
  });

  it('Processing and Source for text media, Rendered between them while CMS syntax is processed', () => {
    expect(tabsFor(CSS, false)).toEqual(['details', 'languages', 'processing', 'source', 'usedby', 'versions']);
    expect(tabsFor(CSS, true)).toEqual(['details', 'languages', 'processing', 'rendered', 'source', 'usedby', 'versions']);
  });

  it('knows the tabs by their URL names', () => {
    expect(MEDIA_DRAWER_TABS.map(tabOf)).toEqual([...MEDIA_DRAWER_TABS]);
    expect(tabOf('nonsense')).toBeNull();
    expect(tabOf(null)).toBeNull();
  });
});

describe('Variants tab', () => {
  it('lists the original and every generated size, each with a download', async () => {
    await renderDrawer({ inputs: { tab: 'variants' } });

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('cell').slice(0, 4).map((cell) => cell.textContent?.trim()))).toEqual([
      ['Original', 'JPG', '4000 × 2667', '1.2 MB'],
      ['w400', 'WEBP', '400 × 267', '–'],
      ['w1600', 'WEBP', '1600 × 1067', '–'],
    ]);
    expect(screen.getByRole('button', { name: 'Download w400 WEBP' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download JPG' })).toBeInTheDocument();
  });

  it('downloads a variant through the authenticated client', async () => {
    const { http } = await renderDrawer({ inputs: { tab: 'variants' } });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();

    fireEvent.click(screen.getByRole('button', { name: 'Download w400 WEBP' }));

    const read = await waitFor(() => http.expectOne((r) => r.url.includes('/media/media-1/binary?variant=w400')));
    read.flush(new Blob(['x']));
  });
});

describe('Used by tab', () => {
  it('lists the places that use the file as links to where they open', async () => {
    await renderDrawer({
      inputs: { tab: 'usedby' },
      answers: {
        usages: [
          { fromUuid: 'p1', fromUid: 'home', fromType: 'PAGE', sourcePath: 'hero.image' },
          { fromUuid: 'r1', fromUid: 'espresso', fromType: 'RECORD', sourcePath: 'photo' },
        ],
      },
    });

    expect(await screen.findByRole('heading', { name: 'Used in 2 places' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'home' });
    expect(link).toHaveAttribute('href', '/p/proj1/pages/p1');
    expect(screen.getByRole('link', { name: 'espresso' })).toHaveAttribute('href', '/p/proj1/content/records/r1');
    expect(screen.getByText(/Page · hero\.image/)).toBeInTheDocument();
  });

  it('says so when nothing uses the file', async () => {
    await renderDrawer({ inputs: { tab: 'usedby' } });

    expect(await screen.findByText('Not used anywhere')).toBeInTheDocument();
  });
});

describe('Versions tab', () => {
  it('lists the history newest first, marks the current version and offers Restore on the older ones', async () => {
    await renderDrawer({ inputs: { tab: 'versions' } });

    const items = await screen.findAllByRole('listitem');
    const versions = items.filter((item) => item.classList.contains('version'));
    expect(versions.map((item) => item.textContent?.match(/Version \d/)?.[0])).toEqual(['Version 3', 'Version 2', 'Version 1']);
    expect(within(versions[0]).getByText('Current')).toBeInTheDocument();
    expect(within(versions[0]).queryByRole('button', { name: /Restore/ })).not.toBeInTheDocument();
    expect(within(versions[1]).getByRole('button', { name: /Restore/ })).toBeInTheDocument();
    expect(versions[2].textContent).toContain('Grace');
  });

  it('restores an earlier version after asking, reads the file again and says so', async () => {
    const { http, settle, updated } = await renderDrawer({ inputs: { tab: 'versions' } });
    const toast = vi.spyOn(TestBed.inject(ToastService), 'show');

    fireEvent.click((await screen.findAllByRole('button', { name: /Restore/ }))[1]);
    const dialog = await screen.findByRole('dialog', { name: 'Restore version 1?' });
    expect(within(dialog).getByText(/goes back to this version/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));

    const post = await waitFor(() => http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/assets/media-1/restore')));
    expect(post.request.body).toEqual({ fromRevision: 1 });
    post.flush({ uuid: 'media-1', revision: 4 });
    const read = await waitFor(() => http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/media/media-1')));
    read.flush({ ...PHOTO, revision: 4 });
    await settle();

    await waitFor(() => expect(updated).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 })));
    expect(toast).toHaveBeenCalledWith('Restored version 1.', 'success');
  });

  it('keeps the current version when the restore is declined', async () => {
    const { http } = await renderDrawer({ inputs: { tab: 'versions' } });

    fireEvent.click((await screen.findAllByRole('button', { name: /Restore/ }))[0]);
    fireEvent.click(within(await screen.findByRole('dialog', { name: /^Restore version/ })).getByRole('button', { name: 'Cancel' }));

    http.expectNone((r) => r.method === 'POST');
  });

  it('offers no Restore while there are unsaved edits, and says why', async () => {
    const { fixture, settle } = await renderDrawer({ inputs: { tab: 'details' } });
    fireEvent.input(await screen.findByRole('textbox', { name: /^Alt text/ }), { target: { value: 'edited' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-disabled', 'true'));

    fixture.componentRef.setInput('tab', 'versions');
    await settle();

    const restore = (await screen.findAllByRole('button', { name: /Restore/ }))[0];
    expect(restore).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('Processing tab', () => {
  it('says the file is served as it is while processing is off', async () => {
    await renderDrawer({ detail: CSS, inputs: { tab: 'processing' } });

    expect(screen.getByRole('switch', { name: 'Process CMS syntax' })).toHaveAttribute('aria-checked', 'false');
    expect(await screen.findByText('Not processed: the file is served as it is.')).toBeInTheDocument();
  });

  it('shows the findings of a refused switch-on and leaves the switch off', async () => {
    const { http, settle } = await renderDrawer({ detail: CSS, inputs: { tab: 'processing' } });

    fireEvent.click(screen.getByRole('switch', { name: 'Process CMS syntax' }));
    const put = await waitFor(() => http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/media/media-css/process')));
    expect(put.request.body).toEqual({ processCms: true });
    expect(put.request.headers.get('If-Match')).toBe('"rev-5"');
    put.flush(
      { code: 'SF-API-0422', diagnostics: [{ severity: 'ERROR', code: 'SF-TPL-0110', message: 'Unresolvable asset reference: media:beans', line: 4, column: 25 }] },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await settle();

    expect(await screen.findByText('Unresolvable asset reference: media:beans')).toBeInTheDocument();
    expect(screen.getByText('SF-TPL-0110')).toBeInTheDocument();
    expect(screen.getByText('Line 4, column 25')).toBeInTheDocument();
    expect(screen.getByText('1 finding')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Process CMS syntax' })).toHaveAttribute('aria-checked', 'false');
  });

  it('switches processing on and shows the answer’s warnings; Rendered appears', async () => {
    const { http, settle, updated } = await renderDrawer({ detail: CSS, inputs: { tab: 'processing' } });

    fireEvent.click(screen.getByRole('switch', { name: 'Process CMS syntax' }));
    const put = await waitFor(() => http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/process')));
    put.flush({
      media: { ...CSS, revision: 6, processCms: true },
      warnings: [{ severity: 'WARNING', code: 'SF-TPL-0200', message: 'Unused value', line: 2, column: 3 }],
    });
    await settle();

    expect(await screen.findByText('Unused value')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(updated).toHaveBeenCalledWith(expect.objectContaining({ processCms: true }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Process CMS syntax' })).toHaveAttribute('aria-checked', 'true'));
  });

  it('checks the saved text of a processed file when the tab opens', async () => {
    await renderDrawer({
      detail: { ...CSS, processCms: true },
      inputs: { tab: 'processing' },
      answers: { diagnostics: [{ severity: 'WARNING', code: 'SF-TPL-0200', message: 'Checked just now', line: 1, column: 1 }], text: 'a { b: $CMS_VALUE(x)$ }' },
    });

    expect(await screen.findByText('Checked just now')).toBeInTheDocument();
  });
});

describe('Rendered tab', () => {
  it('shows the served output of a processed text file, read-only', async () => {
    await renderDrawer({
      detail: { ...CSS, processCms: true },
      inputs: { tab: 'rendered' },
      answers: { rendered: 'body { color: #6b3f1d; }' },
    });

    const box = await screen.findByRole('textbox', { name: 'Served output of brand.css' });
    expect(box.textContent).toContain('body { color: #6b3f1d; }');
    expect(box).toHaveAttribute('aria-readonly', 'true');
  });
});
