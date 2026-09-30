---
id: M33.2
status: done
depends: [M33.1]
epic: m33-editor-rules
feature: cdl-rules-section
area: backend
---

# M33.2 — CDL `rules {}` section and built-in modifiers

## Context

`CdlLexer`, `CdlParser` (top-level blocks :97-110, attribute dispatch :202-261, `parseValidate` :279-304),
`CdlValidator`, `CdlCompiler`, `ContentDefinition`, `EditorDefinition`, `EffectiveDefinition` (M20),
`DatasetCdlRules`, `GlobalSetCdlRules`, `DiagnosticCodes`, `POST /projects/{p}/cdl/validate`. Epic decisions 1–4, 13;
user decisions 5, 12, 13, 15, 16, 21.

## Goals

- Parse the top-level `rules { … }` section with `rule`, `state`, `fill` and `rule "<name>" off` entries (syntax in
  epic decision 1) into a compiled `RuleSet` on `ContentDefinition`: `RuleDefinition(name, target, level, scopes,
  when, assert, messages, locales, onGeneration)`, `StateDefinition(path, requiredWhen, readOnlyWhen, level, scopes)`,
  `FillDefinition(path, value, mode, on)`, plus the `off` set.
- Target paths: `a.b` (groups), `list[]` rows (nested allowed), and the kind keyword (`page` / `section` / `record` /
  `global`) for the whole definition; resolved against the definition's editors.
- Built-in modifiers: `level`, `scope`, `onGeneration`, `message {…}` after `required`, `maxLength`, `maxChars`,
  `pattern`, `min`, `max`, `mimeTypes`, list/catalog cardinality and the `validate` clause; compiled into
  `EditorDefinition.builtinRules` (defaults per epic decision 2 when absent). `pattern … message "…"` becomes a
  message map `{ en "…" }`. `patternMessage` stays readable for one release as a derived accessor.
- Message maps `message { en "…" de "…" }` everywhere a message is accepted; placeholders validated
  (`{value}`, `{length}`, `{min}`, `{max}`, `{index}`, `{locale}`).
- Compile-time checks with codes `SF-CDL-0113`…`0119` (epic decision 13): required keys, `onGeneration` only with
  `generation` + `error`, `fill.on` ⊆ `{edit, save, release}`, unknown target/identifier via `identifiers()`,
  expression parse/arity/unknown function, `assert`/`when`/`requiredWhen`/`readOnlyWhen` statically non-boolean
  literals, duplicate names/fill paths, fill cycles, `locales` naming undeclared project locales (warning, the
  project's locales can change).
- `visibleWhen` parsed in v1 mode; v2-only syntax → `SF-CDL-0105`.
- Inheritance merge in `EffectiveDefinition` (epic decision 3): root-first, replace by rule name / state path / fill
  path, `off` removes; `SF-CDL-0118` for an unknown override target; a child's rules may target inherited editors;
  built-in overrides only on the declaring template (`SF-CDL-0119`).
- Overlays: `rules {}` is allowed for page and section templates, datasets and global sets; `on page` only in page
  templates (bodies/sections), `on section` only in section templates, etc.
- `/cdl/validate` returns the new diagnostics for every kind.

## Acceptance criteria

- [ ] Parser/compiler tests for every entry type, modifier and error code; round-trip of the epic README example.
- [ ] Inheritance tests: add, override by name, `off`, override of unknown name, rule targeting an inherited editor,
      built-in override in a child rejected.
- [ ] All existing CDL sources in tests and fixtures compile with identical `EditorDefinition` behavior (built-in
      defaults = today's semantics).
- [ ] `./gradlew build` green.

## Out of scope

- Evaluation (M33.3); UI syntax highlighting (M33.8).

## Notes / hazards

- Today unknown `validate` kinds and some attributes are silently dropped (`CdlParser` :254); inside `rules {}` every
  unknown key is an error (`SF-CDL-0113`) — do not change the lenient behavior outside `rules {}`.
- Keep the compiled rule set immutable and cache it with the compiled CDL (template cache, M2.4.3).
