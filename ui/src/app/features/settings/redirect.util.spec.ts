import { describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import {
  indexFileNameOf,
  indexUidOf,
  normalizeSourcePath,
  normalizeTargetPath,
} from './redirect.util';

type ChannelView = components['schemas']['ChannelView'];

// Channels as ChannelController sends them: `settings` is the stored JSON object (JsonNode), `fileExtension` apart.
const HTML: ChannelView = { key: 'html', name: 'Website', fileExtension: 'html', isDefault: true, enabled: true };
const PRETTY: ChannelView = {
  key: 'web',
  name: 'Web',
  fileExtension: 'htm',
  settings: { indexFileName: 'default.htm', indexUid: 'start', urlStrategy: 'PRETTY' } as unknown as ChannelView['settings'],
};

describe('redirect.util', () => {
  it('reads the index file name and index uid of a channel, with the server defaults', () => {
    expect(indexFileNameOf(HTML)).toBe('index.html');
    expect(indexFileNameOf({ key: 'md', fileExtension: 'md' })).toBe('index.md');
    expect(indexFileNameOf(PRETTY)).toBe('default.htm');
    expect(indexFileNameOf(null)).toBe('index.html');
    expect(indexUidOf(HTML)).toBe('index');
    expect(indexUidOf(PRETTY)).toBe('start');
  });

  it('normalizes an old path typed as a URL path to the output path the registry stores', () => {
    expect(normalizeSourcePath('/old/page.html', 'index.html')).toEqual({ path: 'old/page.html' });
    expect(normalizeSourcePath('  old//./page.html ', 'index.html')).toEqual({ path: 'old/page.html' });
    expect(normalizeSourcePath('/old/page/', 'index.html')).toEqual({ path: 'old/page/index.html' });
    expect(normalizeSourcePath('/', 'default.htm')).toEqual({ path: 'default.htm' });
    expect(normalizeSourcePath('/%C3%BCber/a%20b.html', 'index.html')).toEqual({ path: 'über/a b.html' });
    // A plus is a plus in a path, not a space.
    expect(normalizeSourcePath('/c++.html', 'index.html')).toEqual({ path: 'c++.html' });
  });

  it('names why a path is refused, as a key of the dialog texts', () => {
    expect(normalizeSourcePath('  ', 'index.html')).toEqual({ error: 'fromEmpty' });
    expect(normalizeSourcePath('/a.html?x=1', 'index.html')).toEqual({ error: 'fromQuery' });
    expect(normalizeSourcePath('/a/../b.html', 'index.html')).toEqual({ error: 'dotDot' });
    expect(normalizeTargetPath('javascript:alert(1)', 'index.html')).toEqual({ error: 'scheme' });
    expect(normalizeTargetPath('', 'index.html')).toEqual({ error: 'toEmpty' });
  });

  it('refuses what the server refuses for a source path', () => {
    for (const bad of ['', '   ', '/a.html?x=1', '/a.html#top', '//host/a.html', 'https://example.org/a', '/a/../b.html', '/a\\b', '/%zz', '/a/ /b']) {
      expect(normalizeSourcePath(bad, 'index.html').error, bad).toBeTruthy();
    }
  });

  it('keeps absolute http(s) URLs and a target path’s query and fragment', () => {
    expect(normalizeTargetPath('https://example.org/new?x=1', 'index.html')).toEqual({ path: 'https://example.org/new?x=1' });
    expect(normalizeTargetPath('/docs/api.html#auth', 'index.html')).toEqual({ path: 'docs/api.html#auth' });
    expect(normalizeTargetPath('/docs/?v=2', 'index.html')).toEqual({ path: 'docs/index.html?v=2' });
    for (const bad of ['', 'javascript:alert(1)', 'mailto:a@b.c', '//evil.example/x', '?only=query', '/a b.html#x y', 'https://exa mple.org']) {
      expect(normalizeTargetPath(bad, 'index.html').error, bad).toBeTruthy();
    }
  });
});
