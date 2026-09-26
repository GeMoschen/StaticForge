---
id: M27.7.1
status: done
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

- [x] Every item above written against the implemented behaviour (checked in the running app / tests, not the plan);
      deviations listed in the notes.
- [x] Appendix B complete for the new codes.
- [x] `./gradlew build` green (no code changes expected; if a doc check finds a defect, fix it in its task with a test).

## Out of scope

- `tasks/README.md` epic map (done by the planner).

## Notes / hazards

- Record every place where the implementation deviated from the epic decisions and why (like `M26.5.1`).

## Implementation notes

**Written.** `cms-specification.md`: §2.2, glossary, new §5.5 (release state), §7.2/§7.6, §8.1 archived allowlist,
§10.4/§10.5, new §11.6 (localized media), §16.4, §17.2, §18.1–§18.3, new §18.7 (scheduler), §19.1/§19.3, §20.2
(media, releases and changes, schedules, release blocks), §21.1, §21.6, §22.1, §23.2, §24.5 (screens 14–16), §25.6
(journey 14), §26.2–§26.5, §27, Appendix B (`SF-DOM-0150`–`0155`, `0160`–`0168`, `SF-MEDIA-0505`–`0509`,
`SF-GEN-0221`, `SF-API-0409` scope), Appendix C (resolution of "scheduled publishing"). New sections are subsections
(§5.5, §11.6, §18.7), so no existing number moved. `docs/api.md` §3 (import `releaseMode`), §4 (release blocks), §7.2,
§10.1, §11.1, §12, §13, error catalogue; `docs/user-guide.md` (*Publishing*, localized media, keyboard, roles);
`docs/template-developer-guide.md` §2.6, §2.12, new §2.13, §3.3; `docs/administration.md` (archived projects,
schedules and people who leave, audit); `docs/architecture.md` §11 and new §13; `infra/README.md` (`sf.scheduler.*`,
multi-node note); `docs/release-readiness.md` §4 (M27 breaking changes). Every statement was checked against the code
(controllers, DTOs, services, changelogs, `application.yml`), not the plan.

**Deviations from the epic decisions** (with the reason; details in each task's implementation notes):

- *Decision 3 (model)* — `asset_release` has an extra `released_uid`: a uid change writes no version (M22.4.1), so the
  released version alone can't say which uid a language renders. A rename stays a draft until released.
- *Decision 2 (migration)* — a start-up runner (`ReleaseStateInitializer`, flag `project.release_state_initialized`)
  instead of a Liquibase change: it needs revision allocation, locale config and `ReleasableTypes`. One `RELEASE`
  revision per project without author and with a single `PROJECT/INITIAL_RELEASE` summary entry (listing thousands of
  assets would flood the revision spine), not one entry per asset as decision 12 implies.
- *Decision 1 (released types)* — the fixed store roots are not releasable (protected, never edited, always present).
- *Decision 4 (locale keys)* — a project's **first** languages turn each `""` pointer into one per language, and
  removing the **last** ones keeps the default language's pointer as `""`; otherwise enabling or disabling languages
  would unpublish the whole site. Adding a further language still opens no pointers, as decided.
- *Decision 9 (dependencies)* — two reasons beyond "referenced" and "parent folder": `SET_MEMBER` (a selected set's
  unreleased records) and `DESCENDANT` (a changed folder's changed descendants), the latter **offered unticked**
  (`includedByDefault: false`) rather than ticked like the others.
- *Decision 10 (completeness)* — the validators check the payload as stored, not per language (same as generation's
  hold-back).
- *Decision 6 (`scheduled` indicator)* — a list of refs (`actionId, type, locale, runAt, nextRunAt, ownerUserId`)
  instead of a flag; `ownerUserId` was added in M27.6.5 so the release bar can name the owner without a request per
  schedule.
- *Decision 16 (preview)* — the share endpoint stays `GET …/share` (the task text said `POST`); section preview is
  draft only; a share token carries `view` only for `published` (pre-M27 tokens read as draft).
- *Decision 17 (search)* — `releaseStatus` is a filter over the distinct statuses of an asset's languages; the search
  schema version moved to 2, so every index is rebuilt once.
- *Decisions 18/19 (localized media)* — `fileLocale` pins the top-level file to its language (survives a change of the
  default language); one more code, `SF-MEDIA-0509` (removing the default language's file), beyond the planned
  `0505`–`0508`; a language that falls back writes its own copy when the owner language doesn't publish its file,
  so no link points at a file nobody wrote. No schema change was needed (the planned changelog `021` doesn't exist;
  `022-scheduler.xml` keeps its planned number).
- *Decision 20 (scheduler engine)* — an execution that meets a busy project stays open (`WAITING`) with its progress
  checkpointed; "paused" is a recurring action `FAILED` with no `next_run_at`; `max_lateness` is stored as seconds.
  Permissions come only from `handler.requirements(spec)`: every schedule endpoint is `VIEWER`-gated and the handler's
  requirement is checked in `ScheduleService`, so the planned `ReleasePermissions.canSchedule` was removed (unused).
  Re-pin is an SPI method (`repin`) instead of a separate release schedule service.
- *Decision 25 (authority)* — a `LOCKED` account still counts as permitted (a lock only blocks sign-in); the manual
  release permission check was aligned with that. A `@Version` conflict at commit (an edit racing a claim) is
  `409 SF-API-0409`, not a 500.
- *Decision 21 (generation actions)* — the scheduled run's comment is passed to generation but not persisted (runs
  have no comment column; out of scope).
- *Decision 28 (export)* — beyond open pointers the archive records `UNPUBLISHED` keys (open pointers can't tell
  `UNPUBLISHED` from `NEW`), imported as pointers opened and closed in the import revision. Released versions that
  differ from the draft are imported as extra versions opened and closed in the import revision. A `""` pointer
  releases only the target languages the archive has; an archive without languages counts as the target's default
  language (both decided with the user, 2026-09-25). `KEEP` over an existing asset replaces its release state (import
  wins); `DRAFT` leaves the target's release state alone and skips deletion-pending assets; an import is a restore, so
  there is no completeness gate.
- *Feature 6 (UI)* — the Changes and Schedules routes are eager, like every project route (single-bundle decision of
  2026-09-16), not lazy. The release bar reads its asset itself (`GET /assets/{uuid}`) after each save and release
  action instead of taking the status from its editor. The drawer's per-language files come from a new
  `GET /media/{uuid}` (the list rows don't carry them) instead of re-implementing the server's resolution in the UI.
  The Changes diff renders the server-computed `FieldChange`s with `sf-diff` directly, so `revision-diff` needed no
  "two payloads" input. Generation schedules use a new `sf-generation-options` component rather than the generation
  dialog's form (which is bound to its plan preview). The Schedules page creates generation schedules only; releases
  and unpublishing are scheduled from an editor or the Changes view, which know the items.
- *Not planned, added:* `M27.1.4` (release performance for large selections: 10,101 items from 329 s to 1.8 s), and a
  pre-existing history bug fixed in M27.6: `BodyService` edited the stored payload in place, so content merge-patch
  and section add/reorder/delete/move rewrote the previous version (a released version silently took unreleased
  edits) — fixed with `PagePayloadHistoryIntegrationTest`.
