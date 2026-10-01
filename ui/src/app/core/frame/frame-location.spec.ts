import { describe, expect, it } from 'vitest';
import { parseFrameLocation } from './frame-location';

describe('parseFrameLocation', () => {
  it('reads the project list, account and administration', () => {
    expect(parseFrameLocation('/')).toEqual({ kind: 'dashboard', projectKey: null, section: null, sub: null });
    expect(parseFrameLocation('/account')).toMatchObject({ kind: 'account', section: 'account' });
    expect(parseFrameLocation('/admin/jobs/nightly')).toMatchObject({ kind: 'admin', section: 'admin', sub: 'jobs' });
    expect(parseFrameLocation('/admin')).toMatchObject({ kind: 'admin', sub: null });
  });

  it('reads a project and its area, ignoring query and fragment', () => {
    expect(parseFrameLocation('/p/acme/pages/abc?body=x#top')).toEqual({
      kind: 'project',
      projectKey: 'acme',
      section: 'pages',
      sub: null,
    });
    expect(parseFrameLocation('/p/acme')).toMatchObject({ kind: 'project', projectKey: 'acme', section: null });
  });

  it('gives only settings a sub-page; the id after another area is its item', () => {
    expect(parseFrameLocation('/p/acme/settings/generation')).toMatchObject({ section: 'settings', sub: 'generation' });
    expect(parseFrameLocation('/p/acme/content/records/r1')).toMatchObject({ section: 'content', sub: null });
  });

  it('decodes the project key and survives malformed escapes', () => {
    expect(parseFrameLocation('/p/my%20site/pages').projectKey).toBe('my site');
    expect(parseFrameLocation('/p/100%/pages').projectKey).toBe('100%');
  });

  it('calls anything else other', () => {
    expect(parseFrameLocation('/login').kind).toBe('other');
    expect(parseFrameLocation('/styleguide/sample').kind).toBe('other');
  });
});
