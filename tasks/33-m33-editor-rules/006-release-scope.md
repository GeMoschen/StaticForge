---
id: M33.6
status: done
depends: [M33.4]
epic: m33-editor-rules
feature: release-scope
area: backend
---

# M33.6 — Release scope

## Context

`ReleaseCompleteness` (:66-83), `ReleaseServiceImpl` (:115-131 plan, :143-163 release), `ReleaseProblems`,
`ReleasePlanView`, `ReleaseActionHandler` (:161-206), revision service (M1), `ReleasableTypes`. Epic decision 9;
user decisions 7, 10, 18, 20, 23.

## Goals

- Replace `ReleaseCompleteness` with `ReleaseRuleCheck`: per asset and released locale, run `release` fills, then
  `release` rules with released-view context (`ref` → released versions; assets released in the same request count as
  released).
- Release fills: if any value changes, write a new draft version with the filled values and release that version,
  both inside the release's revision (one revision, draft == released afterwards). Fills run for pages (incl. section
  instances), records and global sets.
- Blocking: `ERROR` → `422 SF-DOM-0150` (unchanged shape, new issue fields). `WARNING` → `422 SF-DOM-0156` with
  `assets[{uuid, locale, issues}]` unless the request has `acceptWarnings: true`.
- Plan: `ReleasePlanView` lists `incomplete` (errors), `warnings` and `infos` per asset/locale; the plan shows the
  fills that the release would apply (`fills[{uuid, locale, path, value}]`).
- Scheduled releases: always `acceptWarnings`; warnings recorded in the job/run result; LATEST-pin skip for errors
  unchanged; a fill in a scheduled release creates the version under the scheduler's system actor.

## Acceptance criteria

- [ ] Integration tests: error blocks; warning needs `acceptWarnings`; info never blocks; release fill creates exactly
      one revision with a new version + pointer move; `ref` reads released state; multi-locale release evaluates each
      released locale; scheduled release with warnings succeeds and records them; with errors skips as today.
- [ ] Templates without rules: existing release tests green unchanged (built-in required still blocks via
      `SF-DOM-0150`).
- [ ] OpenAPI + `schema.d.ts` regenerated.
- [ ] `./gradlew build` green.

## Out of scope

- Publish policy changes (M28 unchanged: no override of errors, user decision 10).

## Notes / hazards

- A release fill changes the draft; concurrent edits (autosave) must hit the normal optimistic-lock conflict, not
  silently lose data — the release takes the version lock like a save.
- Unpublish / withdraw do not run release rules.
