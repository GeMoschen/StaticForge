import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SKIP_ERROR_TOAST } from '../../core/api/error.interceptor';
import { ToastService } from '../../core/ui/toast.service';
import { SearchService, type LiveQuery, type LiveSearchState } from './search.service';
import type { SearchResultView } from './search.util';

const EMPTY: SearchResultView = {
  content: [],
  page: { size: 20, number: 0, totalElements: 0, totalPages: 0, totalIsLowerBound: false },
  facets: { types: {} },
  latestRevision: 3,
  indexedRevision: 3,
};

describe('SearchService', () => {
  let service: SearchService;
  let http: HttpTestingController;
  let toasts: ToastService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [SearchService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SearchService);
    http = TestBed.inject(HttpTestingController);
    toasts = TestBed.inject(ToastService);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('sends repeatable type filters, folder and paging, and handles its own errors', () => {
    service.search('acme', { q: 'teaser', types: ['PAGE', 'MEDIA'], folder: '/pages_root/', page: 2, size: 10 }).subscribe();

    const req = http.expectOne((r) => r.url === '/api/v1/projects/acme/search');
    expect(req.request.params.get('q')).toBe('teaser');
    expect(req.request.params.getAll('type')).toEqual(['PAGE', 'MEDIA']);
    expect(req.request.params.get('folder')).toBe('/pages_root/');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('size')).toBe('10');
    expect(req.request.context.get(SKIP_ERROR_TOAST)).toBe(true);
    req.flush(EMPTY);
  });

  it('cancels the in-flight request when the input changes, so fast typing never queues requests', () => {
    const input = new Subject<LiveQuery>();
    const states: LiveSearchState[] = [];
    service.live(input, 150).subscribe((state) => states.push(state));

    input.next({ projectKey: 'acme', q: 'te' });
    vi.advanceTimersByTime(150);
    const first = http.expectOne((r) => r.params.get('q') === 'te');

    input.next({ projectKey: 'acme', q: 'tea' });
    input.next({ projectKey: 'acme', q: 'teas' });
    // Within the debounce window nothing new is sent, and the older request is still open.
    vi.advanceTimersByTime(100);
    expect(first.cancelled).toBe(false);
    input.next({ projectKey: 'acme', q: 'teaser' });
    vi.advanceTimersByTime(150);

    expect(first.cancelled).toBe(true);
    const second = http.expectOne((r) => r.params.get('q') === 'teaser');
    expect(second.request.params.get('size')).toBe('20');
    http.expectNone((r) => r.params.get('q') === 'tea' || r.params.get('q') === 'teas');
    second.flush(EMPTY);

    expect(states.map((s) => s.kind)).toEqual(['loading', 'loading', 'results']);
    expect(states[2]).toMatchObject({ kind: 'results', q: 'teaser' });
  });

  it('does not call the API outside a project or for input too short to search', () => {
    const input = new Subject<LiveQuery>();
    const states: LiveSearchState[] = [];
    service.live(input, 0).subscribe((state) => states.push(state));

    input.next({ projectKey: null, q: 'teaser' });
    vi.advanceTimersByTime(1);
    input.next({ projectKey: 'acme', q: 't' });
    vi.advanceTimersByTime(1);
    http.expectNone(() => true);

    input.next({ projectKey: 'acme', q: '7' });
    vi.advanceTimersByTime(1);
    expect(states.map((s) => s.kind)).toEqual(['no-project', 'idle', 'loading']);
    http.expectOne((r) => r.params.get('q') === '7').flush(EMPTY);
  });

  it('reports an unavailable index in place and toasts other failures', () => {
    const show = vi.spyOn(toasts, 'show');
    const input = new Subject<LiveQuery>();
    const states: LiveSearchState[] = [];
    service.live(input, 0).subscribe((state) => states.push(state));

    input.next({ projectKey: 'acme', q: 'down' });
    vi.advanceTimersByTime(1);
    http
      .expectOne((r) => r.params.get('q') === 'down')
      .flush({ code: 'SF-SEARCH-0503', title: 'Search Unavailable' }, { status: 503, statusText: 'Unavailable' });
    expect(states.at(-1)?.kind).toBe('unavailable');
    expect(show).not.toHaveBeenCalled();

    input.next({ projectKey: 'acme', q: 'boom' });
    vi.advanceTimersByTime(1);
    http
      .expectOne((r) => r.params.get('q') === 'boom')
      .flush({ detail: 'Parameter q is too long.' }, { status: 400, statusText: 'Bad Request' });
    expect(states.at(-1)?.kind).toBe('error');
    expect(show).toHaveBeenCalledWith('Parameter q is too long.', 'error');
  });

  it('posts a reindex and reads the status', () => {
    service.reindex('acme').subscribe();
    const post = http.expectOne('/api/v1/projects/acme/search/reindex');
    expect(post.request.method).toBe('POST');
    post.flush({ state: 'REBUILDING', latestRevision: 4, lag: 0 });

    service.status('acme').subscribe();
    http.expectOne('/api/v1/projects/acme/search/status').flush({ state: 'READY', latestRevision: 4, lag: 0 });
  });
});
