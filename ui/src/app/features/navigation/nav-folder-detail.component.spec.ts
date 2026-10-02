import '@angular/compiler';
import { provideFavoritesStub } from '../../core/assets/testing/favorites.testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { NavFolderDetailComponent } from './nav-folder-detail.component';
import { NavigationService, type NavTreeView } from './navigation.service';
import { stubReleaseBar } from '../release/testing/release-bar.stub';

const FOLDER = {
  uuid: 'folder-1',
  uid: 'folder_1',
  displayName: 'Section',
  revision: 1,
  protectedFolder: false,
};

describe('NavFolderDetailComponent (time travel read-only)', () => {
  let fixture: ComponentFixture<NavFolderDetailComponent>;
  let component: NavFolderDetailComponent;
  let httpMock: HttpTestingController;
  let timeTravel: TimeTravelStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NavFolderDetailComponent],
      providers: [provideFavoritesStub(), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(NavFolderDetailComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    timeTravel = TestBed.inject(TimeTravelStore);

    fixture.componentRef.setInput('projectKey', 'proj1');
    fixture.componentRef.setInput('folder', FOLDER);
    fixture.detectChanges();
  });

  afterEach(() => {
    for (const pending of httpMock.match(() => true)) {
      pending.flush({});
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

  it('does not rename the folder while time travel is active', () => {
    timeTravel.enter(5);
    (component as unknown as { nameDraft: { set: (v: string) => void } }).nameDraft.set('New name');

    (component as unknown as { saveName: () => void }).saveName();

    httpMock.expectNone((req) => req.method === 'PUT');
  });

  it('does not delete the folder while time travel is active', () => {
    timeTravel.enter(5);

    (component as unknown as { requestDelete: () => void }).requestDelete();

    httpMock.expectNone((req) => req.method === 'DELETE');
  });
});

describe('NavFolderDetailComponent (undo)', () => {
  const lastToast = () => TestBed.inject(ToastService).toasts().at(-1)!;

  function setup(options: { children?: NavTreeView[]; restore?: unknown } = {}) {
    stubReleaseBar(NavFolderDetailComponent);
    const nav = {
      deleteFolder: vi.fn().mockReturnValue(of(undefined)),
      renameFolder: vi.fn().mockReturnValue(of({ revision: 4 })),
    };
    const api = { restoreFolder: vi.fn().mockReturnValue(options.restore ?? of({})) };
    const confirms = { confirm: vi.fn().mockResolvedValue(true) };
    TestBed.configureTestingModule({
      imports: [NavFolderDetailComponent],
      providers: [provideFavoritesStub(), 
        { provide: NavigationService, useValue: nav },
        { provide: ApiClient, useValue: api },
        { provide: ConfirmService, useValue: confirms },
      ],
    });
    const fixture = TestBed.createComponent(NavFolderDetailComponent);
    fixture.componentRef.setInput('projectKey', 'proj1');
    fixture.componentRef.setInput('folder', FOLDER);
    fixture.componentRef.setInput('children', options.children ?? []);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      requestDelete: () => Promise<void>;
      nameDraft: { set: (v: string) => void };
      saveName: () => void;
    };
    return { nav, api, confirms, component };
  }

  it('deletes after a danger confirmation and offers Undo that restores the folder with its subtree', async () => {
    const { nav, api, confirms, component } = setup();

    await component.requestDelete();

    expect(nav.deleteFolder).toHaveBeenCalledWith('proj1', 'folder-1', true);
    const options = confirms.confirm.mock.calls[0][0];
    expect(options.tone).toBe('danger');
    expect(options.irreversible).toBeUndefined();
    expect(options.typeToConfirm).toBeUndefined();
    expect(lastToast().message).toBe('Deleted “Section”.');

    lastToast().action!.run();
    await vi.waitFor(() => expect(api.restoreFolder).toHaveBeenCalledWith('proj1', 'folder-1'));
  });

  it('asks for the typed word when 25 or more entries are deleted together', async () => {
    const children = Array.from({ length: 24 }, (_, i) => ({ uuid: `c${i}`, type: 'PAGE_REFERENCE' }));
    const { confirms, component } = setup({ children });

    await component.requestDelete();

    expect(confirms.confirm.mock.calls[0][0].typeToConfirm).toBe('delete');
  });

  it('shows the error toast when the restore fails', async () => {
    const { component } = setup({ restore: throwError(() => new Error('409')) });

    await component.requestDelete();
    lastToast().action!.run();

    await vi.waitFor(() => expect(lastToast().kind).toBe('error'));
    expect(lastToast().message).toMatch(/Could not undo/);
  });

  it('offers Undo for a rename that renames back with the etag of the revision the rename produced', async () => {
    const { nav, component } = setup();

    component.nameDraft.set('Chapter');
    component.saveName();

    expect(nav.renameFolder).toHaveBeenCalledWith('proj1', 'folder-1', 'Chapter', expect.any(String));
    expect(lastToast().message).toBe('Renamed “Section” to “Chapter”.');
    lastToast().action!.run();
    await vi.waitFor(() => expect(nav.renameFolder).toHaveBeenCalledTimes(2));
    expect(nav.renameFolder).toHaveBeenLastCalledWith('proj1', 'folder-1', 'Section', '"rev-4"');
  });
});
