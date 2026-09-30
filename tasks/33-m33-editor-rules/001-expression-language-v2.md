---
id: M33.1
status: done
depends: []
epic: m33-editor-rules
feature: expression-language-v2
area: backend
---

# M33.1 — Expression language v2

## Context

`server/sf-template/…/template/expression/ExpressionEvaluator.java` (boolean-only, 309 lines), its tests,
`ui/src/app/features/forms/expression.fixtures.json`. Epic decision 4; user decision 6.

## Goals

- Split the evaluator into lexer → parser (AST) → interpreter so an expression compiles once and runs many times
  (`CompiledExpression`), keeping the public `evaluate(expr, scope)` for `visibleWhen`.
- v2 grammar: arithmetic `+ - * / %` (string `+` concatenates), ternary `?:`, `??`, comparisons, `and`/`or`/`!`,
  `in`, list literals, function calls; value results (string, decimal number, boolean, null, list, object,
  date/datetime).
- A function registry with the initial set from decision 4 (`length`, `isEmpty`, `count`, `matches`, `lower`, `upper`,
  `trim`, `substring`, `concat`, `slugify`, `stripTags`, `wordCount`, `now`, `today`, `date`, `daysBetween`, `min`,
  `max`, `sum`, `any`, `all`, `sections`, `ref`); `sections` and `ref` delegate to a pluggable `ExpressionHost`
  (provided by the rule engine in M33.3). `now`/`today` read an injected `Clock`.
- An evaluation context abstraction (`ExpressionScope`) with the named roots `value`, `item`, `index`, `parent`,
  `locale`, `defaultLocale`, `page`/`record`/`global`/`section`, `release`, `body`, `global:<set>` and the root
  content fields.
- A **v1 mode** (the current grammar incl. the single-`=` quirk) used for `visibleWhen`; v2-only syntax in v1 mode is
  a parse error (→ `SF-CDL-0105` in M33.2).
- `identifiers()` returns the root paths an expression reads, for compile-time checks (M33.2) and dependency ordering
  of fills (M33.3).
- Bounded evaluation: step budget / timeout, regex match-time limit (ReDoS), no reflection.

## Acceptance criteria

- [ ] Unit tests per operator, function (incl. null handling and type errors), ternary/`??`, dates across time zones,
      decimal arithmetic without float drift, `slugify` of umlauts/unicode.
- [ ] All existing `visibleWhen` tests and the shared fixture file pass unchanged in v1 mode; a backend test now reads
      `expression.fixtures.json` too (Finding 2).
- [ ] Evaluation errors are typed (`ExpressionError` with position) and never throw out of `evaluate` unchecked.
- [ ] Budget/regex limits covered by tests (a catastrophic-backtracking regex finishes within the limit).
- [ ] `./gradlew build` green.

## Out of scope

- CDL syntax (M33.2), the rule context provider and `ref` resolution (M33.3), the TS evaluator (unchanged: the UI
  keeps v1 for `visibleWhen`).

## Notes / hazards

- Keep v1 behavior bit-for-bit (`in` against a string = substring, missing identifier = `null`, `=` as `==`).
- Numbers: use `BigDecimal` for arithmetic, compare numerically across int/decimal JSON values.
