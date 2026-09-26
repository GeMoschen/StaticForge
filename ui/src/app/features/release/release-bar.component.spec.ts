import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ALL_PUBLISH_PERMISSIONS, projectDetail } from '../../core/project/testing/project-detail.fixture';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { ReleaseBarComponent } from './release-bar.component';
import { ReleaseEventsStore } from './release-events.store';

type AssetDetailView = components['schemas']['AssetDetailView'];

const DETAIL_URL = '/api/v1/projects/proj/assets/page-1';

// `GET /assets/{uuid}` as AssetController sends it for a page with two languages.
const DETAIL: AssetDetailView = {
  uuid: 'page-1',
  uid: 'home',
  type: 'PAGE',
  displayName: 'Home',
  revision: 41,
  deleted: false,
  folderPath: '/pages_root/',
  release: {
    de: { status: 'PUBLISHED', releasedRevision: 40 },
    en: { status: 'CHANGED', releasedRevision: 40 },
  },
  scheduled: [],
};

describe('ReleaseBarComponent', () => {
  let fixture: ComponentFixture<ReleaseBarComponent>;
  let http: HttpTestingController;
  let auth: AuthStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ReleaseBarComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthStore);
    TestBed.inject(ProjectContextStore).activeProjectKey.set('proj');
    TestBed.inject(LocalesStore).set('proj', {
      locales: [
        { code: 'de', label: 'Deutsch' },
        { code: 'en', label: 'English' },
      ],
      defaultLocale: 'de',
      fallbacks: {},
    });
    TestBed.inject(EditingLocaleStore).set('proj', 'en');
  });

  afterEach(() => http.verify());

  /** Renders the bar for `role`; the server's publish permissions default to what that role holds with no policy. */
  function render(role: string, permissions = role === 'DEVELOPER' || role === 'PROJECT_ADMIN' ? ALL_PUBLISH_PERMISSIONS : []): void {
    TestBed.inject(ProjectContextStore).project.set(projectDetail(permissions));
    auth.setUser({ id: 1, username: 'ana', projectRoles: { proj: role } });
    fixture = TestBed.createComponent(ReleaseBarComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('assetUuid', 'page-1');
    fixture.componentRef.setInput('refreshKey', 41);
    fixture.detectChanges();
    http.expectOne(DETAIL_URL).flush(DETAIL);
    http.expectOne('/api/v1/projects/proj/members').flush([{ userId: 1, username: 'ana', displayName: 'Ana' }]);
    fixture.detectChanges();
  }

  function buttons(): string[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.bar__action') as NodeListOf<HTMLElement>).map((b) =>
      (b.textContent ?? '').trim(),
    );
  }

  it('shows a developer the status per language and the actions that apply', () => {
    render('DEVELOPER');
    expect(fixture.nativeElement.querySelector('.badge')?.textContent).toContain('Changed');
    const locales = Array.from(fixture.nativeElement.querySelectorAll('.bar__locale') as NodeListOf<HTMLElement>);
    expect(locales.map((li) => li.getAttribute('title'))).toEqual(['Deutsch: Published', 'English: Changed']);
    expect(buttons()).toEqual(['Release…', 'Unpublish…', 'Discard changes…', 'Schedule…']);
  });

  it('names pending schedules with time and owner, linking to them', () => {
    render('DEVELOPER');
    fixture.componentRef.setInput('refreshKey', 42);
    fixture.detectChanges();
    http.expectOne(DETAIL_URL).flush({
      ...DETAIL,
      scheduled: [{ actionId: 7, type: 'RELEASE', locale: 'en', runAt: '2026-09-29T07:00:00Z', nextRunAt: '2026-09-29T07:00:00Z', ownerUserId: 1 }],
    });
    fixture.detectChanges();
    const link = fixture.nativeElement.querySelector('.bar__pending a') as HTMLAnchorElement;
    expect(link.textContent).toMatch(/Release scheduled for .*2026.* by Ana \(EN\)/);
    expect(link.getAttribute('href')).toBe('/p/proj/schedules?id=7');
  });

  it('shows an editor the statuses but no actions', () => {
    render('EDITOR');
    expect(fixture.nativeElement.querySelector('.badge')).not.toBeNull();
    expect(buttons()).toEqual([]);
  });

  it('hides the actions while time travelling', () => {
    render('DEVELOPER');
    TestBed.inject(TimeTravelStore).enter(12);
    fixture.detectChanges();
    expect(buttons()).toEqual([]);
  });

  it('re-reads the status after a save and after any release action', () => {
    render('DEVELOPER');
    fixture.componentRef.setInput('refreshKey', 42);
    fixture.detectChanges();
    http.expectOne(DETAIL_URL).flush({ ...DETAIL, revision: 42 });

    TestBed.inject(ReleaseEventsStore).changed();
    fixture.detectChanges();
    http.expectOne(DETAIL_URL).flush({ ...DETAIL, release: { de: { status: 'PUBLISHED' }, en: { status: 'PUBLISHED' } } });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.badge')?.textContent).toContain('Published');
    expect(buttons()).toEqual(['Release…', 'Unpublish…', 'Schedule…']);
    expect((fixture.nativeElement.querySelector('.bar__action--primary') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders nothing for an asset without a release state', () => {
    auth.setUser({ id: 1, username: 'ana', projectRoles: { proj: 'DEVELOPER' } });
    fixture = TestBed.createComponent(ReleaseBarComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('assetUuid', 'page-1');
    fixture.detectChanges();
    http.expectOne('/api/v1/projects/proj/members').flush([]);
    http.expectOne(DETAIL_URL).flush({ ...DETAIL, release: undefined });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.bar')).toBeNull();
  });

  it('shows an editor with RELEASE the release actions but not Schedule…', () => {
    render('EDITOR', ['RELEASE']);
    expect(buttons()).toEqual(['Release…', 'Unpublish…', 'Discard changes…']);
  });

  it('shows an editor with RELEASE and SCHEDULE_RELEASE Schedule… too', () => {
    render('EDITOR', ['RELEASE', 'SCHEDULE_RELEASE']);
    expect(buttons()).toEqual(['Release…', 'Unpublish…', 'Discard changes…', 'Schedule…']);
  });

  it('shows an editor holding only SCHEDULE_RELEASE no actions', () => {
    render('EDITOR', ['SCHEDULE_RELEASE']);
    expect(buttons()).toEqual([]);
  });
});
