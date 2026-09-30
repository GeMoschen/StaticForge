import { describe, expect, it } from 'vitest';
import { extensionOf, resolveCodeFormat } from './code-format';

describe('resolveCodeFormat', () => {
  it('detects by MIME type before extension', () => {
    expect(resolveCodeFormat({ extension: 'txt', mimeType: 'text/html; charset=utf-8' }).format).toBe('HTML');
    expect(resolveCodeFormat({ extension: 'md' }).format).toBe('MARKDOWN');
    expect(resolveCodeFormat({ mimeType: 'application/rss+xml' }).format).toBe('XML');
    expect(resolveCodeFormat({ mimeType: 'application/manifest+json' }).format).toBe('JSON');
    expect(resolveCodeFormat({ extension: '.YML' }).format).toBe('YAML');
    expect(resolveCodeFormat({ extension: 'tpl', mimeType: 'text/plain' }).format).toBe('PLAIN');
    expect(resolveCodeFormat({}).format).toBe('PLAIN');
  });

  it("lets the project's overrides win over detection, extension before MIME type", () => {
    const overrides = { extensions: { tpl: 'HTML', html: 'XML' }, mimeTypes: { 'text/plain': 'MARKDOWN', 'text/html': 'CSS' } };
    expect(resolveCodeFormat({ extension: 'tpl', mimeType: 'text/plain', overrides }).format).toBe('HTML');
    expect(resolveCodeFormat({ extension: 'txt', mimeType: 'text/plain', overrides }).format).toBe('MARKDOWN');
    expect(resolveCodeFormat({ extension: 'html', mimeType: 'text/html', overrides }).format).toBe('XML');
  });

  it("lets a channel's own setting win over everything, AUTO detects", () => {
    const overrides = { extensions: { html: 'XML' } };
    expect(resolveCodeFormat({ highlightAs: 'MARKDOWN', extension: 'html', overrides }).format).toBe('MARKDOWN');
    expect(resolveCodeFormat({ highlightAs: 'AUTO', extension: 'html', overrides }).format).toBe('XML');
    expect(resolveCodeFormat({ highlightAs: 'PLAIN', extension: 'html' }).format).toBe('PLAIN');
  });

  it('flags SVG only when highlighted as XML', () => {
    expect(resolveCodeFormat({ extension: 'svg' })).toEqual({ format: 'XML', svg: true });
    expect(resolveCodeFormat({ mimeType: 'image/svg+xml' })).toEqual({ format: 'XML', svg: true });
    expect(resolveCodeFormat({ extension: 'svg', highlightAs: 'HTML' })).toEqual({ format: 'HTML', svg: false });
  });

  it('reads the extension of a file name', () => {
    expect(extensionOf('icons/logo.SVG')).toBe('svg');
    expect(extensionOf('.htaccess')).toBeNull();
    expect(extensionOf('README')).toBeNull();
  });
});
