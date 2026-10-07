import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { screen } from '@testing-library/angular';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import type { ReleaseChoice } from '../release/release-choice.util';
import { ScheduleDialogComponent } from './schedule-dialog.component';

type ScheduleView = components['schemas']['ScheduleView'];

const BASE = '/api/v1/projects/proj';
const CHOICES: ReleaseChoice[] = [
  { assetUuid: 'page-1', locale: 'en', label: 'Munich · EN — Changed', status: 'CHANGED', checked: true, assetName: 'Munich' },
];

/** Writable view of the dialog's protected form signals. */
interface Form {
  zone: { set(value: string): void };
  date: { set(value: string): void };
  time: { set(value: string): void };
  cronMode: { set(value: 'preset' | 'advanced'): void };
  advancedCron: { set(value: string): void };
}

describe('ScheduleDialogComponent', () => {
  let fixture: ComponentFixture<ScheduleDialogComponent>;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T10:00:00Z'));
    TestBed.configureTestingModule({
      imports: [ScheduleDialogComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  function open(types: string[], choices: ReleaseChoice[] = [], schedule: ScheduleView | null = null): Form {
    fixture = TestBed.createComponent(ScheduleDialogComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('types', types);
    fixture.componentRef.setInput('choices', choices);
    fixture.componentRef.setInput('schedule', schedule);
    fixture.detectChanges();
    // The generation options (a child created in the first pass) load targets and channels in their effect.
    fixture.detectChanges();
    for (const request of http.match((r) => r.url.endsWith('/targets') || r.url.endsWith('/channels'))) {
      request.flush([]);
    }
    return fixture.componentInstance as unknown as Form;
  }

  /** The dialog moves itself into `<body>`, so queries run there. */
  const page = () => document.body;

  /** The primary button in the footer: "Schedule release", "Schedule generation", … or "Save" when editing. */
  function scheduleButton(): HTMLButtonElement {
    return Array.from(page().querySelectorAll('.sf-dialog__footer button')).at(-1) as HTMLButtonElement;
  }

  /** A button with a reason stays focusable: `aria-disabled` instead of the native attribute. */
  function isDisabled(element: HTMLElement): boolean {
    return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
  }

  it('sends a Berlin wall-clock time across the autumn DST switch as the right UTC instant', () => {
    const form = open(['RELEASE', 'UNPUBLISH'], CHOICES);
    form.zone.set('Europe/Berlin');
    form.date.set('2026-10-25');
    form.time.set('03:30');
    fixture.detectChanges();
    expect((page().querySelector('sf-combobox input') as HTMLInputElement).value).toBe('Europe/Berlin');
    expect(page().textContent).toContain('CET');

    vi.advanceTimersByTime(300);
    http.expectOne(`${BASE}/releases/plan`).flush({ items: [], dependencies: [], incomplete: [], warnings: [] });
    fixture.detectChanges();
    fixture.detectChanges();

    scheduleButton().click();
    const request = http.expectOne((r) => r.method === 'POST' && r.url === `${BASE}/schedules`);
    expect(request.request.body).toMatchObject({
      type: 'RELEASE',
      runAt: '2026-10-25T02:30:00.000Z',
      pinPolicy: 'PINNED',
      missedPolicy: 'RUN_LATE',
      params: { items: [{ assetUuid: 'page-1', locale: 'en' }], includeDependencies: [] },
    });
    request.flush({ id: 5, type: 'RELEASE', runAt: '2026-10-25T02:30:00Z', status: 'PENDING' } satisfies ScheduleView);
  });

  it('lets the user pick the time zone in the combobox and sends the time in that zone', () => {
    open(['GENERATION']);
    const input = page().querySelector('sf-combobox input') as HTMLInputElement;
    input.focus();
    input.value = 'Asia/Tokyo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    fixture.detectChanges();
    const option = screen.getByRole('option', { name: 'Asia/Tokyo' });
    option.click();
    const form = fixture.componentInstance as unknown as Form;
    form.date.set('2026-10-01');
    form.time.set('09:00');
    fixture.detectChanges();
    expect(input.value).toBe('Asia/Tokyo');
    expect(page().textContent).toContain('GMT+9');
    scheduleButton().click();
    const request = http.expectOne((r) => r.method === 'POST' && r.url === `${BASE}/schedules`);
    expect(request.request.body).toMatchObject({ type: 'GENERATION', runAt: '2026-10-01T00:00:00.000Z' });
    request.flush({ id: 1, type: 'GENERATION', status: 'PENDING' } satisfies ScheduleView);
  });

  it('refuses a time in the past before asking the server', () => {
    const form = open(['GENERATION']);
    form.date.set('2026-09-26');
    form.time.set('09:00');
    form.zone.set('UTC');
    fixture.detectChanges();
    expect(page().textContent).toContain('Pick a time in the future.');
    expect(isDisabled(scheduleButton())).toBe(true);
  });

  it('shows the server’s SF-DOM-0165 message for an invalid cron and blocks saving', () => {
    const form = open(['RECURRING_GENERATION']);
    vi.advanceTimersByTime(500);
    const first = http.expectOne(`${BASE}/schedules/preview-times`);
    expect(first.request.body).toMatchObject({ cron: '0 9 * * *', count: 5 });
    first.flush({ cron: '0 0 9 * * *', zoneId: 'UTC', times: ['2026-09-27T09:00:00Z', '2026-09-28T09:00:00Z'] });
    fixture.detectChanges();
    expect(page().querySelectorAll('.sd__runs li').length).toBe(2);

    form.cronMode.set('advanced');
    form.advancedCron.set('61 * * * *');
    fixture.detectChanges();
    vi.advanceTimersByTime(500);
    http
      .expectOne(`${BASE}/schedules/preview-times`)
      .flush(
        { code: 'SF-DOM-0165', detail: "Invalid cron expression '61 * * * *': Minute out of range", status: 422 },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    fixture.detectChanges();
    expect(page().querySelector('[role="alert"]')?.textContent).toContain("Invalid cron expression '61 * * * *'");
    expect(isDisabled(scheduleButton())).toBe(true);
  });

  it('edits a recurring schedule in its own zone and sends If-Match', () => {
    open(['RECURRING_GENERATION'], [], {
      id: 9,
      type: 'RECURRING_GENERATION',
      status: 'PENDING',
      cron: '0 0 7 * * 1-5',
      zoneId: 'America/New_York',
      missedPolicy: 'RUN_LATE',
      params: { mode: 'INCREMENTAL', targetId: null, channels: [] } as unknown as ScheduleView['params'],
      version: 4,
    });
    expect((page().querySelector('sf-combobox input') as HTMLInputElement).value).toBe('America/New_York');
    vi.advanceTimersByTime(500);
    http
      .expectOne(`${BASE}/schedules/preview-times`)
      .flush({ cron: '0 0 7 * * 1-5', zoneId: 'America/New_York', times: ['2026-09-28T11:00:00Z'] });
    fixture.detectChanges();

    scheduleButton().click();
    const request = http.expectOne((r) => r.method === 'PUT' && r.url === `${BASE}/schedules/9`);
    expect(request.request.headers.get('If-Match')).toBe('"v4"');
    expect(request.request.body).toMatchObject({
      type: 'RECURRING_GENERATION',
      cron: '0 7 * * 1-5',
      zoneId: 'America/New_York',
      params: { mode: 'INCREMENTAL', targetId: null },
    });
    request.flush({ id: 9, type: 'RECURRING_GENERATION', status: 'PENDING', nextRunAt: '2026-09-28T11:00:00Z' } satisfies ScheduleView);
  });
});

describe('ScheduleDialogComponent title and kind switch (M35.23)', () => {
  let fixture: ComponentFixture<ScheduleDialogComponent>;
  let http: HttpTestingController;

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  const UNPUBLISH_CHOICES: ReleaseChoice[] = [
    { assetUuid: 'page-1', locale: 'de', label: 'Munich · DE — Published', status: 'PUBLISHED', checked: true, assetName: 'Munich' },
  ];

  function open(types: string[], schedule: ScheduleView | null = null, choices: ReleaseChoice[] = CHOICES): void {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T10:00:00Z'));
    TestBed.configureTestingModule({
      imports: [ScheduleDialogComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ScheduleDialogComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('types', types);
    fixture.componentRef.setInput('choices', choices);
    fixture.componentRef.setInput('unpublishChoices', UNPUBLISH_CHOICES);
    fixture.componentRef.setInput('schedule', schedule);
    fixture.detectChanges();
    fixture.detectChanges();
    for (const request of http.match((r) => r.url.endsWith('/targets') || r.url.endsWith('/channels'))) {
      request.flush([]);
    }
  }

  it('names what it schedules in the title and switches between release and unpublish', () => {
    open(['RELEASE', 'UNPUBLISH']);
    expect(document.body.querySelector('h2')?.textContent?.trim()).toBe('Schedule release');
    expect(screen.getByRole('radio', { name: 'Release' }).getAttribute('aria-checked')).toBe('true');
    // A lone item is plain text, not a ticked checkbox.
    expect(screen.getByText('Munich (EN)')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();

    (screen.getByRole('radio', { name: 'Unpublish' }) as HTMLElement).click();
    fixture.detectChanges();
    expect(document.body.querySelector('h2')?.textContent?.trim()).toBe('Schedule unpublish');
    // The items follow the kind: the online ones are offered, not the changed ones.
    expect(screen.getByText('Munich (DE)')).toBeTruthy();
    expect(screen.queryByText('Munich (EN)')).toBeNull();
    expect(screen.getByRole('button', { name: 'Schedule unpublish' })).toBeTruthy();
  });

  it('has no items for a generation: it picks target and mode, and a recurring one a repeat', () => {
    open(['RELEASE', 'UNPUBLISH', 'GENERATION', 'RECURRING_GENERATION']);
    expect(screen.getAllByRole('radio').map((radio) => radio.textContent?.trim())).toEqual(
      expect.arrayContaining(['Release', 'Unpublish', 'Generation', 'Recurring generation']),
    );
    (screen.getByRole('radio', { name: 'Generation' }) as HTMLElement).click();
    fixture.detectChanges();
    fixture.detectChanges();
    for (const request of http.match((r) => r.url.endsWith('/targets') || r.url.endsWith('/channels'))) {
      request.flush([]);
    }
    expect(document.body.querySelector('h2')?.textContent?.trim()).toBe('Schedule generation');
    expect(screen.queryByText('Items')).toBeNull();
    expect(screen.getByText('Date and time')).toBeTruthy();
  });

  it('shows several languages of one asset as checkboxes and several assets as a count', () => {
    const more: ReleaseChoice[] = [{ assetUuid: 'page-1', locale: 'de', label: 'Munich · DE — New', status: 'NEW', checked: true, assetName: 'Munich' }];
    open(['RELEASE'], null, [...CHOICES, ...more]);
    expect(screen.getByRole('checkbox', { name: 'Munich · EN — Changed' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Munich · DE — New' })).toBeTruthy();
  });

  it('shows several assets as a count, not a checkbox each', () => {
    open(['RELEASE'], null, [...CHOICES, { assetUuid: 'page-2', locale: 'en', label: 'Home · EN — New', status: 'NEW', checked: true, assetName: 'Home' }]);
    expect(screen.getByText('2 items')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('keeps version, missed-time policy and comment in collapsed "Advanced options", open when an edited schedule departs from the defaults', () => {
    open(['RELEASE']);
    const details = () => document.body.querySelector('details.sd__advanced') as HTMLDetailsElement;
    expect(details().open).toBe(false);
    expect(details().textContent).toContain('Which version');
    expect(details().textContent).toContain('If the time is missed');
    expect(details().textContent).toContain('Comment');
    // No separate section headings any more.
    expect(Array.from(document.body.querySelectorAll('h3')).map((h) => h.textContent?.trim())).not.toContain('When');
  });

  it('opens "Advanced options" for an edited schedule that departs from the defaults', () => {
    open(['RELEASE'], {
      id: 3,
      type: 'RELEASE',
      status: 'PENDING',
      runAt: '2026-09-27T09:00:00Z',
      pinPolicy: 'LATEST',
      missedPolicy: 'RUN_LATE',
      version: 1,
    });
    expect((document.body.querySelector('details.sd__advanced') as HTMLDetailsElement).open).toBe(true);
  });

  it('previews the next run in the chosen zone', () => {
    open(['RELEASE']);
    const preview = document.body.querySelector('.sd__preview') as HTMLElement;
    expect(preview.querySelector('h3')?.textContent).toMatch(/^Next runs \(.+\)$/);
    expect(preview.querySelectorAll('li')).toHaveLength(1);
    expect(document.body.textContent).not.toContain('No unreleased dependencies.');
  });

  it('offers no switch when only one kind is allowed, and still names it', () => {
    open(['RELEASE']);
    expect(document.body.querySelector('h2')?.textContent?.trim()).toBe('Schedule release');
    expect(screen.queryByRole('radiogroup', { name: 'What to schedule' })).toBeNull();
  });

  it('puts its actions in the dialog footer and keeps one h2', () => {
    open(['RELEASE']);
    expect(document.body.querySelectorAll('h2')).toHaveLength(1);
    expect(document.body.querySelectorAll('.sf-dialog__footer button')).toHaveLength(2);
    expect(document.body.querySelector('h1')).toBeNull();
  });
});

describe('ScheduleDialogComponent "then generate" for an editor (M28.3.3)', () => {
  let fixture: ComponentFixture<ScheduleDialogComponent>;
  let http: HttpTestingController;

  /** The project's targets as `GET /targets` sends them: 7 is the default. */
  const TARGETS = [
    { id: 7, name: 'Live', type: 'FILESYSTEM', isDefault: true, outputPath: 'proj/live' },
    { id: 8, name: 'Staging', type: 'FILESYSTEM', isDefault: false, outputPath: 'proj/staging' },
  ];

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  function open(permissions: string[]): HTMLElement {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T10:00:00Z'));
    TestBed.configureTestingModule({
      imports: [ScheduleDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideProjectPermissions({ role: () => 'EDITOR', permissions: () => permissions, userId: () => 1, readOnly: () => false }),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ScheduleDialogComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('types', ['RELEASE']);
    fixture.componentRef.setInput('choices', CHOICES);
    fixture.detectChanges();
    fixture.detectChanges();
    return document.body;
  }

  /** "Then generate" starts on (as in the sample); answers the generation options' loads. */
  function answerGenerationOptions(): void {
    fixture.detectChanges();
    http.expectOne(`${BASE}/targets`).flush(TARGETS);
    http.expectOne(`${BASE}/channels`).flush([]);
    fixture.detectChanges();
  }

  it('offers no "then generate" without INCREMENTAL_BUILD', () => {
    const el = open(['RELEASE', 'SCHEDULE_RELEASE']);
    expect(el.textContent).not.toContain('Then generate');
    expect(el.querySelector('sf-generation-options')).toBeNull();
  });

  it('starts "Then generate" on, and lets it be switched off', () => {
    const el = open(['RELEASE', 'SCHEDULE_RELEASE', 'INCREMENTAL_BUILD']);
    answerGenerationOptions();
    const box = screen.getByRole('switch', { name: 'Then generate (incremental build of the default target)' }) as HTMLInputElement;
    expect(box.getAttribute('aria-checked') ?? String(box.checked)).toBe('true');
    box.click();
    fixture.detectChanges();
    expect(el.querySelector('sf-generation-options')).toBeNull();
  });

  it('builds only the default target with INCREMENTAL_BUILD but no FULL_BUILD, and sends no target', () => {
    const el = open(['RELEASE', 'SCHEDULE_RELEASE', 'INCREMENTAL_BUILD']);
    expect(el.textContent).toContain('Then generate');
    answerGenerationOptions();
    expect(el.querySelector('sf-generation-options sf-select')).toBeNull();
    expect(el.querySelector('sf-generation-options')?.textContent).toContain('The build goes to the default target.');

    vi.advanceTimersByTime(300);
    http.expectOne(`${BASE}/releases/plan`).flush({ items: [], dependencies: [], incomplete: [], warnings: [] });
    fixture.detectChanges();
    fixture.detectChanges();
    const schedule = screen.getByRole('button', { name: 'Schedule release' });
    schedule.click();
    const request = http.expectOne((r) => r.method === 'POST' && r.url === `${BASE}/schedules`);
    expect(request.request.body).toMatchObject({ type: 'RELEASE', thenGenerate: { targetId: null } });
    request.flush({ id: 5, type: 'RELEASE', runAt: '2026-09-26T11:00:00Z', status: 'PENDING' } satisfies ScheduleView);
  });

  it('lets a holder of FULL_BUILD choose the target', () => {
    const el = open(['RELEASE', 'SCHEDULE_RELEASE', 'INCREMENTAL_BUILD', 'FULL_BUILD']);
    answerGenerationOptions();
    const options = Array.from(el.querySelectorAll('sf-generation-options sf-select option')).map((o) => o.textContent?.trim());
    expect(options).toEqual(['Default target', 'Live', 'Staging']);
    expect(el.querySelector('sf-generation-options')?.textContent).not.toContain('default target.');
  });
});
