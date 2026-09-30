import '@angular/compiler';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { FormBuilderService } from '../form-builder.service';
import type { ContentDefinition } from '../form.model';
import { NestedRules } from './nested-rules';
import { RuleBinding } from './rule-binding';
import type { RuleEvaluationRequest, RuleEvaluationView } from './rule-evaluator';
import { RuleHub } from './rule-hub';
import { pathOfControl } from './rule-form.util';

const card = {
  editors: [
    { name: 'title', type: 'TEXT' },
    { name: 'slug', type: 'TEXT' },
  ],
  bodies: [],
} as unknown as ContentDefinition;

const record = {
  editors: [
    { name: '_group_1', type: 'GROUP', items: [{ name: 'teasers', type: 'CATALOG' }] },
    { name: 'rows', type: 'LIST', items: [{ name: 'cards', type: 'CATALOG' }] },
  ],
  bodies: [],
} as unknown as ContentDefinition;

describe('pathOfControl', () => {
  it('finds a catalog through groups and list rows', () => {
    const form = new FormBuilderService().build(record, { rows: [{ cards: null }, { cards: null }] });
    const inGroup = form.get(['_group_1', 'teasers'])!;
    const inRow = form.get(['rows', 1, 'cards'])!;
    expect(pathOfControl(form, record.editors, inGroup, 'content')).toBe('content.teasers');
    expect(pathOfControl(form, record.editors, inRow, 'bodies.main[0].content')).toBe('bodies.main[0].content.rows[1].cards');
  });
});

describe('NestedRules', () => {
  const prefix = 'content.teasers.cards[0].content';

  it('applies the fills and states under its prefix and blanks its last fill in the next request', () => {
    const hub = new RuleHub();
    const form = new FormBuilderService().build(card, { title: 'Hello' });
    const nested = new NestedRules();
    nested.attach(hub, prefix, () => form, () => card.editors);

    const view: RuleEvaluationView = {
      findings: [],
      fills: [
        { path: `${prefix}.slug`, value: 'hello' as never, mode: 'EMPTY' },
        { path: 'content.teasers.cards[1].content.slug', value: 'other' as never, mode: 'EMPTY' },
      ],
      fieldStates: [{ path: `${prefix}.title`, readOnly: true }],
    };
    expect(nested.apply(view, form, card.editors, null)).toBe(true);
    expect(form.get('slug')?.value).toBe('hello');
    expect(form.get('title')?.disabled).toBe(true);

    const root = { content: { teasers: { type: 'CATALOG', cards: [{ content: { title: 'Hello', slug: 'hello' } }] } } };
    hub.prepare(root);
    expect(root.content.teasers.cards[0].content.slug).toBeNull();

    nested.detach();
    const again = { content: { teasers: { type: 'CATALOG', cards: [{ content: { slug: 'hello' } }] } } };
    hub.prepare(again);
    expect(again.content.teasers.cards[0].content.slug).toBe('hello');
  });
});

describe('RuleBinding with nested forms', () => {
  it('lets nested forms blank their fills in copies and publishes each answer on its hub', () => {
    const sent: RuleEvaluationRequest[] = [];
    const answer: RuleEvaluationView = { findings: [], fills: [], fieldStates: [] };
    const binding = new RuleBinding((request) => {
      sent.push(request);
      return of(answer);
    });
    const bodies = { main: [{ content: { slug: 'auto' } }] };
    binding.hub.register((root) => {
      (root['bodies'] as typeof bodies).main[0].content.slug = null as never;
    });
    const form = new FormBuilderService().build(card, {});
    binding.bind({
      form,
      editors: card.editors,
      locale: null,
      content: () => ({}),
      request: (content) => ({ kind: 'PAGE', content: content as never, bodies: bodies as never }),
    });

    expect((sent[0].bodies as unknown as typeof bodies).main[0].content.slug).toBeNull();
    expect(bodies.main[0].content.slug).toBe('auto');
    expect(binding.hub.view()).toBe(answer);
  });
});
