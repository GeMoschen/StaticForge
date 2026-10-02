import { describe, expect, it } from 'vitest';
import { parseFrameLocation } from './frame-location';
import { activeRailItem, hasSettings, railGroups } from './rail-model';

const ids = (url: string, developerMode: boolean) =>
  railGroups({ location: parseFrameLocation(url), developerMode }).map((g) => [g.id, g.items.map((i) => i.id)]);

describe('railGroups (visibility matrix)', () => {
  it('shows an editor, or a developer with the mode off, no Develop group and no template item', () => {
    const groups = ids('/p/acme/pages', false);
    expect(groups.map(([id]) => id)).toEqual(['home', 'content', 'publish']);
    expect(JSON.stringify(groups)).not.toContain('templates');
  });

  it('adds Develop (Templates) in developer mode', () => {
    expect(ids('/p/acme/pages', true).map(([id]) => id)).toEqual(['home', 'content', 'publish', 'develop']);
    expect(ids('/p/acme/pages', true).at(-1)).toEqual(['develop', ['templates']]);
  });

  it('lists the content areas and the publish items in the decided order', () => {
    const groups = Object.fromEntries(ids('/p/acme/pages', false));
    expect(groups['content']).toEqual(['pages', 'media', 'content', 'navigation', 'globals']);
    expect(groups['publish']).toEqual(['changes', 'publishing', 'schedules']);
  });

  it('shows administration its own sections, whatever the developer mode', () => {
    expect(ids('/admin/users', true)).toEqual([['admin', ['users', 'projects', 'jobs', 'audit']]]);
  });

  it('has no rail on the project list or the account page', () => {
    expect(ids('/', true)).toEqual([]);
    expect(ids('/account', true)).toEqual([]);
  });

  it('puts Settings in the footer of a project only', () => {
    expect(hasSettings(parseFrameLocation('/p/acme/media'))).toBe(true);
    expect(hasSettings(parseFrameLocation('/admin'))).toBe(false);
  });
});

describe('activeRailItem', () => {
  const active = (url: string) => activeRailItem(parseFrameLocation(url));

  it('marks the area of a project screen, and Home at the project root', () => {
    expect(active('/p/acme/media')).toBe('media');
    expect(active('/p/acme/pages/p1')).toBe('pages');
    expect(active('/p/acme')).toBe('home');
  });

  it('marks Publishing for every publishing page and Settings for every settings page', () => {
    expect(active('/p/acme/publishing/runs')).toBe('publishing');
    expect(active('/p/acme/publishing/urls')).toBe('publishing');
    expect(active('/p/acme/settings/members')).toBe('settings');
    expect(active('/p/acme/history')).toBeNull();
  });

  it('marks the open administration section, and nothing for search or the project list', () => {
    expect(active('/admin/jobs')).toBe('jobs');
    expect(active('/p/acme/search')).toBeNull();
    expect(active('/')).toBeNull();
  });
});
