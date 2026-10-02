import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../core/api/api.client';
import { DeveloperModeService } from '../../../core/frame/developer-mode.service';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { ContentService, type RecordSetDetailView } from '../../content/content.service';
import type { EditorDefinition } from '../form.model';
import { SfReferenceEditor } from './reference-editor.component';

const setEditor: EditorDefinition = {
  name: 'featured',
  type: 'REFERENCE',
  label: 'Featured members',
  assetTypes: ['RECORD_SET'],
  dataset: 'team',
};

const leadership: RecordSetDetailView = {
  uuid: 'set-1',
  uid: 'leadership',
  displayName: 'Leadership',
  dataset: { uuid: 'ds-1', uid: 'team', displayName: 'Team' },
  recordCount: 12,
  deleted: false,
};

const notFound = () => throwError(() => new HttpErrorResponse({ status: 404 }));

function render(
  value: { uuid: string | null; assetType: string | null },
  stubs: {
    getRecordSet?: () => Observable<RecordSetDetailView>;
    assetDetail?: () => Observable<unknown>;
  } = {},
) {
  const getRecordSet = vi.fn(stubs.getRecordSet ?? (() => of(leadership)));
  const assetDetail = vi.fn(stubs.assetDetail ?? (() => of({ uuid: 'page-1', type: 'PAGE', displayName: 'Home' })));
  TestBed.configureTestingModule({
    imports: [SfReferenceEditor],
    providers: [
      provideTranslocoTesting(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: DeveloperModeService, useValue: { enabled: signal(false) } },
      provideRouter([]),
      { provide: ApiClient, useValue: { assetDetail } },
      { provide: ContentService, useValue: { getRecordSet, listRecordSets: () => of([]) } },
    ],
  });
  const fixture = TestBed.createComponent(SfReferenceEditor);
  fixture.componentRef.setInput('definition', setEditor);
  fixture.componentRef.setInput(
    'control',
    new FormGroup({
      type: new FormControl('ASSET_REF'),
      uuid: new FormControl(value.uuid),
      assetType: new FormControl(value.assetType),
    }),
  );
  fixture.componentRef.setInput('projectKey', 'acme');
  // Twice: the constructor effect that resolves the value only runs after the first pass.
  fixture.detectChanges();
  fixture.detectChanges();
  const root: HTMLElement = fixture.nativeElement;
  return { fixture, root, getRecordSet, assetDetail };
}

describe('SfReferenceEditor with a record set value', () => {
  it('shows the set name as an open link, its dataset and its record count', () => {
    const { root, getRecordSet, assetDetail } = render({ uuid: 'set-1', assetType: 'RECORD_SET' });

    expect(getRecordSet).toHaveBeenCalledWith('acme', 'set-1');
    expect(assetDetail).not.toHaveBeenCalled();
    expect(root.querySelector('.ref__name')?.textContent?.trim()).toBe('Leadership');
    const link = root.querySelector('a.ref__open') as HTMLAnchorElement;
    expect(link.textContent).toContain('Open');
    expect(link.getAttribute('href')).toBe('/p/acme/content/sets/set-1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(root.querySelector('sf-badge')?.textContent?.trim()).toBe('Team');
    expect(root.querySelector('.ref__meta')?.textContent?.trim()).toBe('12 records');
    expect(root.querySelector('.is-broken')).toBeNull();
    // Never the UUID.
    expect(root.textContent).not.toContain('set-1');
  });

  it('marks a deleted set as a broken reference and still links to it (it can be restored there)', () => {
    const { root } = render(
      { uuid: 'set-1', assetType: 'RECORD_SET' },
      { getRecordSet: () => of({ ...leadership, deleted: true }) },
    );

    expect(root.querySelector('.ref__card.is-broken')).not.toBeNull();
    expect(root.querySelector('sf-badge')?.textContent?.trim()).toBe('Deleted');
    expect(root.querySelector('.ref__name')?.textContent?.trim()).toBe('Leadership');
    expect(root.querySelector('a.ref__open')).not.toBeNull();
  });

  it('marks a set that no longer exists as a broken reference without a link', () => {
    const { root } = render({ uuid: 'gone-1', assetType: 'RECORD_SET' }, { getRecordSet: notFound });

    expect(root.querySelector('.ref__name.is-broken')?.textContent?.trim()).toBe('This target no longer exists.');
    expect(root.querySelector('a.ref__open')).toBeNull();
    expect(root.textContent).not.toContain('gone-1');
    expect(root.querySelector('.ref__meta')).toBeNull();
  });

  it('keeps other failures neutral: nothing is claimed broken and no UUID is shown', () => {
    const { root } = render(
      { uuid: 'set-1', assetType: 'RECORD_SET' },
      { getRecordSet: () => throwError(() => new HttpErrorResponse({ status: 0 })) },
    );

    expect(root.querySelector('.is-broken')).toBeNull();
    expect(root.querySelector('.ref__name')?.textContent?.trim()).toBe('The target could not be loaded.');
    expect(root.textContent).not.toContain('set-1');
  });

  it('resolves a value without its asset type that turns out to be a set through the set endpoint', () => {
    const { root, getRecordSet } = render(
      { uuid: 'set-1', assetType: null },
      { assetDetail: () => of({ uuid: 'set-1', type: 'RECORD_SET', displayName: 'Leadership' }) },
    );

    expect(getRecordSet).toHaveBeenCalledWith('acme', 'set-1');
    expect(root.querySelector('.ref__meta')?.textContent?.trim()).toBe('12 records');
    expect(root.querySelector('a.ref__open')?.getAttribute('href')).toBe('/p/acme/content/sets/set-1');
  });

  it('marks a missing asset of another type as broken too', () => {
    const { root } = render({ uuid: 'page-9', assetType: 'PAGE' }, { assetDetail: notFound });

    expect(root.querySelector('.ref__name.is-broken')?.textContent?.trim()).toBe('This target no longer exists.');
  });

  it('shows the target name and where it lives, with Open, Change and Remove, for a page', () => {
    const { root } = render(
      { uuid: 'page-1', assetType: 'PAGE' },
      { assetDetail: () => of({ uuid: 'page-1', type: 'PAGE', displayName: 'Our story', folderPath: '/pages_root/about/team/' }) },
    );

    expect(root.querySelector('.ref__name')?.textContent?.trim()).toBe('Our story');
    expect(root.querySelector('.ref__meta')?.textContent?.trim()).toBe('about › team');
    const buttons = Array.from(root.querySelectorAll('sf-button button')).map(
      (b) => b.getAttribute('aria-label') ?? b.textContent ?? '',
    );
    expect(buttons[0]).toContain('Change');
    expect(buttons[1]).toBe('Remove the target');
    expect(root.querySelector('a.ref__open')?.getAttribute('href')).toBe('/p/acme/pages/page-1');
  });

  it('shows a picked navigation entry by name and opens it in the Navigation screen', () => {
    const { root } = render(
      { uuid: 'ne-1', assetType: 'PAGE_REFERENCE' },
      { assetDetail: () => of({ uuid: 'ne-1', type: 'PAGE_REFERENCE', displayName: 'Shop', folderPath: '/navigation_root/main/' }) },
    );

    expect(root.querySelector('.ref__name')?.textContent?.trim()).toBe('Shop');
    expect(root.querySelector('.ref__meta')?.textContent?.trim()).toBe('main');
    expect(root.querySelector('.ref__icon')?.getAttribute('name') ?? root.querySelector('sf-icon')?.textContent).toBeTruthy();
    expect(root.querySelector('a.ref__open')?.getAttribute('href')).toBe('/p/acme/navigation?asset=ne-1');
    expect(root.textContent).not.toContain('ne-1');
  });

  it('shows a loading state while the target is looked up', () => {
    const { root } = render({ uuid: 'page-1', assetType: 'PAGE' }, { assetDetail: () => new Observable(() => undefined) });
    expect(root.querySelector('.ref__name.is-loading')?.textContent?.trim()).toBe('Loading…');
  });

  it('clears the target with Remove and offers Choose again', () => {
    const { root, fixture } = render({ uuid: 'page-1', assetType: 'PAGE' });
    const remove = Array.from(root.querySelectorAll('sf-button button')).find(
      (b) => b.getAttribute('aria-label') === 'Remove the target',
    ) as HTMLButtonElement;
    remove.click();
    fixture.detectChanges();
    expect(root.querySelector('.ref__none')?.textContent?.trim()).toBe('Nothing chosen yet.');
    expect(root.querySelector('sf-button')?.textContent).toContain('Choose…');
  });

  it('says "This field is required" for an empty required field, and only once', () => {
    const { root, fixture } = render({ uuid: null, assetType: null });
    fixture.componentRef.setInput('definition', { ...setEditor, required: true });
    fixture.detectChanges();
    expect(root.textContent?.match(/This field is required/g) ?? []).toHaveLength(1);
  });
});
