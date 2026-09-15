---
id: M21.2.1
status: todo
depends: [M21.1.1, M16.4.1, M16.3.3]
epic: m21-pagination
feature: planning
area: backend
---

# M21.2.1 — Planner fan-out: `PaginationSource`, `{pageNumber}` paths, per-entry dependencies

## Context

- `PlanEntry` (`server/sf-generate/src/main/java/com/acme/staticforge/generate/plan/PlanEntry.java`)
  is `record PlanEntry(UUID pageUuid, String channel, String outputPath)`.
- `BuildPlan(incremental, revision, entries, changedAssets)`.
- `BuildPlanner.plan(snapshot, mode, lastSuccessfulRevision, channels, scopeFolderPath,
  scopeAssetUuids, paths)` adds one entry per page × channel via `paths.resolvePagePath(page,
  channel)` and sorts by path. `affectedPages` walks reverse `asset_reference` edges
  (`references.findByToAssetId`) plus template/section payload indexes.
- `RenderPipeline.execute` runs `validate`, then `paths.findCollisions(plan.entries())`
  (`OutputPathResolver`: throws `SF-GEN-0110` when two *different* page UUIDs share a path; the same
  page twice is allowed), then `renderParallel`. That stores
  `dependencies.put(entry.pageUuid(), task.file.dependencies())` in a `HashMap`, so a page's
  dependencies are overwritten by whichever entry finishes last. This already loses one channel's
  dependencies for multi-channel pages.
- `OutputPathExpander` (`server/sf-domain/.../channel/OutputPathExpander.java`) resolves
  `payload.output.pathOverride.<ch>` → template `outputPath.<ch>` → `{folder}{uid}.{ext}`. Its
  placeholders are `{displayNameSlug} {folder} {uid} {ext} {channel} {year} {month} {day}`.
  `TemplateServiceImpl.buildPayload` writes page templates' `outputPath{channel: expr}`.
- Navigation children come from `NavigationService.tree(...)`, which orders them with
  `FOLDER_ORDER` (display name, uid) in `NavigationServiceImpl.buildNode`. Target pages carry
  `nav.position`, `nav.visible` and `nav.date` in their payload (`PageServiceImpl.create`).

## Goals

- **`PaginationSource`** (new, `sf-generate` `generate.plan` or a small `generate.pagination`
  package): given a `Snapshot`, the page, and its stored `PAGINATION` value, it returns the
  ordered list of eligible item UUIDs.
  - `NAV` source: the nav folder's direct children that are `PAGE_REFERENCE`s resolving (via
    `NavigationService.resolve`) to a non-deleted `PAGE`, excluding targets with
    `nav.visible=false`. Dangling references are skipped with a warning diagnostic (new
    `SF-GEN-*` code); they do **not** fail the run. That differs from `SF-GEN-0411` for
    `$CMS_NAVIGATION`, and the difference is documented.
  - `navigation` sort uses the exact order `NavigationService.tree` returns. `position`,
    `date` and `displayName` sort by the target page's fields. All keys end with a `uid` →
    `uuid` tiebreak, and the direction applies to the primary key only.
  - `DATASET` source (behind `M19.3.1`): the dataset's records at the snapshot revision,
    ordered through `M19.3.1`'s query model with the chosen sort. Until `M19` lands this branch
    is absent and a `DATASET` value yields a validation error (already rejected on save by
    `M21.1.1`).
- **Plan fan-out** in `BuildPlanner.plan`: for a page whose template has a `pagination` editor
  and whose value is non-null, compute `totalPages = max(1, ceil(items / pageSize))` and add
  one entry per page number per channel.
  - `PlanEntry` gains a nullable `Pagination` record:
    `(int pageNumber, int totalPages, String firstPath, String prevPath, String nextPath,
    String lastPath)`. Keep `PlanEntry` a record and add a compact 3-arg constructor so the
    existing call sites and tests are unchanged.
  - Plan sort: path, then `pageNumber`.
- **Paths:**
  - Page 1 uses the page's normal resolved path.
  - Pages 2..N use `payload.paginationPath.<channel>` from the page template, written by
    `TemplateServiceImpl.buildPayload` next to `outputPath`, and validated there: it must
    contain `{pageNumber}`.
  - The pattern is expanded by `OutputPathExpander` with the new `{pageNumber}` placeholder,
    plus `{pagePath}`: page 1's path without its index-file/extension segment, so `blog/index.html` → `blog/`
    and `news.html` → `news/`.
  - Default pattern when unset: `{pagePath}page/{pageNumber}/{indexFile}` for channels with
    directory-style URLs, and `{pagePath}page-{pageNumber}.{ext}` otherwise. Which one applies
    comes from the channel path settings wired in `M16.4.1`.
  - `LiveOutputPathResolver` gets the same support, so preview and the URL registry agree
    with generation.
- **Collisions:** `findCollisions` treats a paginated entry as owned by
  `(pageUuid, pageNumber)`. The same page with two different page numbers on one path is a
  collision too (e.g. a pattern without `{pageNumber}` that slipped past validation).
- **Dependencies:** replace the `dependencies.put` overwrite with a per-page merge (a
  concurrent-safe union across all entries and channels). Keep
  `RenderPipeline.dependenciesByPage()` returning `Map<UUID, Set<UUID>>`. For a paginated page
  the dependency set also includes the source asset and **every** eligible item, not only the
  items rendered on a given page, so adding an item that shifts later pages rebuilds them all.
- **Incremental:**
  - `BuildPlanner.affectedPages` adds a paginated page when its source folder / dataset
    changes, when any current item changes, or when a page reference/record is added to or
    removed from the source. Edges come from `M21.1.1`'s `CONTENT_REF` plus render dependencies.
  - A paginated page that is affected is always re-planned with **all** its page numbers,
    because the count may have changed.
  - Verify how the target writers (`FilesystemTargetWriter`, `S3TargetWriter` manifest diff)
    treat outputs from the previous build that no longer exist, and make sure a shrunk
    pagination (N → N-1) does not leave `page/N/` published. Fix this in the writer/plan
    handover if it does.
- Tests:
  - `BuildPlannerTest`: nav source counts (0, 1, exact multiple, remainder) and sort orders
    including ties.
  - Path expansion cases.
  - Collision between `blog/page/2/` and a real page at the same path.
  - Dependency merge across two channels (regression for the pre-existing overwrite).
  - Incremental rebuild on item add/remove; page-count shrink leaves no stale output.

## Acceptance criteria

- [ ] A nav source with 23 eligible items and page size 10 plans 3 entries per enabled channel;
      page 1's path equals the unpaginated path of the same page; pages 2–3 match the pattern.
- [ ] An empty source plans exactly 1 entry (`totalPages=1`) at the page's normal path.
- [ ] Items with equal sort keys always land on the same page across repeated plans of the same
      snapshot (deterministic tiebreak test).
- [ ] A paginated output colliding with another page's output fails with `SF-GEN-0110`, and the
      message names both pages and the page number.
- [ ] `dependenciesByPage()` for a page rendered in `html` and `markdown` contains the union of
      both renders' dependencies (the overwrite bug is covered by a test that fails before the fix).
- [ ] Incremental: adding a page reference to the source folder rebuilds all page numbers of the
      paginated page; shrinking from 3 to 2 pages leaves no `page/3/` in the published output.
- [ ] Non-paginated projects produce byte-identical plans and outputs to before (existing
      generation integration tests pass unchanged).
- [ ] `./gradlew :server:sf-generate:test :server:sf-domain:test` green.

## Out of scope

- The `$CMS_PAGINATION` render scope and preview (`M21.3.1`).
- Sitemap/search index/canonical handling (`M21.2.2`).
- Page-level override of the pagination path (`payload.output.pathOverride` stays page-1-only).
- Nested/recursive navigation sources (only direct children of the chosen folder).

## Notes / hazards

- **One eligibility and ordering function.** The renderer (`M21.3.1`) must slice from the
  same `PaginationSource` result that produced the count. Pass the resolved item list via the
  plan/renderer rather than resolving twice with possibly different rules.
- `nav.visible=false` exclusion is a product choice. It mirrors what navigation rendering
  hides; confirm against `NavigationTreeJson`/`NavigationHtmlRenderer` behaviour and document it
  in `docs/editors/pagination.md`.
- Do not change `FOLDER_ORDER`/`PAGE_ORDER` or what `$CMS_NAVIGATION` renders. The `navigation`
  sort key must *reuse* the tree order, not redefine it.
- `M24.3.2` will add a locale dimension to plan entries. Avoid code that treats
  `(pageUuid, channel)` or `(pageUuid, channel, pageNumber)` as a closed key (e.g. map keys built
  from string concatenation).
- Performance (§18.6): a 5,000-page project with a few paginated indexes must stay within the
  build target. `PaginationSource` must use snapshot lookups, not per-item repository calls.
