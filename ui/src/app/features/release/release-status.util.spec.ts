import { describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { choicesFor, itemsOf } from './release-choice.util';
import { deleteQuestion, isOnline, releaseKeyFor, statusFor, statusSummary } from './release-status.util';

type AssetDetailView = components['schemas']['AssetDetailView'];

// The `release` blocks as the server sends them (ReleaseBlocks#view): status per locale key, in locale order.
const LOCALIZED: AssetDetailView['release'] = {
  de: { status: 'PUBLISHED', releasedRevision: 12, releasedAt: '2026-09-20T10:00:00Z', releasedBy: 1 },
  en: { status: 'CHANGED', releasedRevision: 12, releasedAt: '2026-09-20T10:00:00Z', releasedBy: 1 },
  fr: { status: 'NEW' },
};
const SHARED: AssetDetailView['release'] = { '': { status: 'PUBLISHED', releasedRevision: 3 } };

describe('release status util', () => {
  it('reads the editing locale, falling back to the shared key', () => {
    expect(statusFor(LOCALIZED, 'de')).toBe('PUBLISHED');
    expect(statusFor(LOCALIZED, 'en')).toBe('CHANGED');
    expect(statusFor(SHARED, 'en')).toBe('PUBLISHED');
    expect(statusFor(SHARED, null)).toBe('PUBLISHED');
    expect(releaseKeyFor(SHARED, 'de')).toBe('');
    // A language the block doesn't know (added after the asset) shows no badge rather than a wrong one.
    expect(statusFor(LOCALIZED, 'it')).toBeNull();
    expect(statusFor(undefined, 'de')).toBeNull();
  });

  it('summarizes every locale for the tooltip', () => {
    expect(statusSummary(LOCALIZED)).toBe('DE published · EN changed · FR new');
    expect(statusSummary(SHARED)).toBe('Published');
  });

  it('says a published asset stays online until the deletion is released', () => {
    expect(isOnline(LOCALIZED)).toBe(true);
    expect(deleteQuestion('Delete "Home"? This cannot be undone.', LOCALIZED)).toBe(
      'Delete "Home"? It stays online until you release the deletion.',
    );
    expect(deleteQuestion('Delete "Home"? You can restore it from its history.', SHARED)).toBe(
      'Delete "Home"? You can restore it from its history. It stays online until you release the deletion.',
    );
    // A never-released asset is deleted at once: today's text.
    expect(deleteQuestion('Delete "Draft"? This cannot be undone.', { de: { status: 'NEW' } })).toBe(
      'Delete "Draft"? This cannot be undone.',
    );
  });

  it('offers the locales a mode applies to, with the editing locale ticked', () => {
    const subject = { uuid: 'page-1', displayName: 'Home', release: LOCALIZED };
    const release = choicesFor(subject, 'release', 'en', (code) => ({ de: 'Deutsch', en: 'English', fr: 'Français' })[code] ?? code);
    expect(release.map((choice) => [choice.locale, choice.checked])).toEqual([
      ['en', true],
      ['fr', false],
    ]);
    expect(release[0].label).toBe('English (EN) — Changed');
    // What "Redirect old URL to…" needs to know about the page (M30.6.3).
    const page = choicesFor({ ...subject, type: 'PAGE', folderPath: '/about/' }, 'unpublish', 'de')[0];
    expect([page.assetType, page.assetName, page.folderPath]).toEqual(['PAGE', 'Home', '/about/']);
    expect(itemsOf(release)).toEqual([{ assetUuid: 'page-1', locale: 'en' }]);

    // The editing locale has nothing to unpublish: nothing is preselected among several.
    const unpublish = choicesFor(subject, 'unpublish', 'fr');
    expect(unpublish.map((choice) => choice.checked)).toEqual([false, false]);

    // The shared key travels as "no locale" (every locale).
    const shared = choicesFor({ uuid: 'media-1', release: { '': { status: 'CHANGED' } } }, 'discard', 'de');
    expect(itemsOf(shared)).toEqual([{ assetUuid: 'media-1' }]);
  });
});
