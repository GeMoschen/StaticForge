# M25 — Record sets (records live in typed, queryable sets)

**Spec:** Extends §3 (glossary — new asset type), §5.1/§5.3/§5.4 (entity model, payload, reference
integrity), §12.3 (CDL-change migration — now also of stored queries), §14 (CDL — `reference`
editor), §16.2/§16.4/§16.5 (OCTL `$CMS_VALUE`/`$CMS_FOR` sources, reference resolution, scopes),
§18.2 (incremental planning), §20.2 (REST), §23/§24 (Content store UI), §26.5 (export/import).
Builds directly on `M19` (content store). Not part of the original §27 roadmap — inserted the same
way `M8`–`M24` were.

## Goal

Today (`M19`) every `RECORD` sits directly in a Content-store **folder**, and each record picks its
own `DATASET`. A folder can mix records of several datasets, the "which entries, in which order"
decision is repeated in every template loop (`where=`, `sort=`, `limit=`, `folder=`), and an editor
has no way to hand a page "this list of team members" through a `reference` editor.

This milestone introduces a **`RECORD_SET`** asset (user request 2026-09-23):

- A record set **defines the dataset type** of its records and a stored **query** —
  `where` / `sort` / `limit` / `offset` — that decides which of its records are shown and in which
  order.
- A **record always lives in exactly one record set** (its direct parent). The record's dataset is
  the set's dataset; creating a record means "add an entry to this set".
- Record sets live in the Content store (`FolderScope.CONTENT`) in ordinary folders; folders now hold
  folders and record sets, record sets hold only records.
- Record sets are **renderable**: `$CMS_VALUE(recordset:uid)$` renders the set's selected records,
  each through the dataset's **record template** for the current channel; the same works through a
  `reference` editor value, `$CMS_VALUE(editorName)$`, exactly like a `catalog` editor renders its
  cards.
- Record sets are a **loop source**: `$CMS_FOR(x : recordset:uid [, where=…, sort=…, limit=…, offset=…])$`
  and `$CMS_FOR(x : editorName)$` iterate the set's selected records for templates that want their own
  markup.
- A **`reference` editor can select record sets** (`assetTypes [RECORD_SET]`, optionally restricted
  to one dataset with the existing `dataset "uid"` attribute).
- Export/import, usages, diff, time travel, search and incremental generation handle the new type.
- **Records never live directly in the Content store** — not in `content_root`, not in a folder — and
  there is **no migration** of existing records (user decision 2026-09-23, see decision 8).

```
# page template, HTML channel
<section class="team">
  $CMS_VALUE(recordset:leadership)$            <!-- dataset "team"'s record template, per record -->
</section>

<ul>
$CMS_FOR(m : featuredMembers, limit=3)$        <!-- featuredMembers: reference editor → a RECORD_SET -->
  <li>$CMS_VALUE(m.name)$</li>
$CMS_END_FOR$
</ul>
```

## Decisions (binding for all tasks — revisit only with the user)

1. **Asset type & prefix.** `AssetType.RECORD_SET`; OCTL prefix `recordset` (mapped explicitly in
   `AssetReferencePrefixes.assetTypeForRef`, like `nav`; the enum-derived `record_set` is *not* a second
   accepted spelling). Payload `{datasetRef, query{where, sort, limit, offset}}`; `datasetRef` is
   mirrored into `asset_version.template_asset_id` (the `M19.1.1` record → dataset trick), so "sets of
   dataset X" is a column query.
2. **Containment.** A `RECORD`'s parent must **always** be a `RECORD_SET` — a record directly in
   `content_root` or in a Content folder is rejected on every write path (create, move, restore, import);
   there is no fallback or "unsorted" set. A `RECORD_SET`'s parent must be a Content folder (or
   `content_root`); a set has no subfolders or nested sets. A record keeps
   `payload.datasetRef` (validation, snapshot record index and planner keep working unchanged), and the
   domain layer guarantees it equals its set's `datasetRef`. A set's dataset is **immutable** after
   create (same rule as a record's dataset today). A record moves only between sets of the same dataset.
3. **Set query grammar.** The stored query is the `RecordService.RecordListQuery` flavour: `where` is an
   OCTL expression over **bare field names** (no loop variable, **no render scope** — `CMS_PAGE`,
   `$CMS_SET` vars and loop vars are rejected), `sort` the existing sort-key syntax, `limit`/`offset`
   non-negative integers. No `folder` (a set *is* the scope). Validated on save against the dataset's
   compiled definition with the existing `SF-TPL-0140/0141/0142` codes. Because the query is static,
   the planner can always prune precisely.
4. **Who owns what.** Record sets and their queries are **EDITOR** content (Content store). Markup is
   **DEVELOPER** content: a `DATASET` gains optional per-channel **record templates**
   (`channelTemplates.<channel>`, OCTL; the record's fields are in scope as top-level names like a
   section template's editors, plus `_uid`, `_displayName`, `_index`, `_first`, `_last`, `_count`). A set
   has no markup of its own; wrapping markup belongs to the page/section template around
   `$CMS_VALUE(…)$`.
5. **Loop narrowing.** `$CMS_FOR` over a set applies the set's query first; loop arguments then apply to
   that result: `where` is AND-ed, `sort` re-sorts, `offset`/`limit` slice the set's result. `folder=`
   on a set source is `SF-TPL-0140`.
6. **`dataset:` loops stay.** `$CMS_FOR(x : dataset:uid, …)$` keeps iterating all live records of a
   dataset across all of its sets (set queries are *not* applied); `folder=` keeps matching the Content
   folder path of the record's set. `RecordView` gains `_recordSet` (the set's uid).
7. **Delete.** A record set follows folder semantics: delete is blocked while it has live records unless
   `cascade=true` (then the set and its records go in one revision; restore brings them back together).
8. **No migration.** Existing records that sit directly in the Content store are **not** migrated,
   converted or auto-grouped — no startup job, no lazy self-heal, no compatibility code paths. Existing
   development databases are expected to be reset (or their content-store records recreated by hand).
   An archive containing a record outside a record set (every pre-`M25` archive with records) is
   rejected for those records with a blocking import conflict (`RECORD_OUTSIDE_RECORD_SET`); they are
   never grouped into sets.

## Exit criteria (epic is done when)

- [ ] An editor can create, rename, move, delete (cascade/restore) and diff `RECORD_SET`s in the Content
      store, choosing the dataset once; every mutation is one revision.
- [ ] A record can only be created inside a set; creating/moving a record outside a set, or into a set of
      another dataset, fails with the `FolderScope` violation error shape.
- [ ] A set's query is validated on save; `renamedFrom` in a dataset schema rewrites the field names in
      every set query of that dataset inside the same compound revision; a removed field leaves the set
      flagged (warning), never silently unfiltered.
- [ ] A developer can add per-channel record templates to a dataset; they compile on save with the usual
      `SF-TPL-*` diagnostics and field checks against the dataset schema.
- [ ] `$CMS_VALUE(recordset:uid)$`, `$CMS_VALUE(refEditor)$` (→ set), `$CMS_FOR(x : recordset:uid, …)$` and
      `$CMS_FOR(x : refEditor, …)$` render identically in generation and preview (golden files, HTML +
      Markdown).
- [ ] A `reference` editor can pick record sets, restricted by `dataset "uid"` when declared; server-side
      validation enforces the restriction.
- [ ] Incremental generation rebuilds exactly the pages affected by a changed record, set (query/name) or
      dataset record template — proven by `BuildPlanner` tests; `M22` build insight names the reason.
- [ ] No code path creates or keeps a record outside a record set: create, move, restore and import all
      reject it (tests per path); a pre-`M25` archive with records yields `RECORD_OUTSIDE_RECORD_SET`
      conflicts; no migration code exists.
- [ ] Record sets participate in selective export/import (implicit provenance record → set → dataset),
      usages, diff, time travel and global search.
- [ ] `./gradlew build`, `ui` `npm run build` and `npx vitest run` green; new golden files and the
      Playwright journey green.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [domain](01-domain/README.md) | backend | `M19`, `M15`, `M24.2` |
| 2 | [rendering](02-rendering/README.md) | backend | 1 |
| 3 | [api](03-api/README.md) | backend | 1, `M25.2.1` |
| 4 | [export-import](04-export-import/README.md) | backend | 1, `M25.2.1` |
| 5 | [ui](05-ui/README.md) | frontend | 3 |
| 6 | [docs-e2e](06-docs-e2e/README.md) | qa | 2, 4, 5 |

## Dependencies

`M19` (hard — datasets, records, query model, `DatasetLoopImpact`, snapshot record index), `M16.2`/`M16.3`
(cross-asset values, reference rows, revision-aware reference queries), `M15` (compound revisions — schema
rename), `M10`/`M11`/`M14` (export/import), `M22` (plan reasons), `M23` (search
indexing), `M24` (localizable record values render per locale; a set query evaluates against the render
locale exactly like dataset loops do).

## Notes

- **Precedent: `catalog` rendering.** `OctlRenderer.renderValue` already detects a `CATALOG` value and hands
  it to `BlockResolver.renderCatalog`, which renders each card through its section template. Rendering a
  set is the same shape: detect a `recordset:` accessor or an `ASSET_REF` with `assetType RECORD_SET` and
  hand it to a new `BlockResolver.renderRecordSet(uuid)` implemented twice (`GenerationRenderer`,
  `PageRenderService`). Never stringify the reference object.
- **Precedent: `M19.1.1` / `M19.3.2`.** Every `switch`/`if` over `AssetType` listed there needs a
  `RECORD_SET` arm or an explicit default; planner, insight and search code paths are the easiest to miss.
- **`template_asset_id` hazard (again).** After this epic three kinds of rows fill it (page → template,
  record → dataset, set → dataset). Every reader must filter on `asset_type`.
- **Open question for the user (not blocking):** should a set additionally allow a *per-set* template
  override (e.g. "leadership" as cards, "staff" as a list, same dataset)? The epic ships the dataset-level
  record template only; an override would be an additive payload field later.
- **Not in scope:** pagination over a record set (`M21` source — additive follow-up), manual drag-and-drop
  ordering inside a set (a `position` sort key would be a follow-up), a record belonging to several sets,
  set queries reading the render scope, CSV import/export.
- Spec follow-up (in `M25.6.1`): §3 glossary, §5.1 diagram, §16.2 table, §20.2 endpoint list.
