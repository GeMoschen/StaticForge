import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { MediaDetailDrawerComponent } from './media-detail-drawer.component';

const MEDIA = {
  uuid: 'media-1',
  uid: 'media_1',
  displayName: 'Photo',
  revision: 1,
  altText: 'A photo',
  variants: [],
};

describe('MediaDetailDrawerComponent (time travel read-only)', () => {
  let fixture: ComponentFixture<MediaDetailDrawerComponent>;
  let component: MediaDetailDrawerComponent;
  let httpMock: HttpTestingController;
  let timeTravel: TimeTravelStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MediaDetailDrawerComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(MediaDetailDrawerComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    timeTravel = TestBed.inject(TimeTravelStore);

    fixture.componentRef.setInput('projectKey', 'proj1');
    fixture.componentRef.setInput('media', MEDIA);
    fixture.detectChanges();

    // ngOnInit's loadUsages + the preview-load effect fire GETs — drain them, this spec
    // only cares about mutating requests.
    for (const req of httpMock.match(() => true)) {
      req.flush(req.request.responseType === 'blob' ? new Blob() : []);
    }
  });

  afterEach(() => {
    for (const pending of httpMock.match(() => true)) {
      pending.flush(pending.request.responseType === 'blob' ? new Blob() : {});
    }
    httpMock.verify();
  });

  function readOnlyOf(): boolean {
    return (component as unknown as { readOnly: () => boolean }).readOnly();
  }

  function dialogStateOf(): unknown {
    return (component as unknown as { dialog: { state: () => unknown } }).dialog.state();
  }

  it('reflects TimeTravelStore.isTimeTravel()', () => {
    expect(readOnlyOf()).toBe(false);
    timeTravel.enter(5);
    expect(readOnlyOf()).toBe(true);
  });

  it('does not save metadata while time travel is active', () => {
    timeTravel.enter(5);

    component.save();

    httpMock.expectNone((req) => req.method === 'PUT');
  });

  it('does not replace the binary while time travel is active', () => {
    timeTravel.enter(5);
    const input = document.createElement('input');
    input.type = 'file';
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file] });

    component.onReplaceFile({ target: input } as unknown as Event);

    httpMock.expectNone((req) => req.method === 'POST' && req.url.includes('/replace'));
  });

  it('does not open the delete confirmation while time travel is active', () => {
    timeTravel.enter(5);

    component.confirmDelete();

    expect(dialogStateOf()).toBeNull();
  });
});
