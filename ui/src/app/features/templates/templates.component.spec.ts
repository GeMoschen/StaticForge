import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { TemplatesComponent } from './templates.component';

/**
 * The store page loads a couple of bare-array endpoints (`/channels`, `/datasets`) alongside the
 * paged folder listings, so a blanket `flush({ content: [] })` hands `.map`/`.filter` an object.
 */
function emptyBodyFor(url: string, paged: object = { content: [] }): object {
  return url.endsWith('/channels') || url.endsWith('/datasets') ? [] : paged;
}

describe('TemplatesComponent (time travel read-only)', () => {
  let fixture: ComponentFixture<TemplatesComponent>;
  let component: TemplatesComponent;
  let httpMock: HttpTestingController;
  let timeTravel: TimeTravelStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TemplatesComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
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
      pending.flush(emptyBodyFor(pending.request.url, {}));
    }
    httpMock.verify();
  });

  function drain(): void {
    fixture.detectChanges();
    for (const req of httpMock.match(() => true)) {
      req.flush(emptyBodyFor(req.request.url));
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

describe('TemplatesComponent (inheritance, M20.4.1)', () => {
  let fixture: ComponentFixture<TemplatesComponent>;
  let component: TemplatesComponent;
  let httpMock: HttpTestingController;

  const ARTICLE = {
    uuid: 'a-3',
    uid: 'article',
    assetType: 'PAGE_TEMPLATE',
    revision: 7,
    abstract: false,
    contentDefinition: '',
    channelTemplates: { html: { source: '$CMS_EXTENDS(page_template:docs_layout)$' } },
    ancestors: [
      { uuid: 'a-2', uid: 'docs_layout' },
      { uuid: 'a-1', uid: 'base' },
    ],
    inheritedFrom: { editors: { title: 'base', subtitle: 'docs_layout' }, bodies: { main: 'base' } },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TemplatesComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(TemplatesComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('projectKey', 'proj1');
    flushAll({ content: [] });
  });

  afterEach(() => {
    for (const pending of httpMock.match(() => true)) {
      pending.flush(emptyBodyFor(pending.request.url, {}));
    }
  });

  function flushAll(body: object): void {
    fixture.detectChanges();
    for (const req of httpMock.match(() => true)) {
      req.flush(emptyBodyFor(req.request.url, body));
    }
  }

  function selectArticle(): void {
    component.select('a-3');
    fixture.detectChanges();
    httpMock.match((r) => r.url.endsWith('/page-templates/a-3')).forEach((r) => r.flush(ARTICLE));
    httpMock.match((r) => r.url.endsWith('/usages')).forEach((r) => r.flush([]));
    fixture.detectChanges();
  }

  it('shows the three-level chain as a breadcrumb and inherited editors grouped by ancestor', () => {
    selectArticle();
    expect(component.breadcrumb().map((c) => c.uid)).toEqual(['base', 'docs_layout', 'article']);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Inherited');
    expect(component.inheritedGroups().map((g) => [g.uid, g.editors])).toEqual([
      ['base', ['title']],
      ['docs_layout', ['subtitle']],
    ]);
  });

  it('sends the abstract flag and shows the page count when the template is in use', () => {
    selectArticle();
    component.onAbstractChange({ target: { checked: true } } as unknown as Event);
    component.saveDefinition();
    const put = httpMock.expectOne((r) => r.method === 'PUT');
    expect((put.request.body as { abstract?: boolean }).abstract).toBe(true);
    put.flush(
      { code: 'SF-DOM-0122', pageCount: 2, pageUids: ['one', 'two'], pageUuids: ['p1', 'p2'], detail: 'in use' },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    expect(component.templateInUse()?.pageCount).toBe(2);
  });

  it('renders live OCTL diagnostics from the context-aware validate endpoint', async () => {
    vi.useFakeTimers();
    try {
      selectArticle();
      component.onChannelInput({ target: { value: '$CMS_EXTENDS(page_template:base)$$CMS_BLOCK(contnet)$$CMS_END_BLOCK$' } } as unknown as Event);
      vi.advanceTimersByTime(350);
      const validate = httpMock.expectOne((r) => r.url.endsWith('/octl/validate'));
      expect((validate.request.body as { templateUuid?: string }).templateUuid).toBe('a-3');
      validate.flush({ diagnostics: [{ severity: 'WARNING', code: 'SF-TPL-0157', message: "did you mean 'content'?", line: 1, column: 34 }] });
      expect(component.octlDiagnostics().map((d) => d.code)).toEqual(['SF-TPL-0157']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists broken descendants when a parent save is rejected', () => {
    selectArticle();
    component.saveDefinition();
    httpMock.expectOne((r) => r.method === 'PUT').flush(
      {
        code: 'SF-DOM-0124',
        descendants: [{ uuid: 'c-1', uid: 'child', channel: 'html', diagnostics: [{ severity: 'ERROR', code: 'SF-TPL-0158', message: 'x' }] }],
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    fixture.detectChanges();
    expect(component.descendantProblems().map((p) => p.uid)).toEqual(['child']);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('SF-TPL-0158');
  });
});
