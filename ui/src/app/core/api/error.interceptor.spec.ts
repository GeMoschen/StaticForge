import '@angular/compiler';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectContextStore } from '../project/project-context.store';
import { ALL_PUBLISH_PERMISSIONS, projectDetail } from '../project/testing/project-detail.fixture';
import { ToastService } from '../ui/toast.service';
import { errorInterceptor } from './error.interceptor';

/** A `403` as the API sends it for a publish permission (M28, epic decision 6). */
const DENIED = {
  type: 'https://cms.example.com/problems/sf-api-0403',
  title: 'Forbidden',
  status: 403,
  detail: "You need the RELEASE permission for this; the project's publish policy decides which editors hold it.",
  code: 'SF-API-0403',
  permission: 'RELEASE',
};

describe('errorInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let toasts: ToastService;
  let context: ProjectContextStore;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([errorInterceptor])), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    toasts = TestBed.inject(ToastService);
    context = TestBed.inject(ProjectContextStore);
    context.activeProjectKey.set('proj');
    context.project.set(projectDetail(['RELEASE'], ['RELEASE']));
  });

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
  });

  it('on a 403 naming a permission, re-reads the project detail and says once what the user can no longer do', () => {
    let failed = false;
    http.post('/api/v1/projects/proj/releases', {}).subscribe({ error: () => (failed = true) });
    httpMock.expectOne('/api/v1/projects/proj/releases').flush(DENIED, { status: 403, statusText: 'Forbidden' });

    expect(failed).toBe(true);
    expect(toasts.toasts().map((t) => [t.kind, t.message])).toEqual([
      ['error', 'You no longer have permission to release, discard or unpublish content.'],
    ]);
    // The policy changed under the open app: the controls follow the refreshed permissions.
    httpMock.expectOne('/api/v1/projects/proj').flush(projectDetail([], []));
    expect(context.project()?.permissions).toEqual([]);
  });

  it('names role-only denials too', () => {
    http.post('/api/v1/projects/proj/generations/1/promote', {}).subscribe({ error: () => undefined });
    httpMock
      .expectOne('/api/v1/projects/proj/generations/1/promote')
      .flush({ ...DENIED, permission: 'ROLE:DEVELOPER' }, { status: 403, statusText: 'Forbidden' });

    expect(toasts.toasts()[0].message).toBe('You no longer have permission to do this — it needs a developer.');
    httpMock.expectOne('/api/v1/projects/proj').flush(projectDetail(ALL_PUBLISH_PERMISSIONS));
  });

  it('leaves any other error as it was: the problem detail, no refresh', () => {
    http.post('/api/v1/projects/proj/pages', {}).subscribe({ error: () => undefined });
    httpMock
      .expectOne('/api/v1/projects/proj/pages')
      .flush({ ...DENIED, permission: undefined, detail: 'Insufficient role for this project.' }, { status: 403, statusText: 'Forbidden' });

    expect(toasts.toasts()[0].message).toBe('Insufficient role for this project.');
    httpMock.expectNone('/api/v1/projects/proj');
  });
});
