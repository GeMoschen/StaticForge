import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { screen } from '@testing-library/angular';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ALL_PUBLISH_PERMISSIONS, projectDetail } from '../../core/project/testing/project-detail.fixture';
import { ReleaseActionsComponent } from './release-actions.component';
import { ReleaseEventsStore } from './release-events.store';

type AssetDetailView = components['schemas']['AssetDetailView'];

const DETAIL_URL = '/api/v1/projects/proj/assets/page-1';

// `GET /assets/{uuid}` as AssetController sends it for a page with three languages.
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
    fr: { status: 'NEW' },
  },
  scheduled: [],
};

describe('ReleaseActionsComponent', () => {
  let fixture: ComponentFixture<ReleaseActionsComponent>;
  let http: HttpTestingController;
  let auth: AuthStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ReleaseActionsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthStore);
    TestBed.inject(ProjectContextStore).activeProjectKey.set('proj');
    TestBed.inject(LocalesStore).set('proj', {
      locales: [
        { code: 'de', label: 'Deutsch' },
        { code: 'en', label: 'English' },
        { code: 'fr', label: 'Français' },
      ],
      defaultLocale: 'de',
      fallbacks: {},
    });
    TestBed.inject(EditingLocaleStore).set('proj', 'en');
  });

  afterEach(() => http.verify());

  /** Renders the actions for `role`; the server's publish permissions default to what that role holds with no policy. */
  function render(
    role: string,
    permissions = role === 'DEVELOPER' || role === 'PROJECT_ADMIN' ? ALL_PUBLISH_PERMISSIONS : [],
    detail: AssetDetailView = DETAIL,
  ): void {
    TestBed.inject(ProjectContextStore).project.set(projectDetail(permissions));
    auth.setUser({ id: 1, username: 'ana', projectRoles: { proj: role } });
    fixture = TestBed.createComponent(ReleaseActionsComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('assetUuid', 'page-1');
    fixture.componentRef.setInput('refreshKey', 41);
    fixture.detectChanges();
    http.expectOne(DETAIL_URL).flush(detail);
    http.expectOne('/api/v1/projects/proj/members').flush([{ userId: 1, username: 'ana', displayName: 'Ana' }]);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  function pills(): HTMLElement[] {
    return Array.from(el().querySelectorAll('.ra__pills sf-status') as NodeListOf<HTMLElement>);
  }

  function moreItems(): { id: string; label: string; disabled?: boolean; disabledReason?: string; danger?: boolean }[] {
    return (fixture.componentInstance as unknown as { moreItems: () => never[] }).moreItems();
  }

  it('shows one status pill per language: released = success, changed = warning, new = info', () => {
    render('DEVELOPER');
    expect(pills().map((pill) => pill.className)).toEqual([
      expect.stringContaining('sf-status--success'),
      expect.stringContaining('sf-status--warning'),
      expect.stringContaining('sf-status--info'),
    ]);
    expect(pills().map((pill) => pill.textContent?.replace(/\s+/g, ' '))).toEqual([
      expect.stringContaining('DE: Deutsch: Published'),
      expect.stringContaining('EN: English: Changed'),
      expect.stringContaining('FR: Français: New'),
    ]);
    expect(el().querySelector('.ra__pills')?.getAttribute('aria-label')).toBe('Release status per language');
  });

  it('shows a language with a pending scheduled release as scheduled (accent), and names the schedule', () => {
    render('DEVELOPER', ALL_PUBLISH_PERMISSIONS, {
      ...DETAIL,
      scheduled: [{ actionId: 7, type: 'RELEASE', locale: 'en', runAt: '2026-09-29T07:00:00Z', nextRunAt: '2026-09-29T07:00:00Z', ownerUserId: 1 }],
    });
    expect(pills().map((pill) => pill.className)).toEqual([
      expect.stringContaining('sf-status--success'),
      expect.stringContaining('sf-status--accent'),
      expect.stringContaining('sf-status--info'),
    ]);
    expect(pills()[1].textContent).toContain('Scheduled');

    const link = el().querySelector('.ra__pending a') as HTMLAnchorElement;
    expect(link.textContent).toMatch(/Release scheduled for .*2026.* by Ana \(EN\)/);
    expect(link.getAttribute('href')).toBe('/p/proj/schedules?id=7');
  });

  it('offers Release…, Schedule… and a ⋮ with Unpublish… and Discard changes…', () => {
    render('DEVELOPER');
    const labels = Array.from(el().querySelectorAll('sf-button') as NodeListOf<HTMLElement>).map((b) => b.textContent?.trim());
    expect(labels.filter((text) => text?.includes('Release…') || text?.includes('Schedule…'))).toHaveLength(2);
    expect(el().querySelector('sf-menu')).not.toBeNull();

    const items = moreItems();
    expect(items.map((item) => item.label)).toEqual(['Unpublish…', 'Discard changes…']);
    expect(items.every((item) => !item.disabledReason)).toBe(true);
    expect(items[1].danger).toBe(true);
  });

  it('is a group of its own, shown only while it has something to act on (decision 34)', () => {
    render('DEVELOPER');
    expect(el().classList.contains('is-empty')).toBe(false);
    expect(el().querySelector('.ra__pills')).not.toBeNull();
  });

  it('opens the release dialog with every changed language pre-ticked', () => {
    render('DEVELOPER');
    (screen.getByRole('button', { name: 'Release…' }) as HTMLElement).click();
    fixture.detectChanges();
    fixture.detectChanges();
    http.match((r) => r.url.endsWith('/releases/plan'));

    expect(document.body.querySelector('h2')?.textContent?.trim()).toBe('Release “Home”');
    const boxes = Array.from(document.body.querySelectorAll('.rd__list input[type="checkbox"]')) as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([true, true]);
    expect((screen.getByRole('checkbox', { name: 'All changed languages' }) as HTMLInputElement).checked).toBe(true);
  });

  it('opens the schedule dialog titled by what it schedules, with a switch to unpublish', () => {
    render('DEVELOPER');
    (screen.getByRole('button', { name: 'Schedule…' }) as HTMLElement).click();
    fixture.detectChanges();
    fixture.detectChanges();
    http.match((r) => r.url.endsWith('/targets') || r.url.endsWith('/channels') || r.url.endsWith('/releases/plan'));

    expect(document.body.querySelector('h2')?.textContent?.trim()).toBe('Schedule release');
    expect(screen.getByRole('radio', { name: 'Unpublish' })).toBeTruthy();
  });

  it('opens Unpublish and Discard changes in the release dialog, which lists what is affected', () => {
    render('DEVELOPER');
    (fixture.componentInstance as unknown as { open(mode: string): void }).open('discard');
    fixture.detectChanges();
    http.match((r) => r.url.includes('/changes/'));

    expect(document.body.querySelector('h2')?.textContent?.trim()).toBe('Discard changes of “Home”');
  });

  it('disables Unpublish and Discard in the ⋮ with a reason when they do not apply', () => {
    render('DEVELOPER', ALL_PUBLISH_PERMISSIONS, {
      ...DETAIL,
      release: { de: { status: 'UNPUBLISHED' }, en: { status: 'NEW' } },
    });
    const items = moreItems();
    expect(items[0].disabledReason).toBe('Nothing is online to unpublish.');
    expect(items[1].disabledReason).toBe('No language has changes to discard.');
  });

  it('disables Release with a reason when nothing is waiting, as in the sample', () => {
    render('DEVELOPER', ALL_PUBLISH_PERMISSIONS, {
      ...DETAIL,
      release: { de: { status: 'PUBLISHED' }, en: { status: 'PUBLISHED' } },
    });
    const release = screen.getByRole('button', { name: /Release…/ }) as HTMLButtonElement;
    expect(release.getAttribute('aria-disabled')).toBe('true');

    release.click();
    fixture.detectChanges();
    expect(document.body.querySelector('sf-release-dialog')).toBeNull();
  });

  it('shows an editor the statuses but no actions', () => {
    render('EDITOR');
    expect(pills()).toHaveLength(3);
    expect(el().querySelectorAll('sf-button')).toHaveLength(0);
    expect(el().querySelector('sf-menu')).toBeNull();
  });

  it('shows an editor with RELEASE Release… and the ⋮ but not Schedule…', () => {
    render('EDITOR', ['RELEASE']);
    const text = el().textContent ?? '';
    expect(text).toContain('Release…');
    expect(text).not.toContain('Schedule…');
    expect(el().querySelector('sf-menu')).not.toBeNull();
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
    expect(pills().map((pill) => pill.className)).toEqual([
      expect.stringContaining('sf-status--success'),
      expect.stringContaining('sf-status--success'),
    ]);
  });

  it('renders nothing for an asset without a release state', () => {
    render('DEVELOPER', ALL_PUBLISH_PERMISSIONS, { ...DETAIL, release: undefined });
    expect(el().querySelector('.ra__pills')).toBeNull();
    expect(el().classList.contains('is-empty')).toBe(true);
  });

  it('emits the mode of a finished release action', () => {
    render('DEVELOPER');
    const modes: string[] = [];
    fixture.componentInstance.changed.subscribe((mode) => modes.push(mode));
    (fixture.componentInstance as unknown as { onDone(mode: string): void }).onDone('discard');
    expect(modes).toEqual(['discard']);
  });
});
