---
id: M8.2.2
status: done
depends: [M8.2.1]
epic: m8-navigation-rewrite
feature: url-registry
area: backend
---

# M8.2.2 — URL registry service

## Context

Implements the "assign once, cache forever until reset" contract: given a
`PageReference`, a channel, and an area, return its URL — computing and persisting it
via `OutputPathResolver` only on first access, otherwise returning the stored row
untouched.

## Goals

- `UrlRegistryService.resolve(pageReferenceUuid, channelKey, area, ctx) -> String`:
  - Look up an existing `UrlRegistryEntry`; if present, return `url` as-is (no
    recomputation, no drift-checking against current `OutputPathResolver` output).
  - If absent: resolve the `PageReference` to a concrete page via
    `NavigationService.resolve` (`M8.1.3`), compute the URL via `OutputPathResolver`
    for that page+channel, persist a new entry, return it.
- `UrlRegistryService.override(pageReferenceUuid, channelKey, area, url, ctx)`: manual
  edit — upsert the entry with `overridden = true`. No format validation beyond "valid
  relative or absolute URL" (reuse whatever validator, if any, channels/paths already
  use).
- `UrlRegistryService.reset(projectId, scope, ctx)` where `scope` narrows to a single
  entry, a channel, an area, or the whole project — deletes matching entries. Does
  **not** eagerly recompute; the next `resolve` call repopulates lazily.
- All methods take `RevisionContext` for audit logging purposes only (the registry
  itself is not revisioned per `M8.2.1`'s Notes) — confirm with the M1 revision service
  whether a non-asset audit trail needs a different mechanism than `RevisionContext`,
  and note the answer here.

## Acceptance criteria

- [x] First `resolve` call for a new tuple computes and persists; a second call returns
      the identical string even if the underlying page's slug/displayName changes in
      between (prove with a test that changes the page then re-resolves).
- [x] `override` makes subsequent `resolve` calls return the manual value, marked
      `overridden`.
- [x] `reset` at each scope level (entry/channel/area/project) deletes exactly the
      matching rows and nothing else.
- [x] `resolve` after a `reset` recomputes fresh (proving the lazy-repopulate
      contract) and clears `overridden`.

## Out of scope

- Wiring into generation/preview render paths (`M8.2.3`), REST exposure (`M8.2.4`).

## Notes / hazards

- Concurrent first-`resolve` for the same tuple (two parallel generation workers)
  must not create duplicate rows — enforce via the unique constraint from `M8.2.1` plus
  a catch-and-reread on constraint violation, not a distributed lock.

## Implementation record (M8.2.2, done)

**Final `UrlRegistryService` interface** (sf-domain, `com.acme.staticforge.urlregistry`) —
load-bearing for `M8.2.3`/`M8.2.4`, which both call this directly and run in parallel right
after this task:

```java
public interface UrlRegistryService {
    String resolve(UUID pageReferenceUuid, String channelKey, UrlArea area, RevisionContext ctx);
    UrlRegistryEntry override(UUID pageReferenceUuid, String channelKey, UrlArea area, String url, RevisionContext ctx);
    void reset(long projectId, ResetScope scope, RevisionContext ctx);
}
```

`override` returns the persisted `UrlRegistryEntry` (not `void`) since `M8.2.4`'s REST endpoint
will want to hand the caller back the full row (id, `assignedAt`, etc.), not just echo the URL it
was given.

**`ResetScope`** (new type, same package) — a single discriminated record rather than a sealed
hierarchy (no sealed type exists anywhere else in this codebase yet), mirroring how
`GenerationRequest` narrows scope with a mode enum plus nullable optional fields:

```java
public record ResetScope(Kind kind, Long entryId, String channelKey, UrlArea area) {
    public enum Kind { ENTRY, CHANNEL, AREA, PROJECT }
    public static ResetScope entry(long entryId);
    public static ResetScope channel(String channelKey);
    public static ResetScope area(UrlArea area);
    public static ResetScope project();
}
```

`UrlRegistryRepository` (`M8.2.1`) was missing a whole-area-only delete, so
`void deleteByProjectIdAndArea(long projectId, UrlArea area)` was added to it in this task, used
only by the `AREA` reset branch.

**How a URL is computed outside a full generation run — the load-bearing decision for
`M8.2.3`/`M8.2.4`:**

`OutputPathResolver` (sf-generate) is built from a revision-pinned `Snapshot`
(`OutputPathResolver.forSnapshot`) and lives in sf-generate, which `UrlRegistryService`
(sf-domain) cannot depend on (module dependency direction is one-way: sf-generate →
sf-domain, never the reverse — confirmed by reading both modules' `build.gradle.kts`). A bare
`resolve()` call also has no snapshot to pin to in the first place (e.g. a first preview visit,
or a manual REST call from `M8.2.4`, before any generation has ever run).

Resolution: the §18.3 placeholder-resolution algorithm itself (expression lookup —
`pathOverride` → template `outputPath` → default `{folder}{uid}.{ext}` — then placeholder
expansion, pretty-URL rewrite, slugify, date-parts) was extracted out of `OutputPathResolver`
into a new pure, stateless class **`OutputPathExpander`**
(sf-domain, `com.acme.staticforge.channel`), which takes a module-agnostic
`OutputPathExpander.PageContext(uid, displayName, folderPath, payload, templatePayload)` instead
of a `SnapshotAsset`/`Snapshot` pair. `OutputPathResolver` (sf-generate) was refactored to adapt
`SnapshotAsset` → `PageContext` and delegate to `OutputPathExpander`, then apply its own
generation-specific output-path syntax normalization (`OutputFile.normalize`) — its public API
and behavior are unchanged (all of `OutputPathResolverTest`'s existing worked-example assertions
still pass unmodified).

A new **`LiveOutputPathResolver`** (sf-domain, `com.acme.staticforge.urlregistry`, `@Component`,
stateless) adapts the same `OutputPathExpander` onto the live `AssetRepository`/
`AssetVersionRepository` — reading `uid`/`displayName`/`folderPath`/`payload` off the asset's
current (`validToRevision IS NULL`, non-deleted) version, and resolving `payload.templateRef`
(a UUID string) to the template asset's own current-version payload the same way
`OutputPathResolver.templateOf` does for a `SnapshotAsset`. This exactly mirrors how
`LiveNavigationLookup` (`M8.1.3`) adapts `NavigationLookup` onto the same repositories for the
same live-vs-snapshot split. `LiveOutputPathResolver.resolveUrl(pageUuid, channel, indexUid,
trailingSlash, urlStrategy) -> Optional<String>` is what `UrlRegistryServiceImpl` calls after
`NavigationService.resolve` (via `LiveNavigationLookup`) turns the `PageReference` into a
concrete page uuid.

**Net effect for `M8.2.3`:** generation's `GENERATED` URLs (via `OutputPathResolver`) and this
service's on-demand computation (used today for both areas, since generation wiring doesn't
exist yet) can never drift apart — both paths bottom out in the exact same
`OutputPathExpander` algorithm. `M8.2.3` has two reasonable ways to wire the `GENERATED` area
during an actual generation run: (a) keep calling `UrlRegistryService.resolve` as-is (it uses
`LiveOutputPathResolver`, reading current live asset state, which is correct as long as
generation runs against current state) or (b) add a `Snapshot`-aware entry point if a truly
revision-pinned computation is ever required (e.g. regenerating an old revision) — that entry
point would call `OutputPathResolver.resolvePageUrl` directly and persist through
`UrlRegistryRepository` itself, bypassing `LiveOutputPathResolver`. Nothing in this task's
signatures blocks either option.

**Channel output settings gap (inherited, not fixed here):** `indexUid`/`trailingSlash`/
`urlStrategy` are not wired from `OutputChannel.settings` anywhere in this codebase yet —
`GenerationService.run` itself still hardcodes `OutputPathResolver.forSnapshot(snapshot, "index",
false, "DEFAULT")`. `UrlRegistryServiceImpl` intentionally mirrors that exact same hardcoded
tuple (`DEFAULT_INDEX_UID`/`DEFAULT_TRAILING_SLASH`/`DEFAULT_URL_STRATEGY` constants) rather than
inventing a second, disconnected default — wiring real per-channel settings through both call
sites is a pre-existing gap, left for whichever future task closes it.

**`RevisionContext` / audit trail (Goals' open question, answered):** confirmed against
`RevisionService` (the M1 revision service) that `allocate` always creates a real `Revision` row
tied to an asset-change summary (spec §21.2/§21.3) — it models "a project revision", not a
generic non-asset audit log, and there is no separate lighter-weight audit mechanism elsewhere in
this codebase. Calling it from here would misrepresent a cache assignment/reset as a project
revision, so `UrlRegistryServiceImpl` never calls `RevisionService.allocate`.
`RevisionContext.userId()`/`comment()` are accepted but unused, purely so every write method in
this feature (`resolve`, `override`, `reset`, and `M8.2.3`/`M8.2.4`'s future call sites) shares
one consistent revision-context-carrying signature, matching every other mutating service in this
codebase. `RevisionContext.projectId()` *is* used (the tuple's project scope).
`RevisionService.findRecent` (read-only) is used only to stamp `assignedRevision` with the
project's current latest revision id for audit/debugging, defaulting to `0` for a project with no
revisions yet — never used to invalidate, per `M8.2.1`'s entity javadoc.

**Concurrency:** `computeAndPersist` catches `DataIntegrityViolationException` from `save` (the
`M8.2.1` unique constraint) and re-reads the tuple rather than retrying the write or using a
lock, per this task's own Notes/hazards.

**Tests:**
- `server/sf-domain/src/test/java/com/acme/staticforge/urlregistry/UrlRegistryServiceImplTest.java`
  — mock-based (`UrlRegistryRepository`/`NavigationService`/`LiveNavigationLookup`/
  `LiveOutputPathResolver`/`RevisionService` all mocked): the catch-and-reread race path
  (deterministic, via a mocked `save` throwing `DataIntegrityViolationException` once), the
  read-through-cache short-circuit (no `NavigationService`/`save` calls when an entry already
  exists), and `ResetScope`→repository-method dispatch for all four `Kind`s.
- `server/sf-app/src/test/java/com/acme/staticforge/UrlRegistryServiceIntegrationTest.java`
  (`@SpringBootTest`, real repositories/services, matching this codebase's only integration-test
  pattern) — first-resolve compute+persist; URL stability across a page edit (a template with
  `outputPath: {"html": "{folder}{displayNameSlug}.{ext}"}` makes the proof meaningful: the page
  is renamed after the first `resolve`, and the second `resolve` still returns the pre-rename
  URL); `override` (both upsert-over-existing and upsert-with-no-existing-row); all four `reset`
  scopes each deleting exactly the matching rows (including cross-project isolation for the
  `PROJECT` scope); `resolve` after `reset` recomputing the same URL fresh and clearing
  `overridden`.

**Verification:** `./gradlew spotlessApply` then `./gradlew build` — full multi-module build
green (compile + spotless + all tests, sf-app's frontend bundle included); `OutputPathResolverTest`
(sf-generate) passes unmodified, confirming the `OutputPathExpander` extraction didn't change
generation's behavior.
