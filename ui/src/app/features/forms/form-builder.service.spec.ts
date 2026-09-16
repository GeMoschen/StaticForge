import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { FormBuilderService } from './form-builder.service';
import { ContentDefinition } from './form.model';

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
