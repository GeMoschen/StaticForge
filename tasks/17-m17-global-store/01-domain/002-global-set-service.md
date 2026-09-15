---
id: M17.1.2
status: todo
depends: [M17.1.1, M16.5.2, M16.1.1]
epic: m17-global-store
feature: domain
area: backend
---

# M17.1.2 — `GlobalSetService`: create, schema update with migration, values update, delete

## Context

Templates are the closest existing code. `TemplateServiceImpl`
(`server/sf-domain/src/main/java/com/acme/staticforge/asset/template/TemplateServiceImpl.java`):

- compiles CDL with `compileDefinition(source)` and throws 422 `SF-API-0422` carrying
  `SF-CDL-*` diagnostics on errors (~line 206),
- builds `contentDefinition` + `compiledDefinition` into the payload (`buildPayload`),
- migrates `renamedFrom` editor renames with `migrateRenames`/`collectRenames` (§12.3,
  ~line 327). For templates that is a cross-asset cascade into every page's `bodies`
  under a `beginBatch`.

Page content is stored under `payload.content`. After `M16.5.2`, page saves validate it
with `ContentValidator.validate(def, content)`. After `M16.3.1`, content references in a
payload (`ContentReferenceService`: `MEDIA_REF`, `ASSET_REF`, link `INTERNAL`/`MEDIA`) are
materialized in the saving revision, and the previous rows are closed.

A `GLOBAL_SET` holds schema and values in one asset: `{contentDefinition, compiledDefinition, content}`.

## Goals

- `GlobalSetService` interface + `@RevisionAware` `GlobalSetServiceImpl` in a new
  `com.acme.staticforge.asset.globals` package (sibling of `asset.navigation`). Operations,
  each taking `RevisionContext` and using `allocateOrJoin`:
  - `create(ctx, parentFolderUuid, displayName, cdlSource)`: compiles the CDL and creates the
    asset through `AssetService.create(AssetType.GLOBAL_SET, …)` (scope checked by
    `FolderScope.requiredFor`). `content` is seeded from editor `defaultValue`s.
  - `updateSchema(ctx, uuid, cdlSource, ifMatchRevision)`: compiles the CDL, applies
    `renamedFrom` renames to `content` **inside the same new version** (one asset, one
    revision), and validates the migrated `content` against the new definition. Values of
    editors that were removed are dropped, with the same semantics as §12.3 for pages.
    Record this in Javadoc.
  - `updateValues(ctx, uuid, content, ifMatchRevision)`: validates with
    `ContentValidator` against the stored `compiledDefinition` (422 with field-level
    issues), writes a new version, and materializes content references (`M16.3.1`).
  - `find(projectId, uuid, revision?)` and `list(projectId, folderUuid?)`: read models
    `GlobalSetView(uuid, uid, displayName, folderPath, contentDefinition, compiledDefinition, content, revision)`.
  - Move, uid change and soft delete go through the existing generic `AssetService`
    operations. Soft delete stays blocked while inbound references exist, as for every
    asset type.
- **CDL restrictions for sets.** `body` declarations and `catalog` editors are rejected
  with a new CDL diagnostic (next free `SF-CDL-01xx` code in
  `template.diagnostic.DiagnosticCodes`, severity error, message "not allowed in a global
  property set"). Sets are value containers: bodies have no page to belong to, and catalog
  cards need section rendering from a page context.
- Optimistic concurrency on both update operations uses the existing
  `If-Match: "rev-{n}"` interval check, with 409 on mismatch, exactly like page saves.
- Unit tests with mocked repositories, plus one integration test
  (`GlobalSetIntegrationTest`): create → update values → rename editor with
  `renamedFrom` → value preserved → remove editor → value dropped → stale `If-Match` → 409.

## Acceptance criteria

- [ ] Creating a set with valid CDL creates one revision with one asset. Invalid CDL
      returns 422 with `SF-CDL-*` diagnostics and no revision is allocated.
- [ ] `body` or `catalog` in a set's CDL gives the new diagnostic code, which is added to
      `DiagnosticCodes` and to the diagnostics table in `docs/template-developer-guide.md` §3.2.
- [ ] `updateSchema` with `renamedFrom` moves the value to the new editor name in the
      same version write, and the revision's `summary.assets` has exactly one entry.
- [ ] `updateValues` rejects content that violates the compiled definition (required,
      maxLength, pattern, wrong value type) with 422 and field issues, and accepts valid content.
- [ ] Saving a value with a media editor creates a `MEDIA_REF` reference from the set to
      the media asset. Clearing it closes the reference (`valid_to_revision` set).
- [ ] Soft-deleting a set that is referenced (a template's OCTL `global:` reference or a
      page's render dependency, see `M17.3.1`) is refused with the existing
      in-use problem response.
- [ ] Stale `If-Match` → 409, and the conflict body has the same shape as for pages.
- [ ] `./gradlew :server:sf-domain:test` green, plus the new integration test.

## Out of scope

- REST endpoints and role checks (`M17.2.1`).
- OCTL resolution of `global:`/`CMS_GLOBAL` (`M17.3.1`).
- Locale-dependent values (`M24.3.3`).
- Allowing `catalog` editors in sets. That can come later once a page-independent section
  render context exists.

## Notes / hazards

- Don't copy `TemplateServiceImpl.migrateRenames` wholesale. Its loop exists because
  template renames fan out to *other* assets. Here the migration is a pure function
  `content × renames → content` applied before the single version write. Extract the
  shared rename-application logic (the `content.set(to, content.get(from)); remove(from)`
  step) into a small helper used by both, rather than a second copy.
- Use the compiled definition cache from `M16.1.1` for validation and rendering. Don't
  recompile `contentDefinition` in hot paths.
- Keep `@RevisionAware` on the impl; the ArchUnit gate requires it for repository writes.
