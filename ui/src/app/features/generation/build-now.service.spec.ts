import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../core/ui/toast.service';
import { BuildNowService } from './build-now.service';

type GenerationRequestDto = components['schemas']['GenerationRequestDto'];
type GenerationRunView = components['schemas']['GenerationRunView'];

describe('BuildNowService', () => {
  let http: HttpTestingController;

  afterEach(() => http.verify());

  function setUp(permissions: string[]): { service: BuildNowService; toasts: ToastService } {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideProjectPermissions({ role: () => 'EDITOR', permissions: () => permissions, readOnly: () => false }),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    return { service: TestBed.inject(BuildNowService), toasts: TestBed.inject(ToastService) };
  }

  it('announces a release as a plain success toast without INCREMENTAL_BUILD', () => {
    const { service, toasts } = setUp(['RELEASE']);
    service.announceRelease('proj', 'Released 2 items.');
    expect(toasts.toasts()).toEqual([{ id: 1, message: 'Released 2 items.', kind: 'success' }]);
  });

  it('offers "Build now", starts the incremental build as a release build and links to its progress', () => {
    const { service, toasts } = setUp(['RELEASE', 'INCREMENTAL_BUILD']);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    service.announceRelease('proj', 'Released 2 items.');
    const [announced] = toasts.toasts();
    expect(announced.kind).toBe('success');
    expect(announced.message).toBe('Released 2 items. Build now to put it online.');
    expect(announced.action?.label).toBe('Build now');

    announced.action!.run();
    const request = http.expectOne((r) => r.method === 'POST' && r.url === '/api/v1/projects/proj/generations');
    expect(request.request.body).toEqual({ mode: 'INCREMENTAL', comment: 'Build after release', trigger: 'RELEASE' } satisfies GenerationRequestDto);
    request.flush({ id: 42, mode: 'INCREMENTAL', status: 'QUEUED' } satisfies GenerationRunView);

    const started = toasts.toasts().at(-1)!;
    expect(started.message).toBe('Build #42 started.');
    expect(started.action?.label).toBe('Show progress');
    started.action!.run();
    expect(navigate).toHaveBeenCalledWith(['/p', 'proj', 'publishing', 'runs'], { queryParams: { run: 42 } });
    expect(TestBed.inject(Router).createUrlTree(navigate.mock.calls[0][0], navigate.mock.calls[0][1]).toString()).toBe(
      '/p/proj/publishing/runs?run=42',
    );
  });

  it('starts a quick build as a manual one', () => {
    const { service } = setUp(['INCREMENTAL_BUILD']);
    service.start('proj', 'Build now');
    const request = http.expectOne((r) => r.method === 'POST' && r.url === '/api/v1/projects/proj/generations');
    expect(request.request.body).toEqual({ mode: 'INCREMENTAL', comment: 'Build now', trigger: 'MANUAL' } satisfies GenerationRequestDto);
    request.flush({ id: 43 } satisfies GenerationRunView);
  });
});
