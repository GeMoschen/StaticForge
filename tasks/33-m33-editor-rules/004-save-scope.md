---
id: M33.4
status: done
depends: [M33.3]
epic: m33-editor-rules
feature: save-scope
area: backend
---

# M33.4 — Save scope: fills, read-only enforcement, rejection

## Context

`PageServiceImpl` (:91 PUT/autosave, :106/:110 PATCH content/body, :127/:180/:205 sections), `RecordServiceImpl`
(:152-164), `GlobalSetServiceImpl` (:125, :137, :214-224), `PageContentValidation.requireValid*`, `ProblemFactory`
(`422 SF-API-0422`), `PageView.issues`, `RecordDetailView.issues`. Epic decision 7; user decisions 7–9, 24.

## Goals

- A `SaveRuleGate` used by every save path: run the engine in `SAVE` against the incoming value (with the stored
  version for comparison):
  1. read-only enforcement: for paths whose `readOnlyWhen` holds (evaluated on the stored version), restore the stored
     value; add an `info` finding `read-only` per path,
  2. apply `save` fills (`mode empty` / `always`); a `mode always` path whose incoming value differed from the computed
     one also gets an `info` finding `read-only`,
  3. rules: any save-scope `ERROR` → reject with `422 SF-API-0422` and all findings (STRUCTURAL rejection unchanged,
     runs first).
- Applies to autosave (it is the same PUT) — no bypass flag.
- The stored content is the filled/enforced content; the response returns it so the client can reconcile.
- `PageView.issues` / `RecordDetailView.issues` / global set views return the `EDIT`-scope outcome of the stored draft
  (so hints/infos show after reload).
- Sections: adding/moving a section runs the page's `on page` save rules and the section's own save rules.

## Acceptance criteria

- [ ] Integration tests per asset kind: save-scope error rejects PUT, autosave PUT and PATCH; warning/info saved and
      returned; `save` fill writes (`empty` vs `always`); read-only restore with `info`; STRUCTURAL precedence.
- [ ] Templates without rules: all existing save tests green unchanged.
- [ ] OpenAPI regenerated (`ContentIssue` fields).
- [ ] `./gradlew build` green.

## Out of scope

- Release (M33.6) and generation (M33.7); UI handling of rejected autosaves (M33.8).

## Notes / hazards

- Order matters: restore `readOnlyWhen` paths first, then apply fills (so a `mode always` fill is never undone), then
  evaluate rules — document the order in the spec (M33.9) and test it.
- Records/global sets inside imports are not saves through these services' public paths — imports do not run save
  rules (they carry already-saved content).
