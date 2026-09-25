---
id: M27.2.1
status: done
depends: [M27.1.1]
epic: m27-release-and-scheduling
feature: released-rendering
area: backend
---

# M27.2.1 — Released snapshot: per-locale version resolution for generation

## Context

`sf-generate/.../generate/snapshot/SnapshotService.java` (`snapshot` `:34`), `Snapshot.java` (`byUuid`, `byAssetId`,
`pages()`, `assetsOfType`), `SnapshotAsset`, and every snapshot consumer: `SnapshotNavigationLookup`,
`SnapshotAssetValueResolver` (records/sets/globals, `:83`, `:115`), `SnapshotTemplateHierarchy`, `SnapshotPagination`,
`OutputPathResolver.forSnapshot`, `plan/BuildPlanner` (`siteOutputs` `:215`, locale narrowing `:158-165`),
`render/GenerationRenderer` (`indexUids` `:873`, `isDeleted` `:892`, `urlResolver` `:431`, media `:466`),
`stage/CarryForward.sitePages()`, `GenerationDiagnosticCodes`. `M27.1.1` (`ReleaseState`, `ReleasableTypes`). Epic
decisions 1, 3–5, 9, 16, 17.

## Goals

- **`SnapshotView { RELEASED, DRAFT }`** and `SnapshotService.snapshot(projectId, revision, view)`; the old signature
  goes (callers pass the view explicitly — generation `RELEASED`; preview is `M27.2.3`).
- **Per-locale resolution.** In the released view a releasable asset has, per locale key, the version its pointer
  (valid at R) names — or none. Live types (templates, datasets, template folders) keep the version valid at R.
  `Snapshot` exposes `asset(uuid, locale)` / `pages(locale)` / `assetsOfType(type, locale)`; non-localized projects use
  `""`. The draft view resolves every locale to the version valid at R (today's behaviour).
- **Load cost.** One bulk query for pointers valid at R plus one for the referenced versions (`findAllById` in chunks);
  versions shared by several locales are loaded once. Measure on the 5,000-page fixture with 2 locales and note the
  number (the §18.6 targets still apply).
- **Consumers are locale-aware.** Every consumer asks the snapshot with the render locale: navigation (a page reference,
  folder or target page unreleased in L is absent in L's navigation), values/loops (records, record sets, globals),
  pagination sources, template hierarchy (live, unchanged), output paths (the released version's folder/uid/path
  override for L), `BuildPlanner.siteOutputs` (page × channel × locale only where the page is released in L).
- **Unreleased references.** Where `GenerationRenderer` today renders empty + `SF-GEN-0220` for a tombstone, an asset
  that exists at R but is not released in L renders empty with a new warning **`SF-GEN-0221` "Reference to an
  unreleased asset"** naming source page, locale and target. The missing-page `SF-GEN-0204` failure path must not be
  reachable for an unreleased page (it is "present but unreleased", not missing). Media: an unreleased media renders
  empty with `SF-GEN-0221` (today's silent empty only for truly missing media).
- **Media copies.** The ASSETS stage copies the released version's blob of a media asset (per locale for localized
  media is `M27.3.2`); a media released in no locale is not copied.
- **Site files.** Sitemap, robots, redirects, `search-index.json` come from site outputs, so they follow automatically —
  prove it with a test.
- Register `SF-GEN-0221` in `GenerationDiagnosticCodes`.

## Acceptance criteria

- [x] Golden: every existing generation fixture (with and without locales, paginated, record sets) builds
      byte-identically before and after migration.
- [x] A page with an unreleased draft edit renders the released text; a `NEW` page produces no output, no nav entry,
      no sitemap/search entry; a link to it renders empty with `SF-GEN-0221` (run `PARTIAL`, as for `SF-GEN-0220`).
- [x] `DELETION_PENDING` page still renders at its old path; a moved-but-unreleased page renders at its old path.
- [x] Per-locale: EN released at v2, DE at v1 → `en/…` shows v2 text/structure, `de/…` v1; a page released only in EN
      has no DE output and is absent from DE navigation.
- [x] Records: a `NEW` record is not iterated by `dataset:`/`recordset:` loops; a `CHANGED` record renders its released
      values; an unreleased record set renders as missing.
- [x] A build at an older revision R uses the release state at R.
- [x] `./gradlew build` green.

## Out of scope

- Incremental seeding (`M27.2.2`), preview (`M27.2.3`), localized media paths (`M27.3.2`).

## Notes / hazards

- `UrlRegistryService.resolve` is read live today (`GenerationRenderer:751`): it maps page references to hrefs; make it
  consult the snapshot's released path for the render locale, or the registry will hand out a draft path for a moved,
  unreleased page. Cover it with a test.
- A released page may use a template whose **current** CDL no longer matches the released payload's shape (live
  templates, decision 13): the tolerant read of L10N/plain values must also apply in the renderer/value resolver.
- Keep the "only one snapshot → baseline → plan path" property of `planFor` — no second loader.

## Implementation notes

- **Snapshot = a family of per-language views.** `Snapshot.in(locale)` returns the view of one language; the family's
  `root()` is the default language's view (the only view without locales) and keys the build's compile memo, so every
  view shares one memo. `asset(uuid, locale)`, `pages(locale)`, `assetsOfType(type, locale)` are shorthands. The draft
  view (`SnapshotView.DRAFT`) has one view for every language; the 4-argument constructor keeps unit fixtures working.
- **Unreleased = absent marker.** Every view holds every asset that exists at R. An asset not released in the view's
  language is present with its draft identity and `deleted = true, unreleased = true` (`SnapshotAsset.asUnreleased`),
  so every consumer that already skipped tombstones skips it at exactly the same places (pages, outputs, navigation,
  loops, pagination, asset copy, site files) and a reference to it still resolves — to `SF-GEN-0221` instead of
  `SF-GEN-0220`, never to the missing-page `SF-GEN-0204`. A tombstone released nowhere stays a plain tombstone.
- **Load.** `SnapshotService.snapshot(projectId, revision, view)`: the existing `findSnapshot` load, then one pointer
  query (`ReleaseStates.at`) and one chunked `findAllById` for the released versions that aren't the versions already
  loaded (`ReleaseStates.releasedVersions`). A (version, uid) shared by several languages is one `SnapshotAsset`; a
  pointer at the draft itself reuses the draft's object. The released uid is the pointer's `released_uid`.
- **Consumers.** The planner fans out per language view (`BuildPlanner.siteOutputs`: pagination, scope and paths from
  that language's version); `OutputPathResolver` resolves page paths in the language's view; `RenderPipeline` keeps
  one `GenerationRenderer` per view (`Renderers`), validates and holds back incomplete content per (page, language)
  — a language's version gone incomplete under a changed live template holds back only that language; carry-forward
  and plan insight name pages by the language's version. The renderer's uid index is the union over all views
  (templates compile once per build, whichever language compiles first).
- **Navigation.** `SnapshotNavigationLookup` leaves out a page reference that resolves to nothing only because its
  target isn't released in the language (it resolves once unreleased assets count): the entry is absent from that
  language's navigation instead of failing the page as a dangling reference.
- **URL registry.** `UrlRegistryService.resolve(…, Supplier<String> computed, ctx)`: generation hands the registry the
  path its snapshot writes the page to, used on a first assignment only, so a moved-but-unreleased page is never
  registered under its draft path.
- **Language switcher** links only to languages the page is released in; a section's `$CMS_REF` now resolves in its
  page's language (it used the root language before, a latent M24 gap that per-language versions would have exposed).
- **Tolerant read** needed no code: the renderer resolves L10N wrappers by shape (`L10nValues.resolve`), not by the
  current CDL — proven by a test that toggles `localizable` on while the released version is plain.
- **M27.1 fix:** `LocaleProjection` compares the parent (`folderId`) too — a record moved to another record set of the
  same folder kept its folder path and read as `PUBLISHED`, so it could never be released.
- **Golden.** `ReleaseFixtures.releaseAll` (the test helper every generation test now calls before building) renders
  the released view and the draft view in full whenever all views equal the drafts — the state the migration creates
  — and asserts byte-identical output and diagnostics. It runs on every generation fixture of the suite: with and
  without locales, paginated, record sets, navigation, media, processed media.
- **Tests:** `ReleasedGenerationIntegrationTest` (7: drafts/NEW pages/links/sitemap/search index, deletion and move
  pending, URL registry, time travel, records and sets, unreleased media, per-language versions and navigation,
  tolerant read), the golden check above, and every existing generation test adjusted to release its fixture.
- **Measured** (`GenerationBenchmark`, 5,000 pages × 2 locales, machine under load): released snapshot 158 ms (draft-only
  load on master 205 ms), full build 11.4 s (master 15.6 s); §18.6 targets hold.
