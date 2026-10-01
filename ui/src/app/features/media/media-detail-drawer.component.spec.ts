import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
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

    expect(document.querySelector('sf-confirm-dialog')).toBeNull();
  });
});

describe('MediaDetailDrawerComponent (delete confirmation)', () => {
  it('asks only once the usages are known, and then asks for DELETE when the file is referenced', async () => {
    TestBed.configureTestingModule({
      imports: [MediaDetailDrawerComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(MediaDetailDrawerComponent);
    const httpMock = TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('projectKey', 'proj1');
    fixture.componentRef.setInput('media', MEDIA);
    fixture.detectChanges();
    const usagesRequest = httpMock.expectOne((req) => req.url.endsWith('/usages'));

    // Usages still loading: no confirmation yet (it couldn't know whether to ask for DELETE).
    fixture.componentInstance.confirmDelete();
    expect(document.querySelector('sf-confirm-dialog')).toBeNull();

    usagesRequest.flush([{ fromUuid: 'page-1', fromUid: 'home', fromType: 'PAGE' }]);
    fixture.detectChanges();
    fixture.componentInstance.confirmDelete();
    expect(await screen.findByRole('textbox', { name: 'Type DELETE to confirm' })).toBeInTheDocument();
    expect(screen.getByText('home (PAGE)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    for (const pending of httpMock.match(() => true)) {
      pending.flush(pending.request.responseType === 'blob' ? new Blob() : []);
    }
  });
});

describe('MediaDetailDrawerComponent (metadata form)', () => {
  const OTHER = { uuid: 'media-2', uid: 'media_2', displayName: 'Other', revision: 3, altText: 'Another photo', caption: 'Cap', variants: [] };

  async function renderDrawer() {
    const result = await render(MediaDetailDrawerComponent, {
      componentInputs: { projectKey: 'proj1', media: MEDIA as never },
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const drain = () => {
      for (const req of http.match(() => true)) {
        if (req.request.method === 'PUT') {
          req.flush({ ...MEDIA, revision: 2, altText: 'Changed' });
        } else {
          req.flush(req.request.responseType === 'blob' ? new Blob() : []);
        }
      }
    };
    drain();
    return { ...result, http, drain };
  }

  const saveButton = () => screen.getByRole('button', { name: 'Save metadata' }) as HTMLButtonElement;

  it('shows the alt text of the file and offers "Save metadata" only once something changed', async () => {
    await renderDrawer();

    expect((screen.getByPlaceholderText('Descriptive alt text') as HTMLInputElement).value).toBe('A photo');
    expect(saveButton().disabled).toBe(true);

    fireEvent.input(screen.getByPlaceholderText('Descriptive alt text'), { target: { value: 'A better photo' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
  });

  it('is settled again after a save', async () => {
    const { drain } = await renderDrawer();
    fireEvent.input(screen.getByPlaceholderText('Descriptive alt text'), { target: { value: 'Changed' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    saveButton().click();
    drain();

    await waitFor(() => expect(saveButton().disabled).toBe(true));
  });

  it('shows the metadata of another file when the library reuses the drawer for it', async () => {
    const { rerender, drain } = await renderDrawer();
    fireEvent.input(screen.getByPlaceholderText('Descriptive alt text'), { target: { value: 'unsaved' } });

    await rerender({ componentInputs: { projectKey: 'proj1', media: OTHER as never } });
    drain();

    await waitFor(() =>
      expect((screen.getByPlaceholderText('Descriptive alt text') as HTMLInputElement).value).toBe('Another photo'),
    );
    expect((screen.getByPlaceholderText('Optional caption') as HTMLInputElement).value).toBe('Cap');
    await waitFor(() => expect(saveButton().disabled).toBe(true));
  });
});
