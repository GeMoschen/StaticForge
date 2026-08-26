# M10 — Selective export/import with conflict detection

**Spec:** Extends §26.5 (`Project export/import (ZIP: assets JSON + blobs + manifest) as a
portability and migration path`), §6.1 (`payload.origin` provenance), §7.2 (bulk
`IMPORT` revisions), §15 (channels) and §18 (generation targets). Not part of the
original §27 roadmap — inserted after M9 as a post-hardening extension, the same way
M8 itself was.

## Goal

The existing `ProjectExportImportService` (`server/sf-domain/.../exportimport`) only
knows how to export/import an **entire project**, and (pre-`M9`) always minted fresh
UUIDs on import regardless of target. There is no UI at all; the only way to trigger it
today is a raw `GET/POST /api/v1/projects/{projectKey}/export|import` call.

M10 turns this into a real, user-facing feature: let a project admin **pick specific
elements** (assets, folders, and/or project-level settings — channels, generation
targets) to export into a ZIP, and, on the way back in, **see what will happen before
committing** — a real duplicate-UUID collision in the target project, references to
templates that didn't make the cut, colliding channel keys — with a clear way to
cancel before anything is written.

This epic depends on `M9` (project-scoped UUIDs): once an asset's UUID only has to be
unique *within its own project*, exporting an element and importing it into a
**different** project can preserve its original identity (same UUID) instead of always
minting a new one — which is what makes "the same element, unchanged identity, now
also in project B" actually possible, and what makes "duplicate UUID" a real,
detectable conflict (re-importing into the **same** project a UUID already holds)
rather than a heuristic guess.

## Exit criteria (epic is done when)

- [ ] A project admin can export a **chosen subset** of assets/folders (not just
      "everything") plus, optionally, project-level settings (output channels,
      generation targets) into a single ZIP, from a UI — no raw HTTP calls needed.
- [ ] The archive format gains a `settings.json` entry (redacted of secrets per §26.3)
      alongside the existing `manifest.json`/`assets.json`/`blobs/`, and remains
      readable by the current whole-project import path (protocol version bump, not a
      breaking rewrite).
- [ ] Importing into a **different** project preserves each element's original UUID
      (per `M9`) rather than minting a new one, so the same logical element can live in
      multiple projects on the same server with one shared identity.
- [ ] Uploading an archive for import runs a **read-only analysis pass first** and
      shows a conflict report — at minimum: a UUID that already exists in the *target*
      project (a real unique-constraint collision, not a heuristic), asset references
      to templates not present in the archive or the target project, and colliding
      channel/generation-target keys — before any data is written.
- [ ] The user can **cancel** at the conflict-report step with zero side effects, or
      proceed knowing what will happen to each flagged item.
- [ ] The commit-import endpoint independently re-validates blocking conflicts server
      side (never trusts the client skipped straight past a blocking report).
- [ ] Project settings has a working "Import / Export" panel: element picker for
      export, upload + conflict review + confirm/cancel for import, with loading,
      empty, and error states — matching the visual polish of the existing settings
      tabs (`project-settings-url-registry`, `channels`, `generation`).

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [selective-export](01-selective-export/README.md) | backend | `M9` (project-scoped UUIDs), M1 (asset/folder/revision), M4/M5 (`GenerationTarget`, `OutputChannel`) |
| 2 | [import-conflicts](02-import-conflicts/README.md) | backend | `M9`, 1 |
| 3 | [export-import-ui](03-export-import-ui/README.md) | frontend | 1, 2 |

## Dependencies

Builds directly on `server/sf-domain/.../exportimport` (`ProjectExportImportService`,
`ExportedAsset`, `ExportManifest`, `ExportArchive`, `ImportResult`) and its two
controllers (`ProjectExportController`, `ProjectImportController`) from the original
§26.5 work, **after** `M9` has moved asset-UUID uniqueness to a per-project scope and
changed the importer's default from "always mint a fresh UUID" to "preserve the
source UUID unless it already exists in the target project." Also reuses
`AssetService`/`AssetVersionRepository`/`PathService` (M1),
`ChannelService`/`OutputChannelRepository` (M5), `GenerationTargetRepository` (M4), and
the project-settings shell/tab pattern established by `M8.2.5`
(`project-settings-url-registry`).

## Notes

- `cms-specification.md` §26.5 describes only the whole-project archive shape; as with
  M8, updating the spec text is a follow-up doc change once this ships, not tracked
  here.
- Existing whole-project export/import behavior must keep working for anyone still
  using the raw endpoints — selection and conflict-checking are additive, not
  replacements. Its UUID semantics change *as of `M9`*, not as part of this epic — by
  the time `M10` starts, "preserve UUID across projects, conflict on same-project
  collision" is already the baseline behavior to build the picker and conflict UI on
  top of.
