---
id: M15.3.2
status: done
depends: [M15.2]
epic: m15-compound-revisions
feature: revision-invariants-compound
area: qa
---

# M15.3.2 — Audit and update existing revision integration tests for the new call sites

## Context

`M15.2.1`/`M15.2.2` change the exact revision ids produced by project creation, the
UID-rename cascade, template-folder migration, and project restore. Several existing
integration tests assert on revision ids, revision counts, or `summary` contents at
these specific call sites and will need updating — not because their *behavior*
assertions are wrong, but because the numbering/count they were written against
changes. This task is the audit-and-fix pass, mirroring the precedent
`M9.3.2`/`M11.2.1`/`M14.2.2` each set for "prove the claim with an updated/new test,
don't just assume the refactor didn't break anything."

## Goals

- Grep every test file under `server/sf-app/src/test/java/com/acme/staticforge/` for
  hard-coded revision-id/count assertions following a project-creation, UID-rename,
  template-folder-migration, or project-restore call: `AssetRevisionIntegrationTests`,
  `ConcurrentWritersTest`, `RevisionFilterIntegrationTest`, `UidChangeWarningIntegrationTest`,
  `TemplateFolderIntegrationTest`, `ProjectExportImportIntegrationTest` (its fixture
  setup creates projects, so any assertion counting from a known starting revision
  number is a candidate), `Fixtures.java` itself if it hard-codes an expected starting
  revision for a freshly built project.
- For each hit, either (a) update the expected number/count to match the new,
  post-`M15.2` behavior, or (b) replace a hard-coded revision-id literal with a
  relative computation (e.g. "the revision right after project creation" resolved via
  `revisionService.findRecent(...)` rather than a magic number `9`) where that's more
  robust and matches the spirit of the existing test — prefer (b) wherever a test's
  actual intent doesn't depend on the literal number.
- Add one explicit regression test per fixed call site if none of the existing tests
  already exercises it directly (e.g., if no current test asserts "project creation
  produces revision count X," add one narrowly-scoped test that does, even though
  `M15.2.1`'s own task already added a project-creation-specific test — this task's
  job is closing any *remaining* gaps across the rest of the suite, not duplicating
  that one).

## Acceptance criteria

- [x] Every test file listed above is confirmed either unaffected (no hard-coded
      revision-id/count assumption touching the four changed call sites) or updated.
- [x] No remaining test in the suite asserts a stale revision count (e.g. "project
      creation yields 8 revisions," "template migration produces N MOVE revisions for
      N templates") — every such assertion reflects the compound-revision behavior.
- [x] Full `./gradlew build` (all modules, all tests) is green with zero regressions
      outside the deliberately-updated assertions.

## Out of scope

- The property-based invariant extension — `M15.3.1`.
- Frontend test updates — `M15.4`/`M15.5`.

## Notes / hazards

- This is explicitly an audit task, not a "fix failures as CI reports them" task — do
  the grep-driven sweep first so the full set of affected assertions is known before
  editing any one of them; a partial fix-as-you-go pass risks leaving a stale
  assertion that happens to still pass for the wrong reason (e.g. a loosely-typed
  `>= 1` check that silently tolerates either the old or new count).

## Audit result (M15.3.2)

Grep-driven sweep of every file listed under Goals, plus a repo-wide search for
hard-coded `RevisionId()/validFromRevision()` literal assertions and for stale
"N revisions for N templates/folders" language, found all four call sites already
correctly reflect the compound-revision behavior — `M15.2`'s own call-site tasks had
already updated (not just left passing-by-accident) every test that exercises them:

- Project creation: `ProjectApiIntegrationTests.createAllocatesRevisionOneAndGrantsCreatorProjectAdmin`
  asserts exactly 1 revision (`revisions.hasSize(1)`, `revisionId == 1L`) with
  `summary.assets` listing all 8 entries (1 `PROJECT` + 7 `FOLDER`).
- UID-rename/CDL-rename cascade: `TemplateServiceTest.renameMigrationMovesContentProjectWideInOneRevision`
  asserts `after == before + 2` (1 revision for the template's own field update + 1
  batch revision for the whole N-page cascade) and that every migrated page shares one
  `validFromRevision`.
- Template-folder migration: `TemplateFolderIntegrationTest.migrationOfRealisticPreExistingDataReparentsCorrectlyAndPreservesHistory`
  asserts all 4 legacy templates land on the same single `MOVE` revision
  (`distinctMigrationRevisions == 1`), not one `MOVE` per template.
- Project restore: `ProjectRestoreServiceTest.restoreSummaryListsEveryRestoredOrDeletedAsset`
  asserts `summary.assets` is populated (the `M15.2.2` bug fix) with one entry per
  touched asset.

`AssetRevisionIntegrationTests`, `ConcurrentWritersTest`, `RevisionFilterIntegrationTest`,
`UidChangeWarningIntegrationTest`, `ProjectExportImportIntegrationTest` and `Fixtures.java`
were confirmed unaffected — none hard-code a revision id/count derived from a
project-creation-time revision total; all use relative computation (`before + 1`, max of
`findByProjectIdOrderByRevisionIdDesc`, etc.). No stale assertion or loosely-typed
`>= 1` check masking the old 8-revision behavior was found anywhere in the suite.
