import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
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
import { SfMediaEditor } from './media-editor.component';

const definition: EditorDefinition = { name: 'image', type: 'MEDIA', label: 'Image' };
const UUID = '0b9c3a8e-1d2f-4c5b-9a7e-6f1d2c3b4a5e';

const image = {
  uuid: UUID,
  uid: 'harvest',
  displayName: 'harvest.jpg',
  sizeBytes: 980 * 1024,
  image: { width: 2400, height: 1350 },
};

function group(uuid: string | null = null, alt: string | null = null): FormGroup {
  return new FormGroup({ type: new FormControl('MEDIA_REF'), uuid: new FormControl(uuid), altOverride: new FormControl(alt) });
}

async function setup(options: {
  control?: FormGroup;
  dev?: boolean;
  chrome?: EditorChrome | null;
  def?: EditorDefinition;
  mediaDetail?: ReturnType<typeof vi.fn>;
  listAssets?: ReturnType<typeof vi.fn>;
} = {}) {
  const control = options.control ?? group();
  const mediaDetail = options.mediaDetail ?? vi.fn().mockReturnValue(of(image));
  const listAssets = options.listAssets ?? vi.fn().mockReturnValue(of({ content: [] }));
  const view = await render(SfMediaEditor, {
    componentInputs: { definition: options.def ?? definition, control, projectKey: 'acme', chrome: options.chrome ?? null },
    providers: [
      provideTranslocoTesting(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ApiClient, useValue: { mediaDetail, listAssets, mediaThumbnailBlob: () => throwError(() => new Error('no thumbnails in tests')) } },
      { provide: ContentService, useValue: {} },
      { provide: ProjectContextStore, useValue: { pageFolderTree: () => [], mediaFolderTree: () => [] } },
      { provide: DeveloperModeService, useValue: { enabled: signal(options.dev ?? false) } },
      { provide: EditingLocaleStore, useValue: { locale: signal<string | null>(null) } },
    ],
  });
  return { ...view, control, mediaDetail, listAssets };
}

describe('SfMediaEditor', () => {
  it('shows a drop zone with Choose while nothing is chosen, and no UUID input', async () => {
    await setup();
    expect(screen.getByText('Drop a file here or choose one from the library.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose' })).toBeTruthy();
    expect(document.querySelector('input[placeholder="Media UUID"]')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('picks the media from the shared asset picker and fills the control', async () => {
    const listAssets = vi.fn().mockReturnValue(of({ content: [{ uuid: UUID, uid: 'harbour_png', displayName: 'harbour.png', type: 'MEDIA', folderPath: '/media_root/photos/' }] }));
    const { control } = await setup({ listAssets });

    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
    const row = await screen.findByRole('option', { name: /harbour\.png/ });
    expect(listAssets).toHaveBeenCalledWith('acme', expect.objectContaining({ type: 'MEDIA' }));
    fireEvent.click(row);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Choose' }));

    expect(control.value.uuid).toBe(UUID);
    expect(control.dirty).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows the thumbnail card with name, size and dimensions, and the alt text field', async () => {
    await setup({ control: group(UUID, 'Beans on a bed') });
    expect(await screen.findByText('harvest.jpg')).toBeTruthy();
    expect(screen.getByText('2400 × 1350 · 980 KB')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove the file' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: /Alternative text/ }) as HTMLInputElement).value).toBe('Beans on a bed');
    expect(screen.queryByText(/Add alternative text/)).toBeNull();
  });

  it('warns while an image has no alternative text, and writes what is typed to the control', async () => {
    const { control } = await setup({ control: group(UUID) });
    expect(await screen.findByText(/Add alternative text/)).toBeTruthy();

    fireEvent.input(screen.getByRole('textbox', { name: /Alternative text/ }), { target: { value: 'A bed of coffee' } });
    expect(control.value.altOverride).toBe('A bed of coffee');
    await waitFor(() => expect(screen.queryByText(/Add alternative text/)).toBeNull());
  });

  it('shows the UUID only in developer mode, copyable', async () => {
    await setup({ control: group(UUID) });
    await screen.findByText('harvest.jpg');
    expect(screen.queryByText(UUID)).toBeNull();
  });

  it('shows the UUID in developer mode', async () => {
    await setup({ control: group(UUID), dev: true });
    expect(await screen.findByText(UUID)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copy UUID/ })).toBeTruthy();
  });

  it('removes the file and its alt text', async () => {
    const { control } = await setup({ control: group(UUID, 'x') });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove the file' }));
    expect(control.value.uuid).toBeNull();
    expect(control.value.altOverride).toBeNull();
    expect(await screen.findByText('Drop a file here or choose one from the library.')).toBeTruthy();
  });

  it('says so when the chosen file no longer exists', async () => {
    await setup({ control: group(UUID), mediaDetail: vi.fn().mockReturnValue(throwError(() => new Error('404'))) });
    expect(await screen.findByText('This file no longer exists.')).toBeTruthy();
  });

  it('is read-only without actions or an alt input', async () => {
    await setup({ control: group(UUID), def: { ...definition, readOnly: true } });
    await screen.findByText('harvest.jpg');
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull();
    expect((screen.getByRole('textbox', { name: /Alternative text/ }) as HTMLInputElement).readOnly).toBe(true);
  });

  it('says "This field is required" once for an empty required field, and not again when a rule says it', async () => {
    await setup({ def: { ...definition, required: true } });
    expect(await screen.findAllByText(/This field is required/)).toHaveLength(1);
  });

  it('shows the form findings and the language chip through the chrome', async () => {
    await setup({
      chrome: { tags: [{ label: 'English', icon: 'translate' }], findings: [{ level: 'warning', message: 'Pick a larger image.' }], required: false },
    });
    expect(screen.getByText('English')).toBeTruthy();
    expect(screen.getByText('Pick a larger image.')).toBeTruthy();
  });
});
