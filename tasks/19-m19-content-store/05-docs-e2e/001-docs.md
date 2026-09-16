---
id: M19.5.1
status: done
depends: [M19.3.2, M19.4.2]
epic: m19-content-store
feature: docs-e2e
area: fullstack
---

# M19.5.1 — Documentation for datasets and records

## Context

Docs: `docs/template-developer-guide.md` (OCTL instruction table §2.1, scopes §2.5, diagnostics
Part 3), `docs/editors/*.md` (per-editor reference, incl. `reference.md`), `docs/user-guide.md`,
`docs/api.md`, `docs/architecture.md` (§3 domain model), `cms-specification.md`.

## Goals

- Template developer guide: `$CMS_FOR(x : dataset:uid, where, sort, limit, offset, folder)$` with
  semantics (types, nulls, default sort, order of operations), `record:` prefix, reference
  dereferencing, loop meta fields `_uuid/_uid/_displayName/_folderPath/_changedAt`, new diagnostic
  codes, the dependency/rebuild granularity note, a worked "team page" example (HTML + Markdown).
- `docs/editors/reference.md`: `dataset "…"` attribute; `docs/editors/README.md`: dataset schemas use
  CDL editors but no bodies.
- User guide: Content store, creating records, grid filtering (with `where` examples), usages.
- API docs: new endpoints and listing parameters.
- Architecture map §3: `DATASET`/`RECORD`, `template_asset_id` reuse; spec follow-ups: §3 glossary,
  §16.2 table, Appendix C Q7 status "Resolved in M19".

## Acceptance criteria

- [x] Every example in the docs is copied from a passing golden-file case or test fixture (no
      hand-written untested snippets).
- [x] Diagnostic tables list the new `SF-TPL-*`/`SF-CDL-*` codes with the emitting class.
- [x] Links resolve (no dangling relative links in `docs/`).

## Out of scope

- Localization docs (`M24.6.1`), pagination docs (`M21.5.1`).

## Notes / hazards

- Keep the `visibleWhen` grammar docs unchanged and explicitly contrast them with the `where`
  grammar, since both appear in the same guide.

## Implementation notes (2026-09-16)

- `docs/template-developer-guide.md` §2.9 (loop arguments, semantics, `record:`, dereference, dependency granularity,
  worked HTML + Markdown example) and diagnostics rows `SF-TPL-0140/0141/0142`, `SF-CDL-0108`, extended `0105`.
- Every worked snippet is marked `<!-- golden: … -->` and compared to its golden file by `DocsGoldenSnippetsTest`.
- `docs/editors/reference.md` (`dataset` attribute, record dereference), `docs/editors/README.md` (`dataset` finding),
  `docs/user-guide.md` (Content), `docs/api.md` §6.2 + `SF-DOM-0121`, `docs/architecture.md` §3,
  `cms-specification.md` §3 glossary, §16.2, Appendix C Q7 "Resolved in M19". Relative links checked.
