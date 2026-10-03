import { describe, expect, it } from 'vitest';
import { fileExtension, fileNameProblem } from './media-file-name.util';

describe('fileExtension', () => {
  it('is the lower-case text after the last dot, or nothing', () => {
    expect(fileExtension('Photo.JPG')).toBe('jpg');
    expect(fileExtension('archive.tar.gz')).toBe('gz');
    expect(fileExtension('README')).toBe('');
  });
});

describe('fileNameProblem (decision 93)', () => {
  const taken = new Set(['logo.png']);

  it('accepts a new name with the same extension', () => {
    expect(fileNameProblem('cover.jpg', 'photo.jpg', taken)).toBeNull();
    expect(fileNameProblem('  cover.JPG ', 'photo.jpg', taken)).toBeNull();
  });

  it('requires a name', () => {
    expect(fileNameProblem('   ', 'photo.jpg', taken)).toBe('required');
  });

  it.each(['a/b.jpg', 'a\\b.jpg', 'a:b.jpg', 'a*b.jpg', 'a?b.jpg', 'a"b.jpg', 'a<b.jpg', 'a>b.jpg', 'a|b.jpg'])(
    'refuses %s: none of / \\ : * ? " < > | is allowed',
    (name) => {
      expect(fileNameProblem(name, 'photo.jpg', taken)).toBe('characters');
    },
  );

  it('allows at most 100 characters', () => {
    expect(fileNameProblem(`${'a'.repeat(96)}.jpg`, 'photo.jpg', taken)).toBeNull();
    expect(fileNameProblem(`${'a'.repeat(97)}.jpg`, 'photo.jpg', taken)).toBe('tooLong');
  });

  it('keeps the extension: the file type stays the same', () => {
    expect(fileNameProblem('cover.png', 'photo.jpg', taken)).toBe('extension');
    expect(fileNameProblem('cover', 'photo.jpg', taken)).toBe('extension');
  });

  it('refuses a name another file of the folder has, whatever its case', () => {
    expect(fileNameProblem('Logo.PNG', 'photo.png', taken)).toBe('taken');
  });
});
