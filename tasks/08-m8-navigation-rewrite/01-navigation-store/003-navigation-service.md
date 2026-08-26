---
id: M8.1.3
status: done
depends: [M8.1.2]
epic: m8-navigation-rewrite
feature: navigation-store
area: backend
---

# M8.1.3 — Navigation resolution service

## Context

`M8.1.2` models the data; this task implements the resolution algorithm that turns a
`PageReference` (or an intermediate navigation folder) into a concrete `Page` — the
"practically a redirect to the first node" behavior called out in the milestone brief —
and the tree-walk used by rendering (`M8.1.4`) and by the nav-store UI's live preview
(`M8.1.6`).

## Goals

- `NavigationService.resolve(pageReferenceUuid, snapshot|liveRepo) -> UUID` (resolved
  `Page` uuid):
  - `target.kind == PAGE` → return `target.assetUuid` directly.
  - `target.kind == FOLDER` → first navigable page of that folder: if the folder's
    first `PageReference`-equivalent... — no, `target` is a *page-store* folder, so
    "first navigable page" means the folder's direct child pages in the store's
    deterministic order (matches whatever ordering Pages already use for folder
    listings); recurse into subfolders only if the folder itself has no direct pages.
  - Dead folder (no pages anywhere in its subtree) is a validation-time error, not a
    render-time failure — reject such a `PageReference` at save time in `M8.1.2`'s
    validation, not here.
- `NavigationService.resolveFolderEntry(navFolderUuid, snapshot|liveRepo) -> UUID`: if
  `startNode` is set, resolve through it (a `PAGE_REFERENCE` startNode delegates to the
  method above; a `FOLDER` startNode recurses into this same method); if `startNode` is
  `null`, the folder has no entry page (grouping-only) and callers must not link it.
- `NavigationService.tree(navFolderUuid, depth, snapshot|liveRepo) -> NavNode` (or
  equivalent record) for rendering/preview: nested structure of folders/`PageReference`s
  with each entry's resolved href pre-computed, mirroring the shape (not the class) of
  the old `NavNode`.
- Cycle protection on `startNode` chains (a folder's `startNode` chain must not revisit
  a folder) — reuse the "track visited UUIDs, truncate + diagnostic" pattern from the
  deleted `NavigationBuilder`, under a new diagnostic code (`SF-GEN-04xx`, pick the next
  free number in that range).
- Works against **both** a revision-pinned `Snapshot` (generation) and the live
  repositories (preview) — same dual-path split as `GenerationRenderer` vs.
  `PageRenderService` (§ M4/M6 pattern); do not hardcode `Snapshot`.

## Acceptance criteria

- [x] `resolve` returns the correct page for direct, one-level-folder, and
      nested-folder-with-no-direct-pages cases.
- [x] `resolveFolderEntry` returns `empty`/`null` (not an exception) for a `null`
      `startNode`, and resolves correctly through a `PAGE_REFERENCE` or `FOLDER`
      `startNode`.
- [x] A `startNode` cycle is detected, truncated, and reported via a new diagnostic
      code — never a stack overflow or infinite loop.
- [x] Identical results whether resolution runs against a `Snapshot` or live
      repositories, proven by a shared test fixture run through both paths.

## Out of scope

- OCTL wiring (`M8.1.4`), REST exposure (`M8.1.5`).

## Notes / hazards

- Reuse `PathService.MAX_DEPTH` or an equivalent bound as a hard recursion cap
  independent of cycle detection, in case of a very deep-but-acyclic chain.

### Resolution notes (M8.1.3 implementation)

**Final `NavigationService` interface (sf-domain, `com.acme.staticforge.asset.navigation`) —
load-bearing for `M8.1.4`/`M8.1.5`, which both build on this directly and run in parallel
right after this task:**

```java
public interface NavigationService {
    UUID resolve(UUID pageReferenceUuid, NavigationLookup lookup);
    UUID resolve(UUID pageReferenceUuid, NavigationLookup lookup, List<Diagnostic> diagnostics);
    Optional<UUID> firstNavigablePage(UUID pageStoreFolderUuid, NavigationLookup lookup);
    Optional<UUID> resolveFolderEntry(UUID navFolderUuid, NavigationLookup lookup);
    Optional<UUID> resolveFolderEntry(UUID navFolderUuid, NavigationLookup lookup, List<Diagnostic> diagnostics);
    NavTreeNode tree(UUID navFolderUuid, int depth, NavigationLookup lookup, List<Diagnostic> diagnostics);
}
```

  `Diagnostic` is `com.acme.staticforge.template.diagnostic.Diagnostic` (sf-template) — the
  same finding type `GenerationRenderer`/`PageRenderService` already use, so no new
  finding/warning type was introduced. Each cycle/depth-truncating method has a two-arg
  convenience overload (discards findings) plus a three-arg overload that appends into a
  caller-supplied `diagnostics` list — `tree()` (and `M8.1.4`'s render wiring) should always use
  the diagnostics-collecting form so cycle warnings surface in the run's findings.

  `resolve()` returns `UUID` (nullable — `null`, never a thrown exception) rather than
  `Optional<UUID>`, matching the Goals' literal signature; `resolveFolderEntry` and
  `firstNavigablePage` return `Optional<UUID>` per the Goals text. `tree()` returns a
  `NavTreeNode` record: `(UUID assetUuid, AssetType type, String uid, String displayName,
  String label, UUID resolvedPageUuid, List<NavTreeNode> children)` — `label` is the
  `coalesce(PageReference.label, target.displayName)` value for a `PAGE_REFERENCE` node (per
  M8.1.2's documented rule) or just `displayName` for a `FOLDER` node; `resolvedPageUuid` is
  `null` for a grouping-only folder (no `startNode`) or an unresolvable/dangling target.

- **Data-access abstraction** (Goal #5): `NavigationLookup` (`byUuid`, `childrenOf`) plus
  `NavigationAsset` (`uuid, type, uid, displayName, payload`) is the seam the algorithm is
  written against — it never sees `Snapshot` or the JPA repositories directly, mirroring the
  `GenerationRenderer`(`Snapshot`) vs. `PageRenderService`(live) split. Two implementations
  landed in this task:
  - `LiveNavigationLookup` (sf-domain, `@Component`, stateless) — backs preview/live. Required
    one small repository addition: `AssetVersionRepository.findByFolderIdAndValidToRevisionIsNullAndDeletedFalse(Long)`,
    mirroring the existing `existsByFolderIdAndValidToRevisionIsNull` derived query.
  - `SnapshotNavigationLookup` (sf-generate, `com.acme.staticforge.generate.nav`, plain
    constructor — not a bean, since it wraps a specific `Snapshot` instance) — backs
    generation. `Snapshot`/`SnapshotAsset` carry each asset's containing-folder *path*, not a
    parent *id* (unlike the live `AssetVersion.folderId`), so `childrenOf` derives direct
    parent/child membership from path structure (a folder's own path vs. a candidate's
    `folderPath`, or a candidate folder's `folderPath` with its last segment stripped) — see
    the class javadoc. `M8.1.4` wires this into `GenerationRenderer`; this task only needed it
    to exist so the dual-path parity acceptance criterion could be tested now.

- **Diagnostic code chosen: `SF-GEN-0410`** (constant
  `NavigationDiagnosticCodes.NAV_START_NODE_CYCLE`, sf-domain
  `asset.navigation` package) — the next free number in the `SF-GEN-04xx` range (currently
  empty; the deleted `NavigationBuilder` used this exact code for the same concept, per its
  javadoc recovered from git history). Reused for **both** conditions the Goals/hazards call
  out: a `startNode` chain revisiting an already-visited folder, and a `startNode` chain
  exceeding `PathService.MAX_DEPTH` (12) with no cycle at all — distinguished only by message
  text, since both are "chain truncated, treat as unresolved from here" findings. No second
  code was added; this keeps the footprint to exactly what the Goals asked for ("a new
  diagnostic code", singular). The folder-subtree walk in `firstNavigablePage` (page-store
  folders, structurally acyclic — `FolderService.move` already forbids moving a folder into its
  own descendant) is also capped at `MAX_DEPTH` but does **not** emit this code: it is a
  different, guaranteed-acyclic tree walk, and treating a defensive depth cap there as a
  reportable diagnostic would be noise for data that cannot actually be malformed this way.

- **Decision — dangling-folder validation (Goal #6):** added now, in
  `PageReferenceServiceImpl.requireValidTarget` (sf-domain), reusing this task's own
  `NavigationService.firstNavigablePage` + a `LiveNavigationLookup` (both now constructor
  dependencies of `PageReferenceServiceImpl`). A `FOLDER`-targeted `PageReference` whose target
  folder has no page anywhere in its subtree is now rejected at create/update time with a new
  domain code, `SF-DOM-0130` (422, "Validation Failed") — chosen because doing the "computation"
  M8.1.2 explicitly deferred required exactly the subtree-search algorithm this task builds;
  waiting for `M8.1.4`/`M8.1.5` would have let dangling references get persisted with no
  render-time contract for what happens to them. Covered by
  `NavigationServiceIntegrationTest.pageReferenceCreateRejectsADanglingFolderTarget` (sf-app).

- **Decision — `asset_reference` materialization (M8.1.2's flagged gap):** deliberately left
  unaddressed, as M8.1.2 flagged as "genuinely out of scope" for this task. `resolve()` handles
  a stale/dangling target entirely at render time: it returns `null` (not an exception) when a
  `PAGE_REFERENCE`'s target has been soft-deleted after the reference was created (there is
  still no delete-blocking protection for that case — see
  `NavigationServiceImplTest.resolveReturnsNullWhenTheReferencedPageNoLongerExists` and
  `NavigationServiceImplTest.resolveReturnsNullForADanglingFolderTarget`, which cover the
  render-time-only path directly, without needing materialization). Adding delete-blocking via
  `ContentReferenceService.materialize`/`asset_reference` is left for whichever future task
  wants to close that gap for real (it also affects generic `AssetService.delete`'s reference
  check, `SF-DOM-0120`, not something this task should touch) — `resolve()`'s contract is
  intentionally defensive either way, so nothing about that future change should require
  re-touching this algorithm's signatures.

- **Ordering convention chosen for "direct child pages, deterministic order" (Goal #1):**
  `nav.position` ascending, then `displayName`, then `uid` as a final tiebreak — the same
  default the deleted `NavigationBuilder`/`StructureSource` used (`nav.position asc,
  displayName asc`, spec §17.2), since `PageServiceImpl.create` already writes a default
  `nav.position: 0` into every new page's payload specifically for this purpose and no other
  ordering convention exists for a folder's page listing today (`PageService.list` itself
  returns filtered-but-unsorted results). Folders (no `nav.position`) order by `displayName`
  then `uid`. Documented here since `PageService.list`/the REST page-list endpoint do **not**
  themselves apply this order — only `NavigationService` does, deliberately, since only nav
  resolution/tree-building needs a deterministic "first" page.

- **Subfolder search order for a dangling-at-direct-level `FOLDER` target (Goal #1):**
  depth-first over direct subfolders in the same deterministic order (recurse fully into the
  first subfolder before trying the next), returning the first page found anywhere. Not
  specified precisely by the Goals text; documented as the concrete choice.

**Verification:** `./gradlew spotlessApply` then `./gradlew build` — full multi-module build
green (compile + spotless + all tests, sf-app's frontend bundle included). New tests:
- `server/sf-domain/src/test/java/com/acme/staticforge/asset/navigation/NavigationServiceImplTest.java`
  (13 tests) — pure algorithm unit tests against an in-memory `FakeNavigationLookup` (no Spring
  context, no DB): direct/one-level-folder/nested-folder resolve, dangling-target resolve,
  stale-target resolve, `resolveFolderEntry` null/`PAGE_REFERENCE`/`FOLDER` `startNode`, cycle
  detection + truncation + `SF-GEN-0410`, `MAX_DEPTH` truncation without a cycle, `tree()`
  nesting/labels/`resolvedPageUuid`, `tree()` at `depth=0`, `tree()` on an unknown root.
- `server/sf-app/src/test/java/com/acme/staticforge/NavigationServiceIntegrationTest.java`
  (4 tests) — live-repository resolution, the new dangling-folder validation
  (accept/reject), and the explicit dual-path parity acceptance criterion: one fixture (nested
  page-store folders, a `FOLDER`-targeted `PageReference`, and a two-level `startNode` chain)
  resolved through `LiveNavigationLookup` and through a `SnapshotNavigationLookup` built from a
  `SnapshotService.snapshot(...)` of the same project, asserting identical `resolve`/
  `resolveFolderEntry`/`tree` results (tree compared via a canonical string rendering).
