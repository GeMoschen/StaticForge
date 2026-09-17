import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GenerationService } from './generation.service';

describe('GenerationService build insight', () => {
  let service: GenerationService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [GenerationService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(GenerationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('dry-runs the start request without its idempotency key', () => {
    service
      .planGeneration(
        'proj1',
        { mode: 'INCREMENTAL', targetId: 3, channels: ['html'], idempotencyKey: 'k1' },
        { page: 0, size: 25, rootKind: 'ASSET_CHANGED' },
        true,
      )
      .subscribe();

    const req = httpMock.expectOne((r) => r.url === '/api/v1/projects/proj1/generations/plan');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ mode: 'INCREMENTAL', targetId: 3, channels: ['html'] });
    expect(req.request.headers.has('Idempotency-Key')).toBe(false);
    expect(req.request.params.get('size')).toBe('25');
    expect(req.request.params.get('rootKind')).toBe('ASSET_CHANGED');
    expect(req.request.params.get('validate')).toBe('true');
    req.flush({});
  });

  it('reads a run’s stored plan with its filters', () => {
    service.getRunPlan('proj1', 42, { page: 1, size: 50, channel: 'html', q: 'news' }).subscribe();

    const req = httpMock.expectOne((r) => r.url === '/api/v1/projects/proj1/generations/42/plan');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('channel')).toBe('html');
    expect(req.request.params.get('q')).toBe('news');
    expect(req.request.params.has('rootKind')).toBe(false);
    req.flush({});
  });

  it('reads an asset’s impact', () => {
    service.assetImpact('proj1', 'uuid-1', { page: 0, size: 20 }).subscribe();

    const req = httpMock.expectOne((r) => r.url === '/api/v1/projects/proj1/assets/uuid-1/impact');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('size')).toBe('20');
    req.flush({});
  });
});
