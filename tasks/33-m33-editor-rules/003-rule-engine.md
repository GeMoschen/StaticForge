---
id: M33.3
status: done
depends: [M33.2]
epic: m33-editor-rules
feature: rule-engine
area: backend
---

# M33.3 — Rule engine and finding model

## Context

`ContentValidator`, `PageContentValidator`, `PageContentValidation`, `ContentIssue`, `Severity` (sf-template),
`LocalizationContext`, snapshot views (`SnapshotView.DRAFT` / released), global set lookup. Epic decisions 4–6;
user decisions 3, 14, 15, 16, 20.

## Goals

- `Severity` → `HINT | INFO | WARNING | ERROR` (CDL/OCTL diagnostics keep using `ERROR`/`WARNING`).
- `ContentIssue` gains `rule`, `scopes`, `messages`, `locale`, `onGeneration`; `message` is resolved for a requested UI
  language (fallback: first entry). `blocks(scope)` helper. JSON shape stays backwards compatible (added fields only).
- `RuleScope { EDIT, SAVE, RELEASE, GENERATION }`.
- A pure `RuleEngine.evaluate(effectiveDefinition, content, scope, locales, RuleContextProvider, uiLanguage)` →
  `RuleOutcome { findings, fills: [{path, locale, value, mode}], fieldStates: [{path, locale, required, readOnly}] }`:
  1. `visibleWhen` visibility (as today; hidden editors are skipped by rules, states and fills),
  2. fills of the scope in dependency order (`identifiers()`), `mode empty` only into empty values,
  3. states (`requiredWhen` → `required` finding with the state's level/scopes; `readOnlyWhen` → field state),
  4. built-in completeness rules and custom rules of the scope, per locale (`locales` filter; built-in `required`
     default-locale only), per list row for `list[]` targets (`item`, `index`, `parent`), with `when` preconditions.
- `RuleContextProvider` supplies page/record/global meta, `release` status per locale, `global:` values, page bodies
  and section instances (`sections(...)`, `body.<name>`), the enclosing page for section rules, and `ref(value)`
  resolution — draft for EDIT/SAVE, released for RELEASE/GENERATION — with depth 1 and the 200-lookup cap. It records
  every resolved `ref` target (used by M33.7).
- `ContentValidator` keeps STRUCTURAL checks and delegates completeness to the engine; `PageContentValidator` runs
  section instances against their section template's rules with the page as `section.page`.
- Evaluation errors / limits become `warning` findings `rule-eval` (rule counts as passed); `{placeholders}` are
  filled from the context.

## Acceptance criteria

- [ ] Unit tests: each scope selects only its rules; levels; per-locale evaluation and `locales`; list rows; page →
      bodies/sections; section → page; `ref` draft vs released; fill ordering, `mode empty` vs `always`;
      `requiredWhen`/`readOnlyWhen`; hidden editors skipped; message language fallback; `rule-eval` on errors/limits.
- [ ] A definition without `rules {}` yields exactly today's `ContentIssue`s (codes, paths, severities) — existing
      `ContentValidator` / `PageContentValidator` tests green unchanged.
- [ ] Benchmark: a page with 10 rules × 3 locales evaluates in < 5 ms (warm).
- [ ] `./gradlew build` green.

## Out of scope

- Wiring into save (M33.4), edit endpoint (M33.5), release (M33.6), generation (M33.7).

## Notes / hazards

- Keep the engine free of Spring and repositories (like `ContentValidator`); the provider is the only I/O boundary so
  generation can back it with the snapshot.
- Fix on the way: list-item `visibleWhen` still receives the root scope (existing behavior) — do not change that
  semantics; rules on rows get `item` explicitly.
