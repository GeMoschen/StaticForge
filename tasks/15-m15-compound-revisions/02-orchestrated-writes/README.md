# Feature: Orchestrated writes

**Spec:** §7.1 (the case this feature actually fixes: one user-facing action, several
assets), §7.6 (project-wide restore, already documented as "bulk restore in one new
revision" — this feature completes that promise), §6.4 (UID-rename cascade).

## Goal

Migrate every existing orchestration that logically represents **one** user-facing
action but currently fragments into several revisions onto the `beginBatch`/
`allocateOrJoin` mechanism from `revision-batch-core`. Three concrete, already-identified
call sites:

1. **Project creation** (`ProjectServiceImpl.create`) — today allocates 8 separate
   revisions (1 project `CREATE` + 7 bootstrap-folder `CREATE`s: the shared hidden
   root, "All Templates", "Page Templates", "Section Templates", "All Navigation",
   "All Pages", "All Media" — see the epic README for the full call trace). After this
   task, it allocates exactly 1.
2. **Template editor UID-rename page-migration cascade** (`TemplateServiceImpl`,
   the method around line 320-344 that walks every page whose body references a
   renamed editor field and rewrites its payload) — already hand-rolls
   allocate-once-then-loop-`appendSummary` inline; migrate it onto the shared
   mechanism instead of leaving a second, bespoke implementation of the same idea
   living beside the new one.
3. **Template-folder migration** (`TemplateServiceImpl`'s `ensureFoldersAndMigrate`,
   ~line 466+, from `M13`) — currently allocates one `MOVE` revision **per migrated
   template**, even though "migrate every pre-`M13` template into its fixed folder" is
   one logical maintenance operation. Fold it into one compound `MOVE` revision.
4. **Project-wide restore** (`ProjectRestoreService.restoreTo`) — already allocates one
   `RESTORE` revision for all affected assets, but has a real bug: it never calls
   `appendSummary`, so `summary.assets` is always empty for a project rollback despite
   the revision genuinely being compound. Fix this as part of routing it onto the
   shared mechanism (it needs no *new* revision-opening logic, just the missing
   per-asset `appendSummary` calls that `allocateOrJoin`'s sibling calls already make
   standard practice elsewhere).

`ProjectExportImportServiceImpl.importProject`'s existing one-`allocate(IMPORT)`-per-archive
pattern (`M10`) is **not** touched by this feature — it already calls `appendSummary`
correctly per imported asset and is a working precedent, not a bug to fix.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-project-creation-one-revision.md](001-project-creation-one-revision.md) | `M15.1.2` |
| 2 | [002-rename-cascade-and-restore-summary.md](002-rename-cascade-and-restore-summary.md) | `M15.1.1` |

## Feature exit criteria

- [x] `POST /projects` produces exactly 1 revision; its `summary.assets` lists all 7
      bootstrap folders plus the project's own creation entry.
- [x] The UID-rename cascade and `M13`'s template-folder migration each produce one
      compound revision (whichever `ChangeType` fits — `UPDATE`/`MOVE` respectively) for
      all pages/templates they touch, using `beginBatch`/`allocateOrJoin` rather than
      their own inline allocate-then-loop pattern.
- [x] `ProjectRestoreService.restoreTo`'s resulting revision has a non-empty
      `summary.assets` listing every asset it restored or deleted, matching the pattern
      every other compound write in this feature now follows.
- [x] Every already-passing integration test covering these four call sites
      (`ProjectExportImportIntegrationTest`'s project-creation fixture setup,
      `UidChangeWarningIntegrationTest`, `TemplateFolderIntegrationTest`, and any
      project-restore test) still passes, with assertions updated only where they
      specifically counted revisions (which should now count fewer, and correctly).

## Dependencies

`M15.1` (`RevisionContext.openRevision`, `beginBatch`, `allocateOrJoin`).
