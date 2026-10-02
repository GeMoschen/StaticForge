import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { FormControl, Validators } from '@angular/forms';
import { FormBuilderService, englishMessage, errorMessageFor } from './form-builder.service';
import { ContentDefinition, EditorDefinition } from './form.model';

const definition = {
  editors: [
    { name: 'headline', type: 'TEXT' },
    {
      name: '_group_1',
      type: 'GROUP',
      label: 'SEO',
      items: [
        { name: 'metaTitle', type: 'TEXT', required: true },
        { name: 'metaDescription', type: 'TEXT' },
      ],
    },
    {
      name: 'links',
      type: 'LIST',
      items: [
        {
          name: '_group_2',
          type: 'GROUP',
          items: [{ name: 'label', type: 'TEXT' }],
        },
      ],
    },
  ],
} as unknown as ContentDefinition;

describe('FormBuilderService GROUP editors', () => {
  it('stores group children at the level of the group, not under the synthetic group name', () => {
    const fb = new FormBuilderService();
    const form = fb.build(definition, {});
    form.get('_group_1.metaTitle')!.setValue('Title');
    form.get('_group_1.metaDescription')!.setValue('Description');

    const value = fb.valueOf(definition, form);

    expect(value['metaTitle']).toBe('Title');
    expect(value['metaDescription']).toBe('Description');
    expect(value).not.toHaveProperty('_group_1');
  });

  it('seeds group children from top-level values', () => {
    const fb = new FormBuilderService();
    const form = fb.build(definition, { headline: 'H', metaTitle: 'Stored' });

    expect(form.get('_group_1.metaTitle')!.value).toBe('Stored');
  });

  it('reads values nested under the group name by older builds and flattens them on save', () => {
    const fb = new FormBuilderService();
    const form = fb.build(definition, { _group_1: { metaTitle: 'Legacy' } });

    const value = fb.valueOf(definition, form);

    expect(value['metaTitle']).toBe('Legacy');
    expect(value).not.toHaveProperty('_group_1');
  });

  it('flattens groups inside list rows', () => {
    const fb = new FormBuilderService();
    const form = fb.build(definition, { links: [{ label: 'First' }] });

    expect(form.get('links.0._group_2.label')!.value).toBe('First');
    expect(fb.valueOf(definition, form)['links']).toEqual([{ label: 'First' }]);
  });
});

describe('errorMessageFor (M35.17: texts under forms.editors.errors.*)', () => {
  const text = { name: 'x', type: 'TEXT' } as EditorDefinition;

  it('asks the translator for a key per error, with its numbers as parameters', () => {
    const asked: [string, unknown][] = [];
    const translate = (key: string, params?: Record<string, unknown>) => (asked.push([key, params]), key);
    const control = new FormControl('abcdef', Validators.maxLength(3));
    expect(errorMessageFor(text, control, translate)).toBe('forms.editors.errors.maxlength');
    expect(asked).toEqual([['forms.editors.errors.maxlength', { max: 3 }]]);
    expect(errorMessageFor(text, new FormControl('{', () => ({ json: true })), translate)).toBe('forms.editors.errors.json');
    expect(errorMessageFor(text, new FormControl(null, () => ({ listMin: { required: 2 } })), translate)).toBe('forms.editors.errors.listmin');
  });

  it('falls back to English when no translator is given, and prefers the pattern message of the template', () => {
    expect(errorMessageFor(text, new FormControl('abcdef', Validators.maxLength(3)))).toBe('Must be at most 3 characters');
    expect(errorMessageFor(text, new FormControl('abcdef', Validators.maxLength(3)))).toBe('Must be at most 3 characters');
    expect(errorMessageFor(text, new FormControl('x', () => ({ min: { min: 4 } })))).toBe('Must be at least 4');
    expect(errorMessageFor({ ...text, patternMessage: 'Use letters only' }, new FormControl('1', () => ({ pattern: {} })))).toBe('Use letters only');
    expect(errorMessageFor(text, new FormControl('ok'))).toBeNull();
    expect(englishMessage('forms.editors.errors.listmax', { required: 3 })).toBe('At most 3 rows allowed');
  });
});
