---
id: M33.7
status: done
depends: [M33.3]
epic: m33-editor-rules
feature: generation-scope
area: backend
---

# M33.7 — Generation scope and planner edge

## Context

`RenderPipeline.incompletePages` (:132-165, called :250; `new PageContentValidator()` at :70), `GenerationService`
(stages, run status), `GenerationDiagnosticCodes`, run record (§18.5: `error_count`, `warning_count`, `diagnostics`,
`heldBack[]`), build findings view, `BuildPlanner`, `RebuildEdgeKind`, rebuild reasons (M22). Epic decisions 10, 11;
user decisions 11, 20, 22.

## Goals

- VALIDATE stage runs the engine in `GENERATION` per page and locale on the snapshot (released view) with a real
  `LocalizationContext`, dataset and pagination-source lookups and a snapshot-backed `RuleContextProvider` (fixes the
  missing L10N context, Finding 6). Section instances are validated with their section templates' rules.
- `ERROR` + `holdBack` → hold back page/locale, one `SF-GEN-0120` diagnostic naming the failing rules (as today).
- `ERROR` + `fail` → keep validating all pages; after VALIDATE end the run `FAILED` with one `SF-GEN-0121` diagnostic
  per page/locale/rule; nothing rendered or published; the target keeps its previous state.
- `WARNING` / `INFO` findings stored as run diagnostics (warnings counted in `warning_count`, infos not counted) and
  returned by the findings API next to quality findings (type `RULE`).
- Planner: `RebuildEdgeKind.RULE_REFERENCE` — the `ref()` targets recorded during VALIDATE are persisted with the
  page's build facts; an incremental build makes a page a target when a rule-referenced asset changed; rebuild reason
  shows the edge. Preload the snapshot's referenced assets once per build.

## Acceptance criteria

- [ ] Integration tests: holdBack → `PARTIAL`; fail → `FAILED` with all failing pages reported, nothing published;
      warnings/infos in the run record and findings API; localized required checked like at release; changing a media's
      alt text re-validates (and holds back / releases) the referencing page in the next incremental build with reason
      `RULE_REFERENCE`.
- [ ] Existing generation tests green unchanged (except expected L10N fix adjustments, documented).
- [ ] Benchmark: 5,000-page full build with ~10 rules per template within +10 % of master.
- [ ] `./gradlew build` green.

## Out of scope

- Dry-run plan checks (M22 still runs none); quality checks (M30 unchanged).
