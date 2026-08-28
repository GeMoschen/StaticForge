import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { TemplatesComponent } from './templates.component';

describe('TemplatesComponent (time travel read-only)', () => {
  let fixture: ComponentFixture<TemplatesComponent>;
  let component: TemplatesComponent;
  let httpMock: HttpTestingController;
  let timeTravel: TimeTravelStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TemplatesComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(TemplatesComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    timeTravel = TestBed.inject(TimeTravelStore);

    fixture.componentRef.setInput('projectKey', 'proj1');
    drain();
  });

  afterEach(() => {
    // Drain anything still pending (e.g. a reloadDetail GET fired by a test poking a
    // signal directly) — this spec only asserts that *mutating* requests never fire while
    // read-only, not that every incidental load was consumed inline by each test.
    for (const pending of httpMock.match(() => true)) {
      pending.flush({});
    }
    httpMock.verify();
  });

  function drain(): void {
    fixture.detectChanges();
    for (const req of httpMock.match(() => true)) {
      req.flush({ content: [] });
    }
  }

  function setDetail(value: unknown): void {
    (component as unknown as { detail: { set: (v: unknown) => void } }).detail.set(value);
  }

  function setSelectedUuid(value: string | null): void {
    (component as unknown as { selectedUuid: { set: (v: string | null) => void } }).selectedUuid.set(
      value,
    );
  }

  function readOnlyOf(): boolean {
    return (component as unknown as { readOnly: () => boolean }).readOnly();
  }

  it('reflects TimeTravelStore.isTimeTravel()', () => {
    expect(readOnlyOf()).toBe(false);
    timeTravel.enter(5);
    expect(readOnlyOf()).toBe(true);
    timeTravel.exit();
    expect(readOnlyOf()).toBe(false);
  });

  it('does not save a template definition while time travel is active', () => {
    timeTravel.enter(5);
    setDetail({ uuid: 'tpl-1', revision: 1 });
    setSelectedUuid('tpl-1');
    drain();

    component.saveDefinition();

    httpMock.expectNone((req) => req.method === 'PUT');
  });

  it('does not create a new template while time travel is active', () => {
    timeTravel.enter(5);

    component.submitNewTemplate({ displayName: 'New template' });

    httpMock.expectNone((req) => req.method === 'POST');
  });

  it('does not delete a template while time travel is active', () => {
    timeTravel.enter(5);
    setSelectedUuid('tpl-1');
    drain();

    component.confirmDeleteAction();

    httpMock.expectNone((req) => req.method === 'DELETE');
  });

  it('resumes normal saving once time travel ends', () => {
    timeTravel.enter(5);
    timeTravel.exit();
    setDetail({ uuid: 'tpl-1', revision: 1 });
    setSelectedUuid('tpl-1');
    drain();

    component.saveDefinition();

    const req = httpMock.expectOne((r) => r.method === 'PUT');
    req.flush({ uuid: 'tpl-1', revision: 2 });
  });
});
