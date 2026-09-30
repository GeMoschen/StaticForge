import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { SfAssetPickerDialogComponent } from '../../shared/components/sf-asset-picker-dialog.component';
import { GenerationDialogComponent } from './generation-dialog.component';
import { PLAN_AFTER_MOVE } from './findings/testing/findings.fixtures';

type GenerationTargetView = components['schemas']['GenerationTargetView'];
type GenerationRequestDto = components['schemas']['GenerationRequestDto'];
type GenerationRunView = components['schemas']['GenerationRunView'];
type FolderView = components['schemas']['FolderView'];
type ChannelView = components['schemas']['ChannelView'];

const BASE = '/api/v1/projects/proj';

/** The project's targets as `GET /targets` sends them: 7 is the default. */
const TARGETS: GenerationTargetView[] = [
  { id: 8, name: 'Staging', type: 'FILESYSTEM', isDefault: false, outputPath: 'proj/staging' },
  { id: 7, name: 'Live', type: 'FILESYSTEM', isDefault: true, outputPath: 'proj/live' },
];

const CHANNELS: ChannelView[] = [{ key: 'html', enabled: true }];

/** The pages tree as the project context holds it: the protected "All Pages" wrapper around the real folders. */
const PAGE_TREE: FolderView[] = [
  {
    uuid: 'root',
    uid: 'pages_root',
    displayName: 'All Pages',
    path: '/',
    protectedFolder: true,
    children: [
      {
        uuid: 'f-news',
        uid: 'news',
        displayName: 'News',
        path: '/news/',
        children: [{ uuid: 'f-2026', uid: '2026', displayName: '2026', path: '/news/2026/', children: [] }],
      },
    ],
  },
];

describe('GenerationDialogComponent', () => {
  let fixture: ComponentFixture<GenerationDialogComponent>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [GenerationDialogComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(ProjectContextStore).pageFolderTree.set(PAGE_TREE);
  });

  afterEach(() => http.verify());

  function open(fullBuild: boolean): void {
    fixture = TestBed.createComponent(GenerationDialogComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('targets', TARGETS);
    fixture.componentRef.setInput('fullBuild', fullBuild);
    fixture.componentRef.setInput('defaultTargetId', 7);
    fixture.detectChanges();
    fixture.detectChanges();
    http.expectOne(`${BASE}/channels`).flush(CHANNELS);
    fixture.detectChanges();
  }

  function button(label: string): HTMLButtonElement {
    return Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.trim() === label,
    )!;
  }

  function start(): GenerationRequestDto {
    button('Start').click();
    const request = http.expectOne((r) => r.method === 'POST' && r.url === `${BASE}/generations`);
    const body = request.request.body as GenerationRequestDto;
    request.flush({ id: 21, mode: body.mode, status: 'QUEUED' } satisfies GenerationRunView);
    return body;
  }

  it('fixes an incremental build to the default target without FULL_BUILD', () => {
    open(false);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('input[type="radio"][formcontrolname="mode"]').length).toBe(0);
    expect(el.querySelector('select[formcontrolname="targetId"]')).toBeNull();
    const fixed = el.querySelector('.fixed')!.textContent!.replace(/\s+/g, ' ');
    expect(fixed).toContain('Mode Incremental');
    expect(fixed).toContain('Target Live');

    expect(start()).toEqual({ mode: 'INCREMENTAL', targetId: 7, channels: ['html'] });
  });

  it('offers mode and target with FULL_BUILD', () => {
    open(true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('input[type="radio"][value="FULL"]')).not.toBeNull();
    expect(el.querySelector('input[type="radio"][value="INCREMENTAL"]')).not.toBeNull();
    const options = Array.from(el.querySelectorAll('select[formcontrolname="targetId"] option')).map((o) => o.textContent?.trim());
    expect(options).toEqual(['Staging', 'Live']);
    expect(el.querySelector('.fixed')).toBeNull();
  });

  it('starts the Target select on the default target, not on a blank option', () => {
    open(true);
    const select = fixture.nativeElement.querySelector('select[formcontrolname="targetId"]') as HTMLSelectElement;

    expect(select.options[select.selectedIndex].textContent?.trim()).toBe('Live');
    expect(start().targetId).toBe(7);
  });

  it('limits the build to a folder and picked pages, in the preview and the start request alike', () => {
    open(false);
    const el = fixture.nativeElement as HTMLElement;
    const folder = el.querySelector('.scope select') as HTMLSelectElement;
    const labels = Array.from(folder.options).map((o) => o.textContent?.replace(/ /g, ' '));
    expect(labels).toEqual(['Whole site', 'News', '  2026']);

    folder.value = '/news/2026/';
    folder.dispatchEvent(new Event('change'));
    button('Add page…').click();
    fixture.detectChanges();
    const picker = fixture.debugElement.query(By.directive(SfAssetPickerDialogComponent));
    expect(picker).not.toBeNull();
    // The picker loads its own lists; only its `picked` output matters here.
    http.match(() => true).forEach((request) => request.flush([]));
    (picker.componentInstance as SfAssetPickerDialogComponent).picked.emit({ uuid: 'page-9', assetType: 'PAGE', label: 'Imprint' });
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(SfAssetPickerDialogComponent))).toBeNull();
    expect(el.querySelector('.scope__page')?.textContent).toContain('Imprint');

    const expected: GenerationRequestDto = {
      mode: 'INCREMENTAL',
      targetId: 7,
      channels: ['html'],
      folderPath: '/news/2026/',
      assetUuids: ['page-9'],
    };
    button('Preview plan').click();
    const plan = http.expectOne((r) => r.method === 'POST' && r.url === `${BASE}/generations/plan`);
    expect(plan.request.body).toEqual(expected);
    plan.flush({ summary: { entryCount: 0, pageCount: 0, changedAssetCount: 0, revision: 5 }, entries: null });
    fixture.detectChanges();

    expect(start()).toEqual(expected);
    // The run started after a preview checks whether content moved on meanwhile.
    http.expectOne((r) => r.url === `${BASE}/revisions`).flush([]);
  });
  it('lists the redirects the run would add (M30.4.2)', () => {
    open(false);
    button('Preview plan').click();
    const plan = http.expectOne((r) => r.method === 'POST' && r.url === `${BASE}/generations/plan`);
    plan.flush(PLAN_AFTER_MOVE);
    fixture.detectChanges();
    // The entries table loads nothing: the preview carries its first page.
    const el = fixture.nativeElement as HTMLElement;
    const toggle = button('Show 2 redirects to add');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    fixture.detectChanges();
    const items = Array.from(el.querySelectorAll('[aria-label="Automatic redirects the run would add"] li')).map((li) =>
      li.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(items).toEqual(['gamma.html → gamma_moved.html · html, de', 'en/gamma.html → en/gamma_moved.html · html, en']);
    expect(button('Hide 2 redirects to add').getAttribute('aria-expanded')).toBe('true');
  });

  it('shows no redirect list when the run adds none', () => {
    open(false);
    button('Preview plan').click();
    http
      .expectOne((r) => r.method === 'POST' && r.url === `${BASE}/generations/plan`)
      .flush({ ...PLAN_AFTER_MOVE, summary: { ...PLAN_AFTER_MOVE.summary, redirectsAdded: 0 }, redirectCandidates: [] });
    fixture.detectChanges();
    expect(Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).some((b) => /redirect/.test(b.textContent ?? ''))).toBe(false);
  });
});
