import '@angular/compiler';
import { FormGroup } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import { FormBuilderService } from '../form-builder.service';
import type { ContentDefinition } from '../form.model';
import { FillTracker, applyFieldStates, byLevel, controlAt, inLocale, isEmptyValue, pathSteps } from './rule-form.util';

const definition = {
  editors: [
    { name: 'title', type: 'TEXT' },
    { name: 'slug', type: 'TEXT' },
    { name: 'path', type: 'TEXT' },
    { name: '_group_1', type: 'GROUP', items: [{ name: 'teaser', type: 'TEXT' }] },
    { name: 'gallery', type: 'LIST', items: [{ name: 'caption', type: 'TEXT' }] },
    { name: 'fixed', type: 'TEXT', readOnly: true },
  ],
  bodies: [],
} as unknown as ContentDefinition;

function form(value: Record<string, unknown> = {}): FormGroup {
  return new FormBuilderService().build(definition, value);
}

describe('rule paths', () => {
  it('splits a content path into fields and rows', () => {
    expect(pathSteps('content.gallery[2].caption', 'content')).toEqual([
      { name: 'gallery', rows: [2] },
      { name: 'caption', rows: [] },
    ]);
    expect(pathSteps('bodies.main[0].content.x', 'content')).toBeNull();
  });

  it('finds controls through transparent groups and list rows', () => {
    const f = form({ teaser: 'T', gallery: [{ caption: 'a' }, { caption: 'b' }] });
    expect(controlAt(f, definition.editors, 'content.teaser')?.value).toBe('T');
    expect(controlAt(f, definition.editors, 'content.gallery[1].caption')?.value).toBe('b');
    expect(controlAt(f, definition.editors, 'content.gallery[5].caption')).toBeNull();
    expect(controlAt(f, definition.editors, 'content.nope')).toBeNull();
  });

  it('knows empty values', () => {
    expect(isEmptyValue('  ')).toBe(true);
    expect(isEmptyValue([])).toBe(true);
    expect(isEmptyValue({ format: 'html', value: '' })).toBe(true);
    expect(isEmptyValue({ type: 'MEDIA_REF', uuid: null })).toBe(true);
    expect(isEmptyValue('x')).toBe(false);
    expect(isEmptyValue(0)).toBe(false);
  });
});

describe('FillTracker', () => {
  it('fills an empty field and keeps following until the user types their own value', () => {
    const f = form({ title: 'Hello' });
    const fills = new FillTracker();

    expect(fills.apply([{ path: 'content.slug', value: 'hello' as never, mode: 'EMPTY' }], f, definition.editors)).toEqual([
      'content.slug',
    ]);
    expect(f.get('slug')?.value).toBe('hello');

    // Still the last fill: the next request asks the server again, and its new value is applied.
    const prepared = fills.prepare({ title: 'Hello World', slug: 'hello' }, f, definition.editors);
    expect(prepared['slug']).toBeNull();
    fills.apply([{ path: 'content.slug', value: 'hello-world' as never, mode: 'EMPTY' }], f, definition.editors);
    expect(f.get('slug')?.value).toBe('hello-world');

    // The user's own slug is kept, and no longer blanked for the server.
    f.get('slug')?.setValue('mine');
    expect(fills.prepare({ slug: 'mine' }, f, definition.editors)['slug']).toBe('mine');
    fills.apply([{ path: 'content.slug', value: 'other' as never, mode: 'EMPTY' }], f, definition.editors);
    expect(f.get('slug')?.value).toBe('mine');
  });

  it('always overwrites a mode always field', () => {
    const f = form({ path: '/typed' });
    new FillTracker().apply([{ path: 'content.path', value: '/x/a' as never, mode: 'ALWAYS' }], f, definition.editors);
    expect(f.get('path')?.value).toBe('/x/a');
  });

  it('leaves a fill of another language to the save, and does not emit a change', () => {
    const f = form();
    let changes = 0;
    f.valueChanges.subscribe(() => changes++);
    const fills = new FillTracker();
    fills.apply([{ path: 'content.slug', locale: 'de', value: 'x' as never, mode: 'EMPTY' }], f, definition.editors, 'en');
    expect(f.get('slug')?.value).toBe('');
    fills.apply([{ path: 'content.slug', locale: 'en', value: 'x' as never, mode: 'EMPTY' }], f, definition.editors, 'en');
    expect(f.get('slug')?.value).toBe('x');
    expect(changes).toBe(0);
  });
});

describe('applyFieldStates', () => {
  it('disables read-only fields and enables them again when the state goes, never a definition read-only one', () => {
    const f = form();
    let disabled = applyFieldStates(
      [
        { path: 'content.slug', readOnly: true },
        { path: 'content.fixed', readOnly: true },
        { path: 'content.title', required: true },
      ],
      f,
      definition.editors,
      new Set(),
    );
    expect(f.get('slug')?.disabled).toBe(true);
    expect(f.get('title')?.disabled).toBe(false);

    disabled = applyFieldStates([], f, definition.editors, disabled);
    expect(f.get('slug')?.disabled).toBe(false);
    // `fixed` was read-only before the rules: it was never the rules' to enable.
    expect(f.get('fixed')?.disabled).toBe(true);
    expect(disabled.size).toBe(0);
  });
});

describe('levels', () => {
  it('orders errors, warnings, infos and hints', () => {
    const sorted = byLevel([{ severity: 'HINT' }, { severity: 'INFO' }, { severity: 'ERROR' }, { severity: 'WARNING' }]);
    expect(sorted.map((f) => f.severity)).toEqual(['ERROR', 'WARNING', 'INFO', 'HINT']);
  });

  it('shows a finding only in its language', () => {
    expect(inLocale({ locale: 'de' }, 'en')).toBe(false);
    expect(inLocale({ locale: 'en' }, 'en')).toBe(true);
    expect(inLocale({}, 'en')).toBe(true);
    expect(inLocale({ locale: 'de' }, null)).toBe(true);
  });
});
