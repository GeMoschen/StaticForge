---
id: M8.2.4
status: done
depends: [M8.2.2]
epic: m8-navigation-rewrite
feature: url-registry
area: backend
---

# M8.2.4 — URL registry REST API

## Context

Expose list/override/reset for the project settings UI (`M8.2.5`).

## Goals

- `UrlRegistryController` under project settings' API namespace:
  - `GET /projects/{projectKey}/url-registry` — paginated list, filterable by
    `channelKey`, `area`, and a free-text search over the resolved URL/`PageReference`
    label (for the settings table).
  - `PATCH /projects/{projectKey}/url-registry/{id}` — manual override (body: `url`),
    delegates to `UrlRegistryService.override`.
  - `POST /projects/{projectKey}/url-registry/reset` — body selects scope: single
    entry id, `{channelKey}`, `{area}`, or whole-project (`{}`); delegates to
    `UrlRegistryService.reset`.
- Authorization matches other project-settings-mutating endpoints (PROJECT_ADMIN /
  DEVELOPER — confirm exact role against how `ChannelService` CRUD is gated and match
  it).
- OpenAPI schema updated for the frontend generated client.

## Acceptance criteria

- [x] List endpoint supports the three filters plus pagination; response includes
      `pageReferenceUuid`, a human-readable label (join through `PageReference`'s
      `displayName`/label override), `channelKey`, `area`, `url`, `overridden`,
      `assignedAt`.
- [x] Override endpoint round-trips and is reflected in the next list call.
- [x] Reset endpoint correctly scopes to each of the four levels; integration test per
      level.
- [x] Unauthorized roles get 403, matching the existing project-settings authorization
      test pattern.

## Out of scope

- UI (`M8.2.5`).

## Notes / hazards

- Reset is destructive and irreversible (assigned URLs are gone, next resolve
  recomputes) — this is by design, but the settings UI (`M8.2.5`) must surface a
  confirmation before calling it; note that expectation here since this task defines the
  contract the UI relies on.

## Implementation record (M8.2.4, done)

**Final endpoint list** (`UrlRegistryController`, `server/sf-api/src/main/java/com/acme/staticforge/api/UrlRegistryController.java`,
base path `/api/v1/projects/{projectKey}/url-registry`):

| Method | Path | Purpose | Role |
|---|---|---|---|
| `GET` | `/url-registry` | Paginated, filterable list (`channelKey`, `area`, `q`, `page`, `size`) | `VIEWER` |
| `PATCH` | `/url-registry/{id}` | Manual override of one entry's URL | `DEVELOPER` |
| `POST` | `/url-registry/reset` | Delete entries matching a scope (entry/channel/area/project) | `PROJECT_ADMIN` |

**Role choice (load-bearing for `M8.2.5`).** Investigated `ChannelController`: its routine
mutations (`create`/`update`/`enable`/`disable`) all gate at `DEVELOPER`, but `delete` — the one
destructive-at-scale operation on that controller — gates at `PROJECT_ADMIN`. `override` here is
a routine, reversible, single-row edit (an admin/dev can immediately re-override it), so it
matches `DEVELOPER`. `reset` is irreversible (deleted rows are gone; the task's own Notes call
this out) and, at the `AREA`/`PROJECT` scopes, can wipe every channel's cached URLs across the
whole project in one call — a strictly larger blast radius than `ChannelController.delete`
(single channel). It therefore takes the same `PROJECT_ADMIN` bar as `ChannelController.delete`,
not the `DEVELOPER` bar used for routine edits. List stays `VIEWER`, matching every other
project-settings read endpoint (`ChannelController.list`, `AssetController.list`,
`NavigationController.tree`).

**DTO shapes** (`server/sf-api/src/main/java/com/acme/staticforge/api/dto/`):

```java
record UrlRegistryEntryView(Long id, String channelKey, UUID pageReferenceUuid,
        String pageReferenceLabel, String area, String url, boolean overridden,
        Instant assignedAt, long assignedRevision) {}

record UrlRegistryOverrideRequest(String url) {}

record UrlRegistryResetRequest(Long entryId, String channelKey, String area) {}
```

List responses are `Page<UrlRegistryEntryView>` (Spring Data's default JSON shape — `content`,
`totalElements`, `totalPages`, `number`, `size`, …), matching `AssetController.list`'s exact
convention (no custom pagination envelope invented).

**Reset request body format** — `POST /url-registry/reset` body, exactly one field set (or none
for whole-project):

- `{}` or an omitted body → `ResetScope.project()` (whole project, every channel, both areas)
- `{"entryId": 123}` → `ResetScope.entry(123)` (single row; the controller first
  `UrlRegistryService.require(projectId, entryId)`s it, 404-ing rather than deleting, so a
  project-scoped caller can never reach another project's row by guessing an id — the
  `UrlRegistryRepository.deleteById` call inside `reset`'s `ENTRY` branch, added in `M8.2.2`, has
  no project-ownership check of its own)
- `{"channelKey": "html"}` → `ResetScope.channel("html")`
- `{"area": "PREVIEW"}` → `ResetScope.area(UrlArea.PREVIEW)` (`"PREVIEW"`/`"GENERATED"`,
  case-insensitive; anything else is a 400)
- More than one of `entryId`/`channelKey`/`area` set in the same body → 400
  ("Only one of entryId, channelKey, area may be provided.")

**`pageReferenceLabel` join.** `UrlRegistryEntry` only stores `pageReferenceUuid` (`M8.2.1`), so
the controller resolves it per row via `AssetService.requireCurrent(pageReferenceUuid)`, taking
the `PageReference` payload's `label` override when present, else `displayName` — the same
extraction `NavigationController.toReferenceView` already uses for `PageReferenceView.label`. A
stale/dangling `pageReferenceUuid` (the reference was deleted but its registry row wasn't reset
yet) is caught and yields `pageReferenceLabel: null` rather than failing the whole list.

**Free-text search (`q`).** `UrlRegistryRepository.search` (`M8.2.2`) only filters
`channelKey`/`area` — it has no text column to search, since the human-readable label lives on
the `PageReference` asset, not on `UrlRegistryEntry`, and this schema deliberately keeps
sf-domain's URL-registry table decoupled from a direct SQL join into the asset tables (see
`UrlRegistryEntry`'s own javadoc on unenforced value references). Adding one felt like the wrong
layering call for a settings-table search box. Instead, when `q` is present the controller does
an unpaged, `channelKey`/`area`-filtered fetch, joins in `pageReferenceLabel` (the same join the
response needs anyway), filters in-memory on `url`/`pageReferenceLabel` containing `q`
(case-insensitive), and paginates the filtered list manually (`PageImpl`). The no-`q` path stays
a single paginated DB query with per-page label joins only (bounded by page size). Registries are
project-settings-scale data (one row per `PageReference` x channel x area, not a content table),
so this was judged cheap enough in practice rather than "genuinely impractical" — documented per
this task's own Notes instruction.

**Domain-layer additions (sf-domain, not sf-generate/preview — respected the M8.2.3 boundary).**
`UrlRegistryService` (`M8.2.2`) gained two read-only methods this task needed and the settings
API convention (`AssetController.list` → `AssetService.search`, not a controller-to-repository
call) argues for putting on the service rather than injecting the repository into the
controller:

```java
Page<UrlRegistryEntry> search(long projectId, String channelKey, UrlArea area, Pageable pageable);
UrlRegistryEntry require(long projectId, long id);
```

Both are thin passthroughs to `UrlRegistryRepository` (`search`/`findById` + a project-ownership
check) — no new business logic, no revision/audit implications, nothing that touches
`sf-generate` or the preview render path.

**Tests:** `server/sf-app/src/test/java/com/acme/staticforge/UrlRegistryApiIntegrationTest.java`
(`@SpringBootTest` + `MockMvc`, fixture style mirrored from `NavigationApiIntegrationTest`, with
an added `DEVELOPER`-role member alongside the admin/viewer roles that fixture already had): list
filters (`channelKey`, `area`, `q`) plus pagination; the override round-trip reflected in a
subsequent list call; all four reset scopes through the HTTP endpoint (each verifying only the
matching rows are deleted, including cross-project isolation for the `PROJECT` scope); `VIEWER`
rejected with 403 on override while still able to read the list; `DEVELOPER` rejected with 403 on
reset while `PROJECT_ADMIN` succeeds.

**Verification:** `./gradlew spotlessApply` then `./gradlew build` — full multi-module build
green (compile + spotless + all tests, sf-app's frontend bundle included).
`./gradlew :server:sf-app:generateOpenApi` regenerates cleanly; `server/sf-app/build/openapi/openapi.json`
(a build artifact, not committed — same convention as `M8.1.5`) includes all three new paths:
`/api/v1/projects/{projectKey}/url-registry`, `/api/v1/projects/{projectKey}/url-registry/{id}`,
`/api/v1/projects/{projectKey}/url-registry/reset`.

**For `M8.2.5` (Angular UI, next task after this and `M8.2.3` merge):** build a
`url-registry.service.ts` against the endpoint table above. The list response is a plain Spring
`Page<UrlRegistryEntryView>` (`content`/`totalElements`/etc.), not a custom envelope. The reset
confirmation this task's own Notes calls for must exist before wiring the reset button, since the
API performs the delete unconditionally once called (no dry-run/preview endpoint was added,
unlike `ChannelController.deletePreview` — reset's blast radius is already fully described by
which of `entryId`/`channelKey`/`area`/none the UI is about to send, so a client-side confirmation
dialog summarizing that choice is sufficient and a server preview endpoint wasn't judged
necessary).
