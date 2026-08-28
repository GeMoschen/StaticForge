import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { NavFolderDetailComponent } from './nav-folder-detail.component';

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
      providers: [provideHttpClient(), provideHttpClientTesting()],
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
