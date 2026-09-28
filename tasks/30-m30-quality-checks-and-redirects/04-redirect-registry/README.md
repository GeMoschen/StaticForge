# Feature: Redirect registry — persistent redirects, detection on build, manual management

**Spec:** Extends §18.2 (POST redirects), §18.4 (manifests as path history), §20.2 (redirects endpoints), new §18.8
"Redirects".

## Goal

Old URLs keep working: every build notices outputs whose path changed since the build the target serves and records
old → page in a per-project registry; people can add, edit and delete redirects by hand, including "redirect this
page's URL" when unpublishing or deleting it.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-redirect-registry-model-and-api.md](001-redirect-registry-model-and-api.md) | — |
| 2 | [002-redirect-detection-on-build.md](002-redirect-detection-on-build.md) | 1, `M30.1.3` |

## Feature exit criteria

- [x] Manual redirects CRUD with validation, `If-Match`, audit; `for-asset` creates entries from the current manifest.
- [x] A build after a move/rename/UID change/folder rename/template `outputPath` change adds AUTO entries (FULL and
      incremental), persisted only when the build published.
- [x] Shadowed, dangling and loop handling as in epic decision 16; the run's redirect set is available to POST.
- [x] `./gradlew build` green.

## Dependencies

`M27` (released paths; unpublish/delete), `M28` (`RELEASE` permission), `M22` (`TargetWriter.currentRunId/readManifest`),
`M26` (archived guard, audit).
