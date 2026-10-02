import { describe, expect, it } from 'vitest';
import { areaNav } from './area-nav';
import { KNOWN_SUBS } from './frame-location';

const ids = (area: Parameters<typeof areaNav>[0], developerMode = true, projectAdmin = true) =>
  areaNav(area, { developerMode, projectAdmin }).map((entry) => entry.id);

describe('areaNav', () => {
  it('lists Publishing as runs, targets and policy, then the checks', () => {
    const entries = areaNav('publishing', { developerMode: false, projectAdmin: false });
    expect(entries.map((e) => e.id)).toEqual(['runs', 'targets', 'policy', 'quality', 'redirects', 'urls']);
    expect(entries.filter((e) => e.group === 'checks').map((e) => e.id)).toEqual(['quality', 'redirects', 'urls']);
  });

  it('groups Settings as project, maintenance and people (M35.9 decision 32)', () => {
    const groups = areaNav('settings', { developerMode: true, projectAdmin: true }).map((e) => `${e.group}:${e.id}`);
    expect(groups).toEqual([
      'project:general',
      'project:languages',
      'project:channels',
      'project:media',
      'project:code-highlighting',
      'maintenance:compaction',
      'maintenance:import-export',
      'people:members',
    ]);
  });

  it('hides Channels outside developer mode and Compaction from anyone who does not administer the project', () => {
    expect(ids('settings', false, true)).not.toContain('channels');
    expect(ids('settings', true, false)).not.toContain('compaction');
    expect(ids('settings', true, true)).toEqual(expect.arrayContaining(['channels', 'compaction']));
  });

  it('only lists pages the frame can name (breadcrumb and title)', () => {
    expect(ids('publishing').sort()).toEqual([...(KNOWN_SUBS['publishing'] ?? [])].sort());
    expect(ids('settings').sort()).toEqual([...(KNOWN_SUBS['settings'] ?? [])].sort());
  });
});
