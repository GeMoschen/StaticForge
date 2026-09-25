---
id: M27.7.1
status: todo
depends: [M27.1.3, M27.2.2, M27.2.3, M27.3.2, M27.4.4, M27.5.2, M27.6.2, M27.6.3, M27.6.4, M27.6.5]
epic: m27-release-and-scheduling
feature: docs-e2e
area: qa
---

# M27.7.1 — Docs and spec: release state, localized media, scheduler

## Context

`cms-specification.md`, `docs/api.md`, `docs/user-guide.md`, `docs/template-developer-guide.md`,
`docs/administration.md`, `docs/architecture.md`, `infra/README.md`, `docs/release-readiness.md` (§4 release notes —
breaking changes). Epic "Notes → Spec follow-up".

## Goals

- **Spec**: §2.2 (non-goal narrowed: release state yes, approval workflow no), §5 (`asset_release`, released vs live
  types, per-locale pointers), §7 (`ChangeType` `RELEASE`/`UNPUBLISH`/`DISCARD`, release state in time travel, restore
  leaves release state), §10.4/§10.5 (lifecycle table: release, unpublish, discard, structural drafts, completeness
  gate), §11 (localized media payload, files per locale, fallback, output paths), §16.4 (`SF-GEN-0221`), §17
  (navigation of released versions), §18.1 (scheduled trigger now real: link to the scheduler section), §18.2 (SNAPSHOT
  released view, PLAN seeds by release, new root kinds), §19 (draft/published view, share-link view), new section
  "Scheduler" (engine, action types, pin/missed policies, time zones, authority, archived, busy), §20.2 (release,
  changes, schedules, media files endpoints), §23/§24 (Changes, Schedules, release bar, badges), §26.2 (scheduler
  claim is multi-node safe; generation still single-node), §26.4 (scheduler metrics), §26.5 (protocol 8, import
  option), Appendix B (`SF-DOM-0150`–`0155`, `0160`–`0168`, `SF-MEDIA-0505`–`0508`, `SF-GEN-0221`), Appendix C (note
  resolved post-v1 candidate "scheduled publishing").
- **docs/api.md**: the new endpoints with examples (release plan → release, changes paging, schedule create for each
  type incl. cron + zone, take over).
- **docs/user-guide.md**: "Publishing: draft, release, unpublish" (what goes online when), per-language release,
  Changes view, preview toggle, scheduling, localized media.
- **docs/template-developer-guide.md**: unreleased references render empty (`SF-GEN-0221`), localized media URLs per
  locale, released templates are live (a template change affects released pages at the next build).
- **infra/README.md / administration.md**: `sf.scheduler.*` properties, multi-node note.
- **release-readiness.md §4**: breaking changes — every save is a draft after upgrade; builds render released versions;
  migration marks everything released; export protocol 8.

## Acceptance criteria

- [ ] Every item above written against the implemented behaviour (checked in the running app / tests, not the plan);
      deviations listed in the notes.
- [ ] Appendix B complete for the new codes.
- [ ] `./gradlew build` green (no code changes expected; if a doc check finds a defect, fix it in its task with a test).

## Out of scope

- `tasks/README.md` epic map (done by the planner).

## Notes / hazards

- Record every place where the implementation deviated from the epic decisions and why (like `M26.5.1`).
