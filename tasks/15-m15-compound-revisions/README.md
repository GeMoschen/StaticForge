# M15 — Compound revisions

**Spec:** Refactors §7 (revision safety — in particular §7.1's "one API mutation → one
revision" concept and §7.2's `summary` field, which is already shaped as a list),
§5.1 (entity relationships), §20.2 (REST API), §24 (revision UX). Not part of the
original §27 roadmap — inserted the same way `M8`–`M14` were, as an architecture-quality
refactor of the revision system itself rather than new user-facing capability.

## Goal

Today a revision is, in practice, a single-change record: every mutating service method
calls `revisionService.allocate(...)` for itself and, at most, appends one asset's worth
of change to its `summary` before returning (`AssetServiceImpl.createInternal`,
`update`, `softDelete`, `restore`, `move`, `changeUid`, `TemplateServiceImpl`,
`FolderServiceImpl`, `ChannelServiceImpl.create/update/setEnabled` — every one of these
calls `revisionService.allocate` unconditionally, ignoring whether the caller is already
inside a larger logical operation). One user-facing action that touches several assets
therefore fragments into several revisions with no record that they belonged together.
The clearest case is project creation: `ProjectServiceImpl.create` itself allocates one
`CREATE` revision, then calls `assetService.ensureTemplateFolders` (2 folders),
`ensureNavigationRootFolder`, `ensurePagesRootFolder`, and `ensureMediaRootFolder` (each
lazily creating the shared hidden root + its own folder via
`AssetServiceImpl.createInternal`, each with its own unconditional `allocate` call) — a
brand-new, otherwise-empty project ends up with **8 separate revisions** (1 project
`CREATE` + 7 folder `CREATE`s: the hidden root, "All Templates", "Page Templates",
"Section Templates", "All Navigation", "All Pages", "All Media") before a user has done
anything.

This milestone turns a revision from an implicit one-change-per-`allocate()`-call record
into an explicit, first-class **container** that can hold N asset changes across N
service calls when those calls are part of one logical operation, while every existing
capability of the revision architecture — spine, history/filtering, structural diff,
asset restore, project-wide rollback, optimistic concurrency (`If-Match`/409), the
conflict drawer, usages, time travel — keeps working unchanged for both the old case (a
revision that happens to touch exactly one asset, still the common case for a single
field save) and the new case (a revision that touches many). No data migration is
needed or attempted — there is no real production data yet, so this is a clean-slate
refactor of the write path, not an additive/compatible change.

Project setup is the proof case: after this milestone, `POST /projects` produces
**exactly one** revision (`ChangeType.CREATE`) whose `summary.assets` lists the project's
own creation alongside all 7 bootstrap folders, not 8 disconnected revisions.

Alongside the write-path refactor, this milestone also closes a real gap in the
existing (`M6`) time-travel UX: viewing a past revision must make the **whole app**
read-only, not just the page editor. Today `TimeTravelStore.isTimeTravel` is checked by
exactly one component; every other editor surface stays fully writable while the amber
"Viewing revision N" banner is shown. This is independent of the compound-revision
mechanism itself (it applies equally to a revision that touched one asset or many) but
belongs in this milestone because it's the other half of making "viewing a revision" a
trustworthy, complete concept in the UI.

## Exit criteria (epic is done when)

- [x] Creating a project produces exactly 1 revision, not 8 — verified by asserting
      `revisionService.findRecent` (or the `GET /revisions` endpoint) returns a single
      row for a freshly created project, with `summary.assets` listing the project's
      root/template/navigation/pages/media bootstrap folders.
- [x] A shared, explicit mechanism exists for opening one revision and having multiple
      nested service calls append to it instead of each allocating its own — every
      current call site that logically represents one user-facing action but touches
      more than one asset (project creation, the UID-rename page-migration cascade in
      `TemplateServiceImpl`, project-wide restore in `ProjectRestoreService`) is
      migrated onto it, not left as bespoke, one-off inline loops.
- [x] `ProjectRestoreService.restoreTo`'s existing bug — it allocates one `RESTORE`
      revision but never calls `appendSummary`, so a project rollback's `summary.assets`
      is always empty today — is fixed as part of unifying it onto the shared mechanism.
- [ ] Every existing **single**-asset mutation (one page save, one media upload, one
      folder move, one UID change, …) still produces exactly one revision touching
      exactly one asset, byte-for-byte equivalent to today's behavior — this is a
      capability *addition*, not a change to the common case.
- [x] Revision spine, history list/filtering, structural diff, asset restore,
      project-wide rollback, `If-Match`/409 optimistic concurrency, the conflict drawer,
      usages, and time travel all correctly represent and operate on a revision that
      touched N>1 assets — proven by (updated) UI tests/E2E journeys, not only by the
      API already returning `summary.assets`/`RevisionDiff.assets` as lists. — Unit-level:
      `revision-summary.util.spec.ts`, `revisions-list.component.spec.ts`,
      `revision-spine.component.spec.ts`, `revision-diff.component.spec.ts` (renders all
      8 assets of a project-creation-shaped revision with correctly-scoped restore
      actions). Browser-level: `ui/e2e/m15-journeys.spec.ts` (`M15.6.1`) exercises the
      real project-creation flow end-to-end through spine/history/diff; collects
      cleanly but — like every journey since `M5` — wasn't run against a live backend
      here (no seeded demo user; see `tasks/15-m15-compound-revisions/06-e2e-verification/001-project-setup-one-revision-journey.md`).
      `m6-journeys.spec.ts` journeys 5-8 (time travel, restore, conflict drawer, usages)
      were regression-read-through-verified against this milestone's changes
      (`006/002-collaboration-journey-regression.md`), same execution caveat.
- [x] `RevisionInvariantsTest`'s property-based invariants (§25.5: gapless revisions,
      exactly one valid version per revision per touched asset, reproducible reads,
      correct restore, no lost updates) hold under compound (multi-asset) revisions, not
      only the single-asset case they cover today.
- [x] **Viewing a revision puts the entire app in read-only mode, not just the page
      editor.** Today only `page-editor.component.ts` checks `TimeTravelStore.isTimeTravel`
      and disables itself; every other editor surface (templates, channel templates,
      media, navigation, project settings, channel CRUD) stays fully writable while the
      amber "Viewing revision N" banner is showing. After this milestone: (a) a
      client-side HTTP backstop rejects every mutating request while time travel is
      active, regardless of which component issued it, and (b) every write-triggering
      control on every surface visibly disables itself, the same way the page editor
      already does — a user can look, but not touch, anywhere in the app, until they
      explicitly return to "now."
- [ ] `./gradlew build` (incl. `RevisionInvariantsTest`, `ConcurrentWritersTest`,
      `AssetRevisionIntegrationTests`, `RevisionFilterIntegrationTest`,
      `UidChangeWarningIntegrationTest`) and `ui` `npm run build` + `npm test` are green.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [revision-batch-core](01-revision-batch-core/README.md) | backend | — |
| 2 | [orchestrated-writes](02-orchestrated-writes/README.md) | backend | 1 |
| 3 | [revision-invariants-compound](03-revision-invariants-compound/README.md) | qa/backend | 1, 2 |
| 4 | [revision-ux](04-revision-ux/README.md) | frontend | — (reads `RevisionView`/`RevisionDiff`, which already shape as lists — no backend dependency, but should land after 2 so there's a real multi-asset revision to develop against) |
| 5 | [time-travel-read-only](05-time-travel-read-only/README.md) | frontend | — (independent of 1–4: it's about enforcing read-only mode while *viewing* any revision, single- or multi-asset, not about the compound-write mechanism itself) |
| 6 | [e2e-verification](06-e2e-verification/README.md) | qa | 2, 4, 5 |

## Dependencies

`M1:revision` (`Revision`, `RevisionService`, `RevisionContext`, version intervals,
optimistic concurrency — the machinery this milestone extends, not replaces),
`M1:diff-restore` (`DiffService`, asset/project restore), `M6:revision-ux` (spine,
history, diff, conflict drawer, `TimeTravelStore` — the UI this milestone updates and,
for feature 5, closes the read-only gap in), `M13` (template-store folders — the
fixed-folder bootstrap this milestone folds into one revision).

## Notes

- The domain model was already shaped for this: `revision.summary` is documented in
  `cms-specification.md` §7.2 as "denormalized **list** of touched assets", `AssetChange`
  already accumulates into a JSON array (`RevisionServiceImpl.appendSummary`), and
  `RevisionDiff`/`DiffService` already return `List<AssetDiff>`. What's missing is a
  *write-side* mechanism for reusing one already-open revision across several service
  calls — today every `allocate()` call site allocates unconditionally, so nothing ever
  reuses an already-open one. This milestone is a write-path refactor, not a schema
  change: no new Liquibase changelog is expected.
- `TemplateServiceImpl`'s UID-rename cascade (the loop that migrates every affected
  page's `bodies` payload when a section/page template editor is renamed) already hand-
  rolls exactly this pattern — one `allocate()`, then one `appendSummary()` per affected
  page inside a loop. Treat it as the existing precedent to generalize and dedupe onto,
  not as a second bespoke implementation living alongside the new shared mechanism.
- No spec correction is needed to *add* compound revisions (§7.2's `summary` already
  documents a list), but §7.1's line "one API mutation → one revision" becomes
  misleading once one API mutation (e.g. `POST /projects`) can span a batch — as with
  `M8`/`M10`/`M11`/`M13`/`M14`, a documentation follow-up is a later doc task, not
  tracked here.
- `ChangeType.BULK` already exists in the enum but appears unused by any current call
  site — decide during `M15.1` whether project creation's compound revision should use
  `CREATE` (it already fully determines the revision's nature — everything in it is a
  creation) or `BULK` (marking it as multi-asset at a glance); either is defensible, but
  pick one and use it consistently for every compound revision this milestone produces,
  not a different `ChangeType` per call site.
- This milestone does **not** add a new "staged changes" authoring UX (e.g. queuing
  edits across multiple open editors before an explicit user-triggered commit). It makes
  the revision *data model and every read surface* honestly represent multi-asset
  changes, and applies that to the orchestrations that already exist server-side
  (project creation, rename cascades, rollback). A user-facing multi-asset authoring
  flow, if wanted, is a follow-up product decision for a later milestone, not assumed
  here.
