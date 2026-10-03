import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { acceptsAlt, mimeAllowed, nextFreeName, uploadFailure } from './media-upload.util';

describe('nextFreeName', () => {
  it('numbers from 2 before the extension and skips names that are taken, whatever their case', () => {
    expect(nextFreeName('logo.png', new Set())).toBe('logo-2.png');
    expect(nextFreeName('logo.png', new Set(['logo-2.png', 'logo-3.png']))).toBe('logo-4.png');
    expect(nextFreeName('Logo.PNG', new Set(['logo-2.png']))).toBe('Logo-3.PNG');
  });

  it('handles names without an extension and dotfiles', () => {
    expect(nextFreeName('README', new Set())).toBe('README-2');
    expect(nextFreeName('.htaccess', new Set())).toBe('.htaccess-2');
    expect(nextFreeName('a.tar.gz', new Set())).toBe('a.tar-2.gz');
  });
});

describe('mimeAllowed', () => {
  it('accepts everything for * (the server default), for no list and for a file the browser could not type', () => {
    expect(mimeAllowed('application/x-msdownload', ['*'])).toBe(true);
    expect(mimeAllowed('application/x-msdownload', ['*/*'])).toBe(true);
    expect(mimeAllowed('application/x-msdownload', [])).toBe(true);
    expect(mimeAllowed('application/x-msdownload', undefined)).toBe(true);
    expect(mimeAllowed('', ['image/*'])).toBe(true);
  });

  it('matches families and exact types, not their prefixes', () => {
    const list = ['image/*', 'application/pdf'];
    expect(mimeAllowed('image/png', list)).toBe(true);
    expect(mimeAllowed('IMAGE/SVG+XML', list)).toBe(true);
    expect(mimeAllowed('application/pdf', list)).toBe(true);
    expect(mimeAllowed('application/pdfx', list)).toBe(false);
    expect(mimeAllowed('text/css', list)).toBe(false);
    expect(mimeAllowed('imagery/png', list)).toBe(false);
  });
});

describe('uploadFailure', () => {
  const http = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

  it('reads a lost connection (status 0) and anything that is not an HTTP answer as network', () => {
    expect(uploadFailure(http(0))).toEqual({ error: 'network' });
    expect(uploadFailure(new Error('boom'))).toEqual({ error: 'network' });
  });

  it('maps 413 to size and 415 to type', () => {
    expect(uploadFailure(http(413, { detail: 'too big' }))).toEqual({ error: 'size' });
    expect(uploadFailure(http(415))).toEqual({ error: 'type' });
  });

  it('keeps the problem detail (or title) of any other answer', () => {
    expect(uploadFailure(http(422, { title: 'Unprocessable Entity', detail: 'Image exceeds 12000px.' }))).toEqual({ error: 'server', detail: 'Image exceeds 12000px.' });
    expect(uploadFailure(http(500, { title: 'Internal Server Error' }))).toEqual({ error: 'server', detail: 'Internal Server Error' });
    expect(uploadFailure(http(502))).toEqual({ error: 'server', detail: undefined });
  });
});

describe('acceptsAlt', () => {
  it('is for pictures', () => {
    expect(acceptsAlt('image/jpeg')).toBe(true);
    expect(acceptsAlt('image/svg+xml')).toBe(true);
    expect(acceptsAlt('application/pdf')).toBe(false);
    expect(acceptsAlt(undefined)).toBe(false);
  });
});
