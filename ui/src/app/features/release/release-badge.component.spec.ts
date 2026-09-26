import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { ReleaseBadgeComponent } from './release-badge.component';

type AssetSummaryView = components['schemas']['AssetSummaryView'];

const LOCALES: components['schemas']['ProjectLocalesView'] = {
  locales: [
    { code: 'de', label: 'Deutsch' },
    { code: 'en', label: 'English' },
  ],
  defaultLocale: 'de',
  fallbacks: {},
};

// A page summary row as `GET /pages` sends it (M27.1.3 release block + M27.4.4 scheduled refs).
const PAGE: AssetSummaryView = {
  uuid: 'page-1',
  uid: 'home',
  type: 'PAGE',
  displayName: 'Home',
  release: {
    de: { status: 'PUBLISHED', releasedRevision: 12 },
    en: { status: 'CHANGED', releasedRevision: 12 },
  },
  scheduled: [{ actionId: 7, type: 'RELEASE', locale: 'en', runAt: '2026-09-29T07:00:00Z', nextRunAt: '2026-09-29T07:00:00Z' }],
};

describe('ReleaseBadgeComponent', () => {
  let editingLocale: EditingLocaleStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ReleaseBadgeComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(LocalesStore).set('proj', LOCALES);
    editingLocale = TestBed.inject(EditingLocaleStore);
  });

  function render(release: AssetSummaryView['release'], scheduled: AssetSummaryView['scheduled'] = [], compact = false) {
    const fixture = TestBed.createComponent(ReleaseBadgeComponent);
    fixture.componentRef.setInput('release', release);
    fixture.componentRef.setInput('scheduled', scheduled);
    fixture.componentRef.setInput('compact', compact);
    fixture.detectChanges();
    return fixture;
  }

  it('shows the editing locale’s status as text and icon, all locales in the tooltip', () => {
    editingLocale.set('proj', 'de');
    const fixture = render(PAGE.release);
    const badge = fixture.nativeElement.querySelector('.badge') as HTMLElement;
    expect(badge.textContent).toContain('Published');
    expect(badge.classList).toContain('badge--published');
    expect(badge.querySelector('.material-symbols-outlined')?.textContent?.trim()).toBe('check_circle');
    expect(badge.getAttribute('title')).toBe('DE published · EN changed');

    editingLocale.set('proj', 'en');
    fixture.detectChanges();
    expect(badge.textContent).toContain('Changed');
    expect(badge.getAttribute('aria-label')).toBe('Status: Changed');
  });

  it.each([
    ['NEW', 'New', 'fiber_new'],
    ['UNPUBLISHED', 'Unpublished', 'cloud_off'],
    ['DELETION_PENDING', 'Deletion pending', 'delete_forever'],
  ])('labels %s', (status, label, icon) => {
    editingLocale.set('proj', 'de');
    const fixture = render({ de: { status } });
    const badge = fixture.nativeElement.querySelector('.badge') as HTMLElement;
    expect(badge.textContent).toContain(label);
    expect(badge.querySelector('.material-symbols-outlined')?.textContent?.trim()).toBe(icon);
  });

  it('adds a clock for a schedule touching the shown locale only', () => {
    editingLocale.set('proj', 'en');
    const fixture = render(PAGE.release, PAGE.scheduled);
    const badge = fixture.nativeElement.querySelector('.badge') as HTMLElement;
    expect(badge.querySelector('.badge__clock')).not.toBeNull();
    expect(badge.getAttribute('aria-label')).toBe('Status: Changed, scheduled');
    expect(badge.getAttribute('title')).toContain('Release scheduled for');

    editingLocale.set('proj', 'de');
    fixture.detectChanges();
    expect(badge.querySelector('.badge__clock')).toBeNull();
  });

  it('keeps the status readable when compact and renders nothing without a release state', () => {
    editingLocale.set('proj', 'de');
    const compact = render(PAGE.release, [], true);
    const badge = compact.nativeElement.querySelector('.badge') as HTMLElement;
    expect(badge.querySelector('.badge__text')).toBeNull();
    expect(badge.getAttribute('aria-label')).toBe('Status: Published');

    const none = render(undefined);
    expect(none.nativeElement.querySelector('.badge')).toBeNull();
  });
});
