# M8 — Navigation store & URL registry rewrite

**Spec:** Supersedes §17 (structure & navigation) of `cms-specification.md`; touches §15
(channels), §16 (OCTL / `BlockResolver`), §18 (generation pipeline), §23 (frontend). Not
part of the original §27 roadmap — inserted after M7 as a post-hardening rewrite.

## Goal

Remove the `structure` asset type entirely and replace it with a dedicated **navigation
store**: folders + a new `PageReference` asset, modeled like the existing Page/Media
stores, that owns site routing/menu structure independently of content folders. Pair it
with a backend **URLRegistry** that assigns each `PageReference` a URL per channel
*once* and caches it — split into `PREVIEW` and `GENERATED` areas — with a project
settings panel to inspect, override, and reset it.

## Exit criteria (epic is done when)

- [x] `AssetType.STRUCTURE`, everything under `structure/` and `generate/nav/`,
      `StructureController` + its DTOs, and `ui/.../features/structures/` are deleted;
      no live code references "structure" as a nav concept (revision history is exempt).
- [x] A navigation store exists per project: root folder auto-created on project create
      (same as the Page/Media store roots), arbitrarily nested navigation folders, each
      with an optional `startNode` (nullable reference to a child `PageReference` or
      child folder).
- [x] `PageReference` assets target either a `Page` or a page-store `Folder`; a
      folder-targeted reference resolves at render time to that folder's first
      navigable page (via `startNode` chain when set, else a deterministic first-child
      order) — resolution never dead-ends.
- [x] Templates render navigation via a new `navigation` OCTL instruction (its own
      grammar, not a repurposed `$CMS_NAV(structure:...)$`) that walks the nav-store
      tree from a given folder.
- [x] `URLRegistry` persists the first-assigned URL per
      `(project, channel, PageReference, area)` tuple and never silently recomputes an
      existing entry — a URL changes only via explicit reset.
- [x] Project settings has a "Navigation URLs" panel listing registry entries per
      channel/area with per-entry manual override and project- or channel-scoped reset.
- [ ] Golden/integration tests prove: nav rendering resolves through the registry,
      `PREVIEW` and `GENERATED` areas never leak into each other, and a reset followed
      by a rebuild reassigns URLs deterministically.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [navigation-store](01-navigation-store/README.md) | backend+frontend | M1 (asset/folder/revision), M2 (OCTL/`BlockResolver`), M5 (channels) |
| 2 | [url-registry](02-url-registry/README.md) | backend+frontend | 1, M4 (generation/`OutputPathResolver`), M6 (preview render path) |
| 3 | [verification](03-verification/README.md) | qa | 1, 2 |

## Dependencies

Supersedes `M5:structure-navigation` — its 4 tasks are **deleted** by `M8.1.1`, not
amended in place. Reuses `Asset`/`AssetVersion`/`RevisionContext` from M1, the
`Folder`/`PathService`/`FolderScope` machinery from the Page/Media stores, the
`BlockResolver`/`UrlResolver` extension points from M2, `ChannelService` from M5, and
`OutputPathResolver` / `GenerationRenderer` / preview's `PageRenderService` from M4/M6.

## Notes

`cms-specification.md` §17 still documents the old `structure` asset. Updating it to
describe the navigation store + URLRegistry is a follow-up doc change once this epic
ships — not tracked here, since `tasks/` intentionally holds no spec edits.
