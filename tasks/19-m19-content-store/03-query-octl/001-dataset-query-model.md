---
id: M19.3.1
status: done
depends: []
epic: m19-content-store
feature: query-octl
area: backend
---

# M19.3.1 — Pure dataset query model (`where` / `sort` / `limit` / `offset` / `folder`)

## Context

`sf-template` already has an expression AST, `octl/Expr` (`Literal`, `Access` with filters, `Group`,
`Not`, `And`, `Or`, `Cmp` with `== != < > <= >= in`), parsed by `OctlParser` for `$CMS_IF` and
evaluated by `OctlRenderer`. Separately, `expression/ExpressionEvaluator` implements the tiny CDL
`visibleWhen` grammar shared with the Angular form engine (`ui/src/app/features/forms/expression-evaluator.ts`)
through a common fixture file. `$CMS_FOR` today accepts `var : accessor [, namedArgs]`
(`OctlParser.parseFor` → `parseNamedArgs`), with no filter chain on the source.

## Goals

- New package `com.acme.staticforge.template.query` (sf-template, no Spring/DB):
  - `DatasetQuery(Expr where, List<SortKey> sort, Integer limit, Integer offset, String folder)` and
    `SortKey(String path, Direction dir)`.
  - `DatasetQueryParser.parse(Map<String,String> namedArgs, String loopVariable)` → `DatasetQuery` +
    `List<Diagnostic>`: `where` parsed with the **OCTL expression parser** (`Expr`), identifiers
    rooted at the loop variable (`member.role`) — also accept bare field names only if that does not
    create ambiguity with `$CMS_SET` variables (decide, document, test); `sort="name,-joined"` (minus
    = descending); `limit`/`offset` non-negative integers; `folder` a Content folder path prefix.
  - `DatasetQueryEvaluator.apply(List<RecordView> records, DatasetQuery q)` → ordered sublist;
    `RecordView(uuid, uid, displayName, folderPath, changedAt, JsonNode content)` exposing
    `_uuid`, `_uid`, `_displayName`, `_folderPath`, `_changedAt` plus content fields.
- Semantics (documented in Javadoc + tested):
  - Comparisons: numbers numerically, ISO date/datetime strings chronologically, strings
    case-sensitively with `==`; `in` against array literals; typed values (`ASSET_REF` → compares its
    `uuid`; boolean editors as booleans). Type mismatch → false, never an exception.
  - Sorting: stable, multi-key; nulls/missing last in both directions; strings compared with a
    fixed, locale-independent collation (`Locale.ROOT`, case-insensitive then case-sensitive
    tie-break) so generation output is deterministic across JVMs.
  - Order of operations: folder → where → sort → offset → limit. Default sort when none given:
    `_displayName asc, _uid asc` (deterministic).
- New diagnostic codes in `DiagnosticCodes` (next free `SF-TPL-01xx`, e.g. `SF-TPL-0140` invalid
  query argument, `SF-TPL-0141` unknown sort field when a `ContentDefinition` is available).
- Field validation hook: when given the dataset's `ContentDefinition`, report unknown field names
  in `where`/`sort` and sorting on non-scalar editor types.

## Acceptance criteria

- [x] Unit tests cover each operator × type, `&&`/`||`/`!`/groups, nulls, `in`, date comparison,
      multi-key sort with ties, offset beyond size, `limit=0`, invalid inputs → diagnostics with
      line/column.
- [x] Property test: `apply` is deterministic (same input → same order) and `limit`/`offset` never
      exceed bounds.
- [x] No dependency from `template.query` on sf-domain/Spring (module layering gate green).
- [x] `ExpressionEvaluator` and the `visibleWhen` fixture file are untouched.

## Out of scope

- OCTL wiring and resolvers (`M19.3.2`), SQL pushdown, full-text matching, aggregate functions
  (`count`, `group by`), locale-aware collation (`M24.3.3`).

## Notes / hazards

- **Two grammars.** Reusing `Expr` keeps one OCTL grammar for `$CMS_IF` and `where`; extending the
  `visibleWhen` grammar would force a matching change in the TypeScript evaluator and the shared
  fixture. Do not do that here.
- Named-arg values are string literals; `where="a == 'x'"` needs quoting rules that survive the
  `$CMS_…$` lexer (`$$` escapes, nested quotes). Add explicit parser tests for quotes inside `where`.
- `M21.2.1` (pagination) needs the item **count** before rendering: expose a
  `count(records, query-without-limit-offset)` path so the planner does not re-implement filtering.

## Implementation notes (2026-09-16)

- `sf-template` `template.query`: `DatasetQuery`, `DatasetQueryParser` (args → query, `SF-TPL-0140`; `validateFields`
  → `SF-TPL-0141`/`0142`), `DatasetQueryEvaluator` (folder → where → sort → offset → limit), `RecordView`,
  `SortKey`. `where` is parsed by the new strict `octl.OctlExpressions.parse` (the `$CMS_IF` grammar).
- Semantics: numbers numeric, ISO dates/date-times chronological (UTC), other strings case-sensitive, references as
  uuid, missing = null, cross-type ordering false; sort stable with precomputed keys, missing last both directions,
  locale-independent case-insensitive collation, tie-break `_displayName`, `_uid`.
- Tests: `DatasetQueryParserTest`, `DatasetQueryEvaluatorTest`, `DatasetQueryPropertiesTest` (jqwik: determinism,
  bounds). `ExpressionEvaluator` and the `visibleWhen` fixture are untouched.
