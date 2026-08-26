# M9 — Project-scoped UUIDs

**Spec:** Revises the implementation of §6.1 (`Every asset carries an immutable UUID`)
and §26.5's import behavior (`Import/copy operations create new UUIDs`, §6.1) — the
spec never actually mandates server-wide UUID uniqueness, it just hasn't been
implemented any other way yet. Not part of the original §27 roadmap — inserted after
M8, before `M10` (selective export/import), which depends on it.

## Goal

Today the `asset.uuid` column carries a single-column server-wide unique constraint
(`server/sf-app/.../db/changelog/v1.0/002-assets.xml`), and every import mints a fresh
UUIDv7 unconditionally (`ProjectExportImportServiceImpl.importProject`) specifically
*because* two assets anywhere on the server can never share a UUID. That's stricter
than the product actually needs: every route, query, and reference that resolves a
UUID already does so **inside a known project** (`/projects/{p}/assets/{uuid}`, per
§10's API shape) — nothing in the system currently depends on a UUID being resolvable
*without* knowing its project first.

Loosen the constraint to `(project_id, uuid)`, so the same UUID can legitimately exist
in two different projects on the same server. This is what makes it possible to
export one element and import it — unchanged, same identity — into a different
project, instead of always getting a disconnected copy with a new UUID. It's a
prerequisite for `M10` (selective export/import with conflict detection), not a UI
feature on its own.

## Exit criteria (epic is done when)

- [ ] `asset.uuid` is unique per `(project_id, uuid)`, not server-wide — enforced at
      the DB level (composite unique constraint) and by the JPA entity mapping.
- [ ] Every production code path that looks up an asset by UUID does so **scoped to a
      known project** — no remaining query resolves a bare UUID across all projects
      (except where a lookup is deliberately global for an admin/ops purpose, which
      must be called out explicitly, not left as an oversight).
- [ ] `ProjectExportImportServiceImpl.importProject` preserves each imported asset's
      **source UUID** by default; it mints a replacement UUID only when that UUID
      already exists in the *target* project (i.e., only to avoid a real collision on
      a same-project re-import).
- [ ] A test proves two different projects can each hold an asset with the identical
      UUID with zero cross-talk: revisions, template resolution, generation, preview,
      and the URL registry all behave correctly for both independently.
- [ ] Existing single-project behavior (revision history, template resolution,
      generation, preview, navigation, the URL registry) is unchanged for projects that
      never share a UUID with another project — this is a scope-loosening change, not a
      behavior change for the common case.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [uuid-scope-schema](01-uuid-scope-schema/README.md) | backend | M1 (asset schema) |
| 2 | [caller-project-scoping](02-caller-project-scoping/README.md) | backend | 1 |
| 3 | [cross-project-import-identity](03-cross-project-import-identity/README.md) | backend | 1, 2 |

## Dependencies

Touches the core `asset` table and `AssetRepository` from `M1`, and every module that
already resolves assets by UUID: template resolution (`asset/template`), preview
(`preview/PageRenderService`), navigation (`asset/navigation`), the URL registry
(`urlregistry`), channels (`channel/ChannelServiceImpl`), content references
(`asset/content/ContentReferenceService`), and `exportimport`. `M10` (selective
export/import) is built on top of this epic's result, not the other way around.

## Notes

- This is a scope *loosening*, not a new invariant — nothing currently relies on
  cross-project UUID uniqueness as a feature (there's no API that resolves "the asset
  with UUID X" without a project in the path), so this should be safe to do without a
  parallel deprecation window. Confirm that reading during `M9.2`'s caller audit rather
  than assuming it.
- `cms-specification.md` §6.1 doesn't need a correction — it never claimed server-wide
  uniqueness — but a follow-up doc note clarifying the scope explicitly would help the
  next reader; not tracked here, per the same convention as `M8`/`M10`.
