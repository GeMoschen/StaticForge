import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { TemplatesComponent } from './templates.component';

/**
 * The store page loads a couple of bare-array endpoints (`/channels`, `/datasets`, `/usages`) alongside the
 * paged folder listings, so a blanket `flush({ content: [] })` hands `.map`/`.filter` an object.
 */
function emptyBodyFor(url: string, paged: object = { content: [] }): object {
  return url.endsWith('/channels') || url.endsWith('/datasets') || url.endsWith('/usages') ? [] : paged;
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

    component.saveTemplate();

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

    component.saveTemplate();

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
    contentCdl: '',
    bodiesCdl: '',
    rulesCdl: '',
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
    component.saveTemplate();
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
      component.onChannelInput('$CMS_EXTENDS(page_template:base)$$CMS_BLOCK(contnet)$$CMS_END_BLOCK$');
      vi.advanceTimersByTime(350);
      const validate = httpMock.expectOne((r) => r.url.endsWith('/octl/validate'));
      expect((validate.request.body as { templateUuid?: string }).templateUuid).toBe('a-3');
      validate.flush({ diagnostics: [{ severity: 'WARNING', code: 'SF-TPL-0157', message: "did you mean 'content'?", line: 1, column: 34 }] });
      expect(component.activeOctlDiagnostics().map((d) => d.code)).toEqual(['SF-TPL-0157']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists broken descendants when a parent save is rejected', () => {
    selectArticle();
    component.saveTemplate();
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

describe('TemplatesComponent (tabs and one save, M34)', () => {
  let fixture: ComponentFixture<TemplatesComponent>;
  let component: TemplatesComponent;
  let httpMock: HttpTestingController;

  const LAYOUT = {
    uuid: 't-1',
    uid: 'layout',
    assetType: 'PAGE_TEMPLATE',
    displayName: 'Layout',
    category: '',
    revision: 4,
    abstract: false,
    contentCdl: 'editor text title { label "Title" }',
    bodiesCdl: 'body main { allow ["*"] }',
    rulesCdl: '',
    channelTemplates: { html: { source: '<h1>$CMS_VALUE(title)$</h1>' }, md: { source: '# $CMS_VALUE(title)$' } },
    outputPath: {},
    paginationPath: {},
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
    fixture.detectChanges();
    for (const req of httpMock.match(() => true)) {
      req.flush(req.request.url.endsWith('/channels') ? [{ key: 'html' }, { key: 'md' }, { key: 'json' }] : emptyBodyFor(req.request.url));
    }
  });

  afterEach(() => {
    for (const pending of httpMock.match(() => true)) {
      pending.flush(emptyBodyFor(pending.request.url, {}));
    }
  });

  function open(detail: object = LAYOUT): void {
    component.select('t-1');
    fixture.detectChanges();
    httpMock.match((r) => r.method === 'GET' && /-templates\/t-1$/.test(r.url)).forEach((r) => r.flush(detail));
    httpMock.match((r) => r.url.endsWith('/usages')).forEach((r) => r.flush([]));
    fixture.detectChanges();
  }

  it('loads each CDL section into its own tab; a section template has no Bodies tab', () => {
    open();
    expect(component.sections()).toEqual({ content: LAYOUT.contentCdl, bodies: LAYOUT.bodiesCdl, rules: '' });
    expect(component.cdlTabs()).toEqual(['content', 'bodies', 'rules']);
    expect(component.channelTabs().map((t) => t.id)).toEqual(['html', 'md']);
    expect(component.dirty()).toBe(false);
    const tabs = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[role="tab"]')).map((t) => t.textContent?.trim());
    expect(tabs).toEqual(expect.arrayContaining(['Content', 'Bodies', 'Rules', 'html', 'md']));
  });

  it('saves the CDL and every channel — edited, added and removed — in one request', () => {
    open();
    component.onSectionInput({ section: 'rules', value: 'state title requiredWhen "true"' });
    component.selectChannel('md');
    component.onChannelInput('## $CMS_VALUE(title)$');
    component.addChannel('json');
    component.onChannelInput('{}');
    component.selectChannel('html');
    component.removeChannel();
    expect(component.removedChannels()).toEqual(['html']);
    expect(component.dirty()).toBe(true);
    expect(component.channelTabs().find((t) => t.id === 'md')?.dirty).toBe(true);

    component.saveTemplate();

    const puts = httpMock.match((r) => r.method === 'PUT');
    expect(puts.length).toBe(1);
    expect(puts[0].request.url).toMatch(/\/page-templates\/t-1$/);
    expect(puts[0].request.headers.get('If-Match')).toBe('"rev-4"');
    expect(puts[0].request.body).toMatchObject({
      contentCdl: LAYOUT.contentCdl,
      bodiesCdl: LAYOUT.bodiesCdl,
      rulesCdl: 'state title requiredWhen "true"',
      channelSources: { md: '## $CMS_VALUE(title)$', json: '{}' },
    });
    puts[0].flush({ ...LAYOUT, revision: 5 });
  });

  it('keeps every edit on a rejected save and opens the failing tabs', () => {
    open();
    component.onSectionInput({ section: 'rules', value: 'rule x' });
    component.selectChannel('html');
    component.saveTemplate();
    httpMock.expectOne((r) => r.method === 'PUT').flush(
      {
        code: 'SF-API-0422',
        diagnostics: [
          { severity: 'ERROR', code: 'SF-CDL-0113', message: 'name', line: 1, column: 6, field: 'rules' },
          { severity: 'ERROR', code: 'SF-TPL-0103', message: 'unknown', line: 1, column: 3, field: 'channel:md' },
        ],
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    expect(component.cdlTab()).toBe('rules');
    expect(component.selectedChannel()).toBe('md');
    expect(component.activeOctlDiagnostics().map((d) => d.code)).toEqual(['SF-TPL-0103']);
    expect(component.cdlDiagnostics().map((d) => d.field)).toEqual(['rules']);
    expect(component.sections().rules).toBe('rule x');
  });

  it('shows no Bodies tab for a section template and never sends bodies', () => {
    (component as unknown as { templates: { set: (v: unknown) => void } }).templates.set([
      { uuid: 't-1', assetType: 'SECTION_TEMPLATE' },
    ]);
    open({ ...LAYOUT, assetType: 'SECTION_TEMPLATE', bodiesCdl: '' });
    expect(component.cdlTabs()).toEqual(['content', 'rules']);
    component.onSectionInput({ section: 'content', value: 'editor text headline { }' });
    component.saveTemplate();
    const put = httpMock.expectOne((r) => r.method === 'PUT');
    expect(put.request.url).toMatch(/\/section-templates\/t-1$/);
    expect((put.request.body as { bodiesCdl?: string }).bodiesCdl).toBe('');
    put.flush({ ...LAYOUT, assetType: 'SECTION_TEMPLATE', revision: 5 });
  });

  it('keeps what is typed while the reload after a save is in flight', () => {
    open();
    component.onSectionInput({ section: 'content', value: 'editor text headline { }' });
    component.saveTemplate();
    httpMock.expectOne((r) => r.method === 'PUT').flush({ ...LAYOUT, contentCdl: 'editor text headline { }', revision: 5 });
    expect(component.dirty()).toBe(false);

    // Typed after Save, before the follow-up reload answers.
    component.onChannelInput('<h2>$CMS_VALUE(headline)$</h2>', 'html');
    httpMock
      .match((r) => r.method === 'GET' && /-templates\/t-1$/.test(r.url))
      .forEach((r) => r.flush({ ...LAYOUT, contentCdl: 'editor text headline { }', revision: 5 }));

    expect(component.channelSources()['html']).toBe('<h2>$CMS_VALUE(headline)$</h2>');
    expect(component.dirty()).toBe(true);
    expect(component.detail()?.revision).toBe(5);
  });

  it('saves on Ctrl+S', () => {
    open();
    component.onSectionInput({ section: 'content', value: 'editor text headline { }' });
    fixture.detectChanges();
    const detail = (fixture.nativeElement as HTMLElement).querySelector('.templates__detail')!;
    detail.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    httpMock.expectOne((r) => r.method === 'PUT').flush({ ...LAYOUT, revision: 5 });
  });
});

describe('TemplatesComponent tree selection', () => {
  it('highlights one row: the folder, or the open template — not both', () => {
    TestBed.configureTestingModule({
      imports: [TemplatesComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const http = TestBed.inject(HttpTestingController);
    TestBed.inject(ProjectContextStore).templateFolderTree.set([
      {
        uuid: 'all',
        uid: 'templates_root',
        displayName: 'All Templates',
        path: '/templates_root/',
        children: [
          { uuid: 'pt', uid: 'page_templates', displayName: 'Page Templates', path: '/templates_root/page_templates/', children: [] },
        ],
      },
    ]);
    const fixture = TestBed.createComponent(TemplatesComponent);
    fixture.componentRef.setInput('projectKey', 'proj1');
    const settle = () => {
      fixture.detectChanges();
      for (const req of http.match(() => true)) {
        req.flush(emptyBodyFor(req.request.url));
      }
      fixture.detectChanges();
    };
    const selectedRows = () =>
      Array.from(fixture.nativeElement.querySelectorAll('[role="treeitem"][aria-selected="true"]') as NodeListOf<HTMLElement>).map(
        (row) => row.querySelector('.folder-node__name')?.textContent?.trim(),
      );
    settle();

    // Nothing open: the default folder is the selection.
    expect(selectedRows()).toContain('Page Templates');

    fixture.componentInstance.select('tpl-1');
    settle();

    expect(selectedRows()).not.toContain('Page Templates');
  });
});

describe('TemplatesComponent output path warnings', () => {
  const WARNING = {
    severity: 'WARNING',
    code: 'SF-GEN-0112',
    field: 'outputPath:html',
    message: 'The output path "index.html" has no {locale}: pages of 2 languages would overwrite each other. Try "{locale}/index.html".',
  };

  function open(warnings: unknown[]) {
    TestBed.configureTestingModule({
      imports: [TemplatesComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(TemplatesComponent);
    fixture.componentRef.setInput('projectKey', 'proj1');
    const settle = () => {
      fixture.detectChanges();
      for (const req of http.match(() => true)) {
        const url = req.request.url;
        req.flush(
          url.endsWith('/page-templates/tpl-1')
            ? {
                uuid: 'tpl-1',
                revision: 4,
                displayName: 'Standard',
                channelTemplates: { html: { source: '<p></p>' }, rss: { source: '<item/>' } },
                outputPath: { html: 'index.html' },
                warnings,
              }
            : emptyBodyFor(url),
        );
      }
      fixture.detectChanges();
    };
    settle();
    fixture.componentInstance.select('tpl-1');
    settle();
    settle();
    return fixture;
  }

  const shown = (fixture: ComponentFixture<TemplatesComponent>) =>
    Array.from(fixture.nativeElement.querySelectorAll('[data-sf-output-path-warning]') as NodeListOf<HTMLElement>);

  it('shows the output path warning of the server in the channel it is about', () => {
    const fixture = open([WARNING]);

    const warnings = shown(fixture);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].textContent).toContain('{locale}/index.html');
    // It sits in the html channel's panel, not the rss one.
    expect(warnings[0].closest('[role="tabpanel"]')?.getAttribute('aria-label')).toBe('Channel html');
  });

  it('shows nothing for a template without warnings', () => {
    expect(shown(open([]))).toHaveLength(0);
  });
});

