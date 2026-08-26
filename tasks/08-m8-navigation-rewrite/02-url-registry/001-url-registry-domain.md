---
id: M8.2.1
status: done
depends: [M8.1.2]
epic: m8-navigation-rewrite
feature: url-registry
area: backend
---

# M8.2.1 — URL registry domain model

## Context

Model the registry as a plain cache table, not a revisioned asset — it does not need
diff/restore, and forcing it through the `Asset`/`AssetVersion` revision machinery would
make "assigned once, changes only via explicit reset" harder to reason about than a
dedicated table with its own audit columns.

## Goals

- New entity `UrlRegistryEntry` (Liquibase changelog, next free number after the last
  existing one): `id`, `projectId`, `channelKey` (FK-by-value to `OutputChannel.key`,
  same non-FK convention channels already use elsewhere if any), `pageReferenceUuid`,
  `area` (enum `PREVIEW | GENERATED`), `url` (the assigned string), `assignedAt`,
  `assignedRevision` (the project revision at which this URL was first computed, for
  audit — not used to invalidate), `overridden` (boolean — true once a human edits it
  via `M8.2.4`'s modify endpoint, so automatic reassignment after a reset can be
  distinguished from manual edits in the UI).
- Unique constraint on `(projectId, channelKey, pageReferenceUuid, area)` — exactly one
  live URL per tuple.
- No `validFrom/validTo` interval versioning (unlike `AssetVersion`) — a reset performs
  an in-place delete-then-recompute-on-next-access, not a new revision row. Document
  this deliberate divergence from the revision pattern in Notes.

## Acceptance criteria

- [x] Liquibase changelog creates the table with the unique constraint above and
      indexes on `(projectId, area)` and `(pageReferenceUuid)` for the settings UI's
      list/filter queries.
- [x] Repository (`UrlRegistryRepository`) supports find-by-tuple, find-all-by-project
      (paginated, filterable by channel/area), and delete-by-scope (single entry,
      whole channel, whole project) for the reset operation in `M8.2.2`.

## Out of scope

- Assignment/resolution logic (`M8.2.2`), generation/preview wiring (`M8.2.3`).

## Notes / hazards

- Deleting a `PageReference` (in `M8.1`) must cascade-delete its registry entries in
  both areas — add an `ON DELETE CASCADE` or explicit cleanup in
  `NavigationService`'s delete path; a dangling registry row pointing at a deleted
  reference is a silent-bug magnet.

## Implementation record (M8.2.1, done)

**Package:** `com.acme.staticforge.urlregistry` (new top-level package, sf-domain) — sibling
to `channel`, not nested under `asset.navigation`. Chosen because this is its own concern
(a channel×page-reference cache), matching how `OutputChannel` already gets its own
top-level package despite also referencing assets.

**Entity — `UrlRegistryEntry`** (`@Entity`, `@Table(name = "url_registry_entry")`):
- `Long id` — `@Id @GeneratedValue(IDENTITY)`
- `long projectId`
- `String channelKey` (`VARCHAR(40)`, unenforced value reference to `OutputChannel.key`)
- `UUID pageReferenceUuid` (unenforced value reference to `Asset.uuid`)
- `UrlArea area` — new enum `{PREVIEW, GENERATED}` in the same package, `@Enumerated(STRING)`,
  `VARCHAR(20)`
- `String url` (`VARCHAR(1000)`, not null)
- `Instant assignedAt` (not null)
- `long assignedRevision` (not null, audit-only — never used to invalidate)
- `boolean overridden` (not null, default `false`)

Constructor is the full-args form (no builder, matching `OutputChannel`/`GenerationRun`);
getters/setters, no-args protected ctor for Hibernate.

**Repository — `UrlRegistryRepository extends JpaRepository<UrlRegistryEntry, Long>`:**
- `Optional<UrlRegistryEntry> findByProjectIdAndChannelKeyAndPageReferenceUuidAndArea(long projectId, String channelKey, UUID pageReferenceUuid, UrlArea area)`
- `Page<UrlRegistryEntry> search(long projectId, String channelKey, UrlArea area, Pageable pageable)`
  — `@Query` JPQL with `(:channelKey IS NULL OR ...)` / `(:area IS NULL OR ...)` optional
  filters, mirroring `AssetVersionRepository.search`. Both filters nullable/optional.
- `void deleteByProjectIdAndChannelKey(long projectId, String channelKey)` — whole-channel reset
- `void deleteByProjectId(long projectId)` — whole-project reset
- `void deleteByPageReferenceUuid(UUID pageReferenceUuid)` — cascade-cleanup hook
- Single-entry delete: no bespoke method — callers use inherited `deleteById(Long)`.

**Liquibase:** `server/sf-app/src/main/resources/db/changelog/v1.0/014-url-registry.xml`
(014 was the next free number after `013-remove-structure-assets.xml`, confirmed no higher
changelog existed). Single `dbms`-agnostic changeset (no JSON columns, so no postgresql/h2
split needed) creating `url_registry_entry`, `addUniqueConstraint uq_url_registry_tuple` on
`(project_id, channel_key, page_reference_uuid, area)`, and two indexes:
`idx_url_registry_project_area (project_id, area)` and
`idx_url_registry_page_reference (page_reference_uuid)`.

**Revisioning divergence (as specced):** plain CRUD table, no `validFrom`/`validTo` interval,
no `@RevisionAware` on any writer of this table — confirmed the `@RevisionAware` convention is
currently annotation-only (no ArchUnit test/dependency exists yet in this repo to enforce it;
`RevisionAware.java`'s javadoc describes an aspirational rule). `UrlRegistryEntry` writes will
happen from `M8.2.2`'s service, which is out of this task's scope.

**FK convention decision:** `channelKey`/`pageReferenceUuid` are unenforced value columns, not
real FKs — every existing FK in this schema targets `asset(id)` (the internal `Long` PK), never
`asset(uuid)`; cross-asset UUID references (e.g. `PageReference.target.assetUuid`) are already
stored unenforced inside JSON payloads elsewhere in this domain. Matched that convention rather
than introducing the first-ever FK-by-UUID.

**Cascade-delete implementation:** Since a `PageReference`'s deletion is a soft-delete (a new
`AssetVersion` row with `deleted=true`; the `Asset` row itself is never physically removed) and
routes generically through `AssetServiceImpl.softDelete` (called from `AssetController` for
every asset type — `NavigationService` is stateless/pure and has no delete path of its own, so
the note above pointing at "`NavigationService`'s delete path" doesn't match this codebase's
actual architecture), the cascade hook lives in `AssetServiceImpl.softDelete`: a new
`UrlRegistryRepository` dependency was added to `AssetServiceImpl`'s constructor, and after the
delete version is inserted, `if (asset.getAssetType() == AssetType.PAGE_REFERENCE) { urlRegistryRepository.deleteByPageReferenceUuid(asset.getUuid()); }`
removes both `PREVIEW` and `GENERATED` rows for that reference across every channel. This is a
DB-level explicit delete (no `ON DELETE CASCADE`, consistent with the FK decision above).

**Tests:** `server/sf-app/src/test/java/com/acme/staticforge/UrlRegistryRepositoryTest.java`
(`@SpringBootTest`, `@ActiveProfiles("test")`, matching the existing integration-test pattern —
no `@DataJpaTest` is used anywhere in this codebase). Covers: find-by-tuple round trip, the
unique-tuple constraint rejecting a duplicate row (`DataIntegrityViolationException`),
`PREVIEW`/`GENERATED` independence for the same tuple, `search` filtering by channel/area/both
and paginating, `deleteByProjectIdAndChannelKey` scoping, `deleteByProjectId` scoping, and the
full cascade-delete flow (`PageReference` created → two registry entries assigned → asset
soft-deleted → both entries gone, an unrelated entry untouched).

**What `M8.2.2` needs:** inject `UrlRegistryRepository` directly; `findByProjectIdAndChannelKeyAndPageReferenceUuidAndArea`
is the read-through-cache check before computing a URL, `save(new UrlRegistryEntry(...))` (or
mutate+`save` for override) is the write path, and the three `deleteBy*` methods plus inherited
`deleteById` cover every reset scope from the Goals table. No service class exists yet in this
package — `M8.2.2` is the first thing that adds one (and should carry `@RevisionAware` only if
it also writes through a revisioned repository; writes to `url_registry_entry` alone don't need
it per the divergence documented above, though allocating a revision for audit purposes, if
desired, is a product decision left to that task).
