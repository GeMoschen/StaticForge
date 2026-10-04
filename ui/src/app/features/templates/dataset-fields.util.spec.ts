import { describe, expect, it } from 'vitest';
import type { EditorDefinition } from '../forms/form.model';
import { datasetFields, ruleCount } from './dataset-fields.util';

const RULES = `rule "title-length" on name { level warning assert "length(value) <= 70" message { en "x" } }
state name { requiredWhen "true" }
fill slug { value "name" on [save] }
rule "other" on names { level info }`;

describe('dataset fields', () => {
  it('counts the rules, states and fills that target a field, and not fields with a longer name', () => {
    expect(ruleCount(RULES, 'name')).toBe(2);
    expect(ruleCount(RULES, 'slug')).toBe(1);
    expect(ruleCount(RULES, 'role')).toBe(0);
    expect(ruleCount('', 'name')).toBe(0);
  });

  it('lists the editors of the compiled definition, flattening groups', () => {
    const editors = [
      { name: 'name', type: 'TEXT', label: 'Name', required: true, localizable: true },
      { name: 'meta', type: 'GROUP', items: [{ name: 'slug', type: 'TEXT' }] },
      { name: 'price', type: 'NUMBER', label: 'Price' },
    ] as unknown as EditorDefinition[];
    expect(datasetFields(editors, RULES)).toEqual([
      { name: 'name', label: 'Name', type: 'text', required: true, localized: true, rules: 2 },
      { name: 'slug', label: 'slug', type: 'text', required: false, localized: false, rules: 1 },
      { name: 'price', label: 'Price', type: 'number', required: false, localized: false, rules: 0 },
    ]);
    expect(datasetFields(null, '')).toEqual([]);
  });
});
