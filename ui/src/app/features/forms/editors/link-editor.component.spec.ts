import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../core/api/api.client';
import { DeveloperModeService } from '../../../core/frame/developer-mode.service';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { EditingLocaleStore } from '../../../core/project/editing-locale.store';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { ContentService } from '../../content/content.service';
import type { EditorChrome } from '../editor-base';
import type { EditorDefinition } from '../form.model';
import { SfLinkEditor } from './link-editor.component';

const definition: EditorDefinition = { name: 'cta', type: 'LINK', label: 'Call to action' };
const PAGE = '0b9c3a8e-1d2f-4c5b-9a7e-6f1d2c3b4a5e';

function linkGroup(value: Partial<Record<string, string | null>> = {}): FormGroup {
  return new FormGroup({
    kind: new FormControl(value['kind'] ?? 'INTERNAL'),
    uuid: new FormControl(value['uuid'] ?? null),
    url: new FormControl(value['url'] ?? null),
    anchor: new FormControl(value['anchor'] ?? null),
    target: new FormControl(value['target'] ?? null),
    title: new FormControl(value['title'] ?? null),
  });
}

async function setup(options: { control?: FormGroup; def?: EditorDefinition; chrome?: EditorChrome | null; assetDetail?: ReturnType<typeof vi.fn>; listAssets?: ReturnType<typeof vi.fn> } = {}) {
  const control = options.control ?? linkGroup();
  const assetDetail = options.assetDetail ?? vi.fn().mockReturnValue(of({ uuid: PAGE, type: 'PAGE', displayName: 'Our story', folderPath: '/pages_root/about/' }));
  const listAssets = options.listAssets ?? vi.fn().mockReturnValue(of({ content: [] }));
  const view = await render(SfLinkEditor, {
    componentInputs: { definition: options.def ?? definition, control, projectKey: 'acme', chrome: options.chrome ?? null },
    providers: [
      provideTranslocoTesting(),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ApiClient, useValue: { assetDetail, listAssets } },
      { provide: ContentService, useValue: {} },
      { provide: ProjectContextStore, useValue: { pageFolderTree: () => [], mediaFolderTree: () => [] } },
      { provide: DeveloperModeService, useValue: { enabled: signal(false) } },
      { provide: EditingLocaleStore, useValue: { locale: signal<string | null>(null) } },
    ],
  });
  return { ...view, control, assetDetail, listAssets };
}

describe('SfLinkEditor', () => {
  it('names a page target by its name and place, with Open, Change and Remove — never its UUID', async () => {
    const { assetDetail } = await setup({ control: linkGroup({ kind: 'INTERNAL', uuid: PAGE }) });

    expect(await screen.findByText('Our story')).toBeTruthy();
    expect(screen.getByText('about')).toBeTruthy();
    expect(assetDetail).toHaveBeenCalledWith('acme', PAGE);
    expect(document.body.textContent).not.toContain(PAGE);
    expect(screen.getByRole('link', { name: /Open/ }).getAttribute('href')).toBe('/p/acme/pages/' + PAGE);
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove the link' })).toBeTruthy();
  });

  it('shows a loading state, and says so when the page no longer exists', async () => {
    await setup({ control: linkGroup({ kind: 'INTERNAL', uuid: PAGE }), assetDetail: vi.fn().mockReturnValue(throwError(() => new Error('404'))) });
    expect(await screen.findByText('The linked page or file no longer exists.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Open/ })).toBeNull();
  });

  it('shows a web address with its title and opens it in a new tab', async () => {
    await setup({ control: linkGroup({ kind: 'EXTERNAL', url: 'https://example.com/docs', title: 'Docs' }) });
    expect(screen.getByText('Docs')).toBeTruthy();
    expect(screen.getByText('https://example.com/docs')).toBeTruthy();
    const open = screen.getByRole('link', { name: /Open/ });
    expect(open.getAttribute('href')).toBe('https://example.com/docs');
    expect(open.getAttribute('target')).toBe('_blank');
  });

  it('swaps the fields when another link kind is selected', async () => {
    const { control } = await setup({ control: linkGroup({ kind: 'INTERNAL', uuid: PAGE }) });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(await screen.findByRole('button', { name: 'Choose a page…' })).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Web address' }));

    expect(await screen.findByRole('textbox', { name: 'Web address' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Choose a page…' })).toBeNull();
    expect(control.value.kind).toBe('EXTERNAL');
  });

  it("clears the old kind's destination and keeps only what the new kind shows", async () => {
    const control = linkGroup({ kind: 'EXTERNAL', url: 'https://example.com', target: '_blank', title: 'Docs' });
    await setup({ control });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));

    fireEvent.click(await screen.findByRole('radio', { name: 'E-mail' }));

    expect(control.getRawValue()).toEqual({ kind: 'MAIL', uuid: null, url: null, anchor: null, target: null, title: 'Docs' });
    expect(control.dirty).toBe(true);
  });

  it('writes the address, the title and "Open in a new tab" to the control', async () => {
    const control = linkGroup({ kind: 'EXTERNAL' });
    await setup({ control });
    fireEvent.click(screen.getByRole('button', { name: 'Choose target' }));

    fireEvent.input(await screen.findByRole('textbox', { name: 'Web address' }), { target: { value: 'https://example.org' } });
    fireEvent.input(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Org' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Open in a new tab' }));

    expect(control.getRawValue()).toMatchObject({ url: 'https://example.org', title: 'Org', target: '_blank' });
  });

  it('picks a page with the shared asset picker and shows its name', async () => {
    const listAssets = vi.fn().mockReturnValue(of({ content: [{ uuid: PAGE, uid: 'our_story', displayName: 'Our story', type: 'PAGE', folderPath: '/pages_root/about/' }] }));
    const { control } = await setup({ control: linkGroup({ kind: 'INTERNAL' }), listAssets });
    fireEvent.click(screen.getByRole('button', { name: 'Choose target' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a page…' }));

    const dialog = await screen.findByRole('dialog');
    expect(listAssets).toHaveBeenCalledWith('acme', expect.objectContaining({ type: 'PAGE' }));
    fireEvent.click(await within(dialog).findByRole('option', { name: /Our story/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose' }));

    expect(control.value.uuid).toBe(PAGE);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getAllByText('Our story').length).toBeGreaterThan(0);
  });

  it('removes the destination but keeps the kind', async () => {
    const { control } = await setup({ control: linkGroup({ kind: 'EXTERNAL', url: 'https://example.com' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Remove the link' }));
    expect(control.getRawValue()).toMatchObject({ kind: 'EXTERNAL', url: null });
    expect(await screen.findByText('Nothing linked yet.')).toBeTruthy();
  });

  it('follows a value set on the control from outside', async () => {
    const control = linkGroup({ kind: 'INTERNAL', uuid: PAGE });
    const { fixture } = await setup({ control });

    control.patchValue({ kind: 'MAIL', uuid: null, url: 'hi@example.com' });
    fixture.detectChanges();

    expect(await screen.findByText('hi@example.com')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open/ }).getAttribute('href')).toBe('mailto:hi@example.com');
  });

  it('says "This field is required" once for an empty required link, with no controls in a read-only one', async () => {
    await setup({ control: linkGroup({ kind: 'EXTERNAL' }), def: { ...definition, required: true, readOnly: true } });
    expect(await screen.findAllByText(/This field is required/)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Choose target' })).toBeNull();
  });

  it('shows the findings and the language chip of the form', async () => {
    await setup({ chrome: { tags: [{ label: 'All languages', icon: 'public' }], findings: [{ level: 'info', message: 'Used on the home page.' }], required: false } });
    expect(screen.getByText('All languages')).toBeTruthy();
    expect(screen.getByText('Used on the home page.')).toBeTruthy();
  });
});
