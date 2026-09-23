import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../core/api/api.client';
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
    const link = root.querySelector('a.sf-reference__label') as HTMLAnchorElement;
    expect(link.textContent?.trim()).toBe('Leadership');
    expect(link.getAttribute('href')).toBe('/p/acme/content/sets/set-1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(root.querySelector('.sf-reference__type')?.textContent?.trim()).toBe('Team');
    expect(root.querySelector('.sf-reference__meta')?.textContent?.trim()).toBe('12 records');
    expect(root.querySelector('.sf-reference__broken')).toBeNull();
  });

  it('marks a deleted set as a broken reference and still links to it (it can be restored there)', () => {
    const { root } = render(
      { uuid: 'set-1', assetType: 'RECORD_SET' },
      { getRecordSet: () => of({ ...leadership, deleted: true }) },
    );

    expect(root.querySelector('.sf-reference__current--broken')).not.toBeNull();
    expect(root.querySelector('.sf-reference__broken')?.textContent?.trim()).toBe('Deleted');
    expect(root.querySelector('a.sf-reference__label')?.textContent?.trim()).toBe('Leadership');
  });

  it('marks a set that no longer exists as a broken reference without a link', () => {
    const { root } = render({ uuid: 'gone-1', assetType: 'RECORD_SET' }, { getRecordSet: notFound });

    expect(root.querySelector('.sf-reference__broken')?.textContent?.trim()).toBe('Not found');
    expect(root.querySelector('a.sf-reference__label')).toBeNull();
    expect(root.querySelector('.sf-reference__label')?.textContent?.trim()).toBe('gone-1');
    expect(root.querySelector('.sf-reference__meta')).toBeNull();
  });

  it('keeps other failures neutral: the uuid is shown, nothing is claimed broken', () => {
    const { root } = render(
      { uuid: 'set-1', assetType: 'RECORD_SET' },
      { getRecordSet: () => throwError(() => new HttpErrorResponse({ status: 0 })) },
    );

    expect(root.querySelector('.sf-reference__broken')).toBeNull();
    expect(root.querySelector('.sf-reference__label')?.textContent?.trim()).toBe('set-1');
  });

  it('resolves a value without its asset type that turns out to be a set through the set endpoint', () => {
    const { root, getRecordSet } = render(
      { uuid: 'set-1', assetType: null },
      { assetDetail: () => of({ uuid: 'set-1', type: 'RECORD_SET', displayName: 'Leadership' }) },
    );

    expect(getRecordSet).toHaveBeenCalledWith('acme', 'set-1');
    expect(root.querySelector('.sf-reference__meta')?.textContent?.trim()).toBe('12 records');
    expect(root.querySelector('a.sf-reference__label')?.getAttribute('href')).toBe('/p/acme/content/sets/set-1');
  });

  it('marks a missing asset of another type as broken too', () => {
    const { root } = render({ uuid: 'page-9', assetType: 'PAGE' }, { assetDetail: notFound });

    expect(root.querySelector('.sf-reference__broken')?.textContent?.trim()).toBe('Not found');
  });
});
