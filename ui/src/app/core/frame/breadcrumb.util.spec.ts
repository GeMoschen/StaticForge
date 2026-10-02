import { describe, expect, it } from 'vitest';
import { buildBreadcrumb, collapseCrumbs, type Crumb } from './breadcrumb.util';
import { parseFrameLocation } from './frame-location';

const label = (key: string) => key.split('.').slice(-1)[0];
const build = (url: string, item: Parameters<typeof buildBreadcrumb>[0]['item'] = null) =>
  buildBreadcrumb({ location: parseFrameLocation(url), label, item });

describe('buildBreadcrumb', () => {
  it('is the area alone on a list screen, without a link on the current place', () => {
    expect(build('/p/acme/media')).toEqual([{ id: 'media', label: 'media' }]);
  });

  it('is area, folders, item; every segment but the last a link', () => {
    const crumbs = build('/p/acme/pages/p1', {
      label: 'Our story',
      trail: [
        { id: 'f1', label: 'Company', link: ['/p', 'acme', 'pages'] },
        { id: 'f2', label: 'About', link: ['/p', 'acme', 'pages'] },
      ],
    });
    expect(crumbs.map((c) => c.label)).toEqual(['pages', 'Company', 'About', 'Our story']);
    expect(crumbs[0].link).toEqual(['/p', 'acme', 'pages']);
    expect(crumbs[1].link).toBeDefined();
    expect(crumbs[3].link).toBeUndefined();
  });

  it('adds the settings, publishing and admin sub-pages, each linked below its own area', () => {
    const publishing = build('/p/acme/publishing/targets');
    expect(publishing.map((c) => c.label)).toEqual(['publishing', 'targets']);
    expect(publishing[0].link).toEqual(['/p', 'acme', 'publishing']);
    expect(build('/p/acme/publishing/targets/x')[1].id).toBe('publishing.targets');
    expect(build('/p/acme/history').map((c) => c.label)).toEqual(['history']);
    const settings = build('/p/acme/settings/members');
    expect(settings.map((c) => c.label)).toEqual(['settings', 'members']);
    expect(settings[0].link).toEqual(['/p', 'acme', 'settings']);
    expect(settings[1].link).toBeUndefined();
    expect(build('/p/acme/publishing/runs', { label: 'Run 5' })[1].link).toEqual(['/p', 'acme', 'publishing', 'runs']);
    const admin = build('/admin/audit');
    expect(admin.map((c) => c.label)).toEqual(['admin', 'audit']);
    expect(admin[0].link).toEqual(['/admin']);
  });

  it('leaves out an unknown sub-page, and calls an unknown area the project home', () => {
    expect(build('/p/acme/settings/nope').map((c) => c.label)).toEqual(['settings']);
    expect(build('/p/acme/whatever')).toEqual([{ id: 'home', label: 'home' }]);
    expect(build('/p/acme')).toEqual([{ id: 'home', label: 'home' }]);
  });

  it('names the project list and the account page', () => {
    expect(build('/')).toEqual([{ id: 'dashboard', label: 'dashboard' }]);
    expect(build('/account')).toEqual([{ id: 'account', label: 'account' }]);
    // A section of My account: the area links back, the section is the current place.
    expect(build('/account/password')).toEqual([
      { id: 'account', label: 'account', link: ['/account'] },
      { id: 'account.sub', label: 'password' },
    ]);
  });

  it('has nothing for a location outside the frame', () => {
    expect(build('/login')).toEqual([]);
  });
});

describe('collapseCrumbs', () => {
  const crumbs = (n: number): Crumb[] => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, label: `C${i}` }));

  it('keeps a short path whole', () => {
    expect(collapseCrumbs(crumbs(5))).toEqual({ head: crumbs(5), hidden: [], tail: [] });
  });

  it('folds the middle of a long path into the menu: the first and the last three stay', () => {
    const result = collapseCrumbs(crumbs(8));
    expect(result.head.map((c) => c.id)).toEqual(['c0']);
    expect(result.hidden.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(result.tail.map((c) => c.id)).toEqual(['c5', 'c6', 'c7']);
  });

  it('hides at least two segments, never one', () => {
    expect(collapseCrumbs(crumbs(6)).hidden).toHaveLength(2);
  });
});
