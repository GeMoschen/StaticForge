import { describe, expect, it } from 'vitest';
import { ExpressionEvaluator } from './expression-evaluator';
import fixtures from './expression.fixtures.json';

interface Fixture {
  expression: string;
  scope: Record<string, unknown>;
  result: boolean;
}

const cases = fixtures as unknown as Fixture[];

describe('ExpressionEvaluator', () => {
  const evaluator = new ExpressionEvaluator();

  it('returns true for blank/empty expressions', () => {
    expect(evaluator.evaluate('', {})).toBe(true);
    expect(evaluator.evaluate('   ', {})).toBe(true);
  });

  it.each(cases)('evaluates the shared fixture %s', (fixture) => {
    expect(evaluator.evaluate(fixture.expression, fixture.scope)).toBe(fixture.result);
  });

  it('collects referenced identifiers', () => {
    expect(evaluator.identifiers('a.b > 5 && c in [1, 2]')).toEqual(['a.b', 'c']);
  });
});
