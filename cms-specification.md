# StaticForge CMS — Product Specification & Implementation Document

**Document version:** 1.0
**Status:** Draft for implementation
**Audience:** Product, Backend, Frontend, QA, DevOps

---

## Table of contents

1. [Product overview](#1-product-overview)
2. [Goals, non-goals, personas](#2-goals-non-goals-personas)
3. [Glossary](#3-glossary)
4. [System architecture](#4-system-architecture)
5. [Core domain model](#5-core-domain-model)
6. [Identity: UUID, display name, UID](#6-identity-uuid-display-name-uid)
7. [Revision safety](#7-revision-safety)
8. [Projects, users, permissions](#8-projects-users-permissions)
9. [Authentication with JWT](#9-authentication-with-jwt)
10. [Asset type: Page](#10-asset-type-page)
11. [Asset type: Media](#11-asset-type-media)
12. [Asset type: Section template](#12-asset-type-section-template)
13. [Asset type: Page template](#13-asset-type-page-template)
14. [Content definition language (CDL)](#14-content-definition-language-cdl)
15. [Output channels](#15-output-channels)
16. [Output channel template language (OCTL)](#16-output-channel-template-language-octl)
17. [Structure & navigation](#17-structure--navigation)
18. [Generation pipeline](#18-generation-pipeline)
19. [Preview](#19-preview)
20. [REST API specification](#20-rest-api-specification)
21. [Backend implementation](#21-backend-implementation)
22. [Database, Hibernate & Liquibase](#22-database-hibernate--liquibase)
23. [Frontend implementation (Angular)](#23-frontend-implementation-angular)
24. [UI/UX specification](#24-uiux-specification)
25. [Testing strategy](#25-testing-strategy)
26. [Non-functional requirements](#26-non-functional-requirements)
27. [Delivery roadmap](#27-delivery-roadmap)
28. [Appendix A — Worked example](#appendix-a--worked-example)
29. [Appendix B — Error catalogue](#appendix-b--error-catalogue)
30. [Appendix C — Open questions](#appendix-c--open-questions)

---

## 1. Product overview

StaticForge is a **headless, revision-safe content management system that produces static sites**. Editors work in a browser application; the system stores structured content, and a generation step renders that content through channel-specific templates into a deployable set of static files (HTML by default, Markdown or any other text format as an additional channel).

The product separates three concerns that are usually entangled in classic CMS products:

| Concern | Owned by | Artifact |
|---|---|---|
| *What can be edited* | Content definition language (CDL) inside templates | Editor declarations |
| *What the editor typed* | Content storage | Versioned content values per asset |
| *How it is rendered* | Output channel templates (OCTL) | One template per (template, channel) pair |

Because rendering is fully separated from content, the same content can be emitted into multiple channels without duplication, and a template change never invalidates stored content.

**Key characteristics**

- **Multi-project.** One installation hosts many independent projects. Assets never cross project boundaries.
- **Revision safe.** Every mutation creates a new project-scoped revision (`long`, starting at `1`). Any past revision can be read, diffed, previewed, generated and restored.
- **Stable identity.** Every asset carries an immutable UUID plus a human-readable UID that is unique per asset type within a project.
- **Declarative.** Content models, navigation rendering and output are declared, not coded.
- **Static output.** No runtime dependency on the CMS for the delivered site.

---

## 2. Goals, non-goals, personas

### 2.1 Goals

| # | Goal | Success measure |
|---|---|---|
| G1 | Editors publish page changes without developer help | Time-to-publish for a text change < 2 min |
| G2 | Every change is attributable and reversible | 100% of mutations carry revision + author |
| G3 | One content set, many output formats | HTML + Markdown channels from identical content |
| G4 | Developers model content declaratively | New content type live without backend deploy |
| G5 | Generation of a 5,000-page project completes predictably | Full build < 5 min, incremental < 10 s |
| G6 | The editing UI is fast, accessible and keyboard-driven | WCAG 2.2 AA verified, core flows keyboard-complete |

**G1 and the publish policy (M28).** Since M27 a change goes online in two steps: it is **released** (§5.5) and then **built** (§18). Each project decides with its **publish policy** (§8.3) which of these steps its editors may take themselves: release, schedule releases, start incremental builds to the default target, start full builds. A project that opens `RELEASE` and `INCREMENTAL_BUILD` meets G1 without a developer — the editor releases a page and presses *Build now*. Nothing is opened by default, so a project that keeps the default has developers release and build, as in M27.

### 2.2 Non-goals (v1)

- No per-asset ACLs — permissions are per project only.
- No editorial approval workflow (draft → review → approve, four-eyes). Since M27 editorial content has a **release state** — saving writes a draft, releasing makes it the version builds render (§5.5) — and releases, unpublishing and builds can be scheduled (§18.7); approval gates still do not exist.
- No live/dynamic rendering of the delivered site.
- No visual drag-and-drop page *layout* builder; layout is template-owned, editors arrange sections inside bodies.
- No multi-language content variants as a first-class dimension (achievable via separate projects or folder conventions in v1).
- No plugin marketplace or third-party extension API.

### 2.3 Personas

- **Editor (Elena).** Writes and structures content. Lives in the page editor, media library and preview. Never sees a template.
- **Template developer (Dev).** Owns section/page templates, CDL declarations, channel templates and navigation definitions. Works in a code editor inside the app.
- **Project administrator (Paul).** Manages project members, output channels, generation targets, and triggers publishes.
- **Instance administrator (Ida).** Creates projects and global user accounts, manages system settings.

---

## 3. Glossary

| Term | Definition |
|---|---|
| **Project** | Top-level isolation unit. Owns assets, revisions, members, channels. |
| **Asset** | Anything managed by the CMS with an identity: page, media, section template, page template, structure, folder, page reference, global property set, dataset, record set, record. |
| **Asset type** | Discriminator: `PAGE`, `MEDIA`, `SECTION_TEMPLATE`, `PAGE_TEMPLATE`, `STRUCTURE`, `FOLDER`, `PAGE_REFERENCE`, `GLOBAL_SET`, `DATASET`, `RECORD_SET`, `RECORD`. |
| **Property set** | A `GLOBAL_SET` asset in the Globals store: a named group of site-wide values (site title, logo, social links) whose fields are declared in CDL and whose values editors fill in. Templates read it as `CMS_GLOBAL.<set>.<editor>`. |
| **Dataset** | A `DATASET` asset in the Templates store's fixed `datasets` folder: a CDL record schema (no bodies) for a list many pages show — team members, products, FAQs. Templates loop it as `$CMS_FOR(x : dataset:<uid>, where=…, sort=…, limit=…, offset=…, folder=…)$` (M19). It may carry one **record template** per channel (`channelTemplates.<channel>`, OCTL with the record's fields as top-level names) that renders one record wherever a record set of the dataset is rendered as a value (M25). |
| **Record set** | A `RECORD_SET` asset in a Content-store folder (M25): fixes the dataset of its records for its whole life and stores a query — `where` over bare field names (no render scope), `sort`, `limit`, `offset` — that selects and orders them. Editor content. Rendered as `$CMS_VALUE(recordset:<uid>)$` (each selected record through the dataset's record template), looped as `$CMS_FOR(x : recordset:<uid>, …)$` (loop arguments narrow the set's result), or picked by a `reference` editor with `assetTypes [RECORD_SET]`. |
| **Record** | A `RECORD` asset in the Content store: one entry of a dataset, holding editor values only and no page of its own. Its parent is always a record set of its dataset (M25; never a folder or the store root). Read as `record:<uid>.<editor>`, by following a `reference` editor (M19), or through its set. It is never named by hand: its UID is its UUID in UID form and never changes, its display name is the dataset's title editor value, else the UUID (records created before this keep theirs). |
| **UID** | Human-readable identifier, unique per (project, asset type), derived from the display name. |
| **Revision** | Monotonic `long` per project describing one atomic change set. |
| **Body** | Named content area on a page that holds an ordered list of section instances. |
| **Section instance** | Concrete usage of a section template inside a body, with its own content values. |
| **Editor** | A single declared input field inside a template's content definition. |
| **Content definition (CDL)** | Declarative description of the editors a template exposes. |
| **Output channel** | A named render target (`html`, `markdown`, …) with file extension, MIME type and settings. |
| **Channel template (OCTL)** | The output template for one (template asset, channel) pair. |
| **Structure** | Asset that declaratively defines how a navigation is computed and rendered. |
| **Generation** | Process turning content + templates into static files. |
| **Target** | Where generated files are written (filesystem, ZIP, S3). |
| **Draft / released version** | M27: an editorial asset's current version is its *draft*; per language, the version generation renders is its *released* version, set by a release (§5.5). Templates and other live types have no release state. |
| **Release status** | M27: `NEW`, `PUBLISHED`, `CHANGED`, `UNPUBLISHED` or `DELETION_PENDING` per (asset, language), computed by comparing draft and released version (§5.5). |
| **Scheduled action** | M27: a release, unpublish or one-off or recurring build that the scheduler executes at a time, as its owner (§18.7). |

---

## 4. System architecture

### 4.1 Component view

```
┌──────────────────────────────────────────────────────────────────┐
│ Browser                                                          │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Angular SPA  (staticforge-ui)                              │  │
│  │  Shell · Auth · Project workspace · Page editor            │  │
│  │  Media library · Template IDE (Monaco) · Preview frame     │  │
│  └────────────────────────────────────────────────────────────┘  │
└───────────────┬──────────────────────────────────────────────────┘
                │ HTTPS · REST/JSON · Bearer JWT
┌───────────────▼──────────────────────────────────────────────────┐
│ Spring Boot backend (staticforge-server)                         │
│                                                                  │
│  web        REST controllers, DTOs, validation, problem+json     │
│  security   JWT filter, project authorization voter              │
│  ─────────────────────────────────────────────────────────────   │
│  asset      Asset Management: identity, UID, folders, CRUD       │
│  content    Content values, bodies, section instances            │
│  revision   Revision counter, versioning, diff, restore          │
│  template   CDL parser/validator, template registry              │
│  render     OCTL lexer/parser/compiler, render context           │
│  generate   Build planner, dependency graph, writers, targets    │
│  media      Binary store, variants, metadata extraction          │
│  project    Projects, members, roles, channels                   │
│  ─────────────────────────────────────────────────────────────   │
│  persistence Hibernate/JPA repositories                          │
└───────┬──────────────────────────────────┬───────────────────────┘
        │ JDBC                             │ file/S3
┌───────▼─────────────────┐   ┌────────────▼────────────┐
│ PostgreSQL (external    │   │ Binary store            │
│ Docker container)       │   │ media + generated output│
│ schema via Liquibase    │   │                         │
└─────────────────────────┘   └─────────────────────────┘
```

### 4.2 Technology decisions

| Layer | Choice | Rationale |
|---|---|---|
| Backend runtime | Java 21, Spring Boot 3.3 | Virtual threads for generation fan-out, records, pattern matching |
| Web | Spring Web MVC (`spring-boot-starter-web`) | Simple request/response model as required; virtual threads remove reactive need |
| Security | Spring Security 6 + `spring-boot-starter-oauth2-resource-server` (JWT) | Standard, battle-tested JWT validation |
| Persistence | Spring Data JPA + Hibernate 6.5 | Required; Hibernate 6 handles JSON mapping portably |
| Schema | Liquibase 4.29 | Required; schema setup and evolution |
| Production DB | PostgreSQL 16 (external Docker) | Required |
| Test DB | H2 2.x in PostgreSQL compatibility mode | Required |
| Build | Gradle 8 (Kotlin DSL), multi-module | Fast incremental builds |
| Frontend | Angular 18+ standalone, signals | Required |
| Frontend build | Angular CLI + esbuild, Vitest, Playwright | Modern toolchain |
| Editor component | CodeMirror 6 (M33) | CDL/OCTL/expression/JSON highlighting, completion, diagnostics |
| Rich text | TipTap (ProseMirror) | Schema-constrained rich text, no `contenteditable` soup |
| API contract | OpenAPI 3.1 generated from controllers; TS client generated for Angular | Single source of truth |

### 4.3 Module layout (Gradle)

```
staticforge/
├── build.gradle.kts
├── settings.gradle.kts
├── server/
│   ├── sf-common/          value objects, errors, utilities
│   ├── sf-domain/          entities, repositories, domain services
│   ├── sf-template/        CDL + OCTL parsing and rendering
│   ├── sf-generate/        build planner, writers, targets
│   ├── sf-api/             REST controllers, DTOs, security
│   └── sf-app/             Spring Boot application, Liquibase, config
└── ui/                     Angular workspace (staticforge-ui)
```

---

## 5. Core domain model

### 5.1 Entity relationships

```
Project 1───* Revision
   │              │ produces
   │ 1            ▼
   *          AssetVersion *───1 Asset
Asset (identity)                  │
   ├─ type: PAGE | MEDIA | SECTION_TEMPLATE | PAGE_TEMPLATE | STRUCTURE | FOLDER
   │        | PAGE_REFERENCE | GLOBAL_SET | DATASET | RECORD_SET | RECORD
   ├─ uuid (immutable)
   └─ uid  (unique per project+type)

AssetVersion (state at a revision range)
   ├─ displayName, folder, payload (typed JSON)
   ├─ validFromRevision, validToRevision
   └─ deleted flag

Project 1───* OutputChannel
Project 1───* ProjectMember *───1 User
Project 1───* GenerationRun
```

Content store containment (M19, M25):

```
content_root ──* FOLDER ──* FOLDER …
     │              │
     └──────────────┴──* RECORD_SET ──* RECORD
                            │               │
                            │ datasetRef    │ datasetRef (= its set's)
                            ▼               ▼
                          DATASET (Templates store, fixed `datasets` folder: schema + record templates)
```

Folders hold folders and record sets; a record set holds only records; a record's parent is always a record set of the same dataset, and a set's dataset never changes. Every write path (create, move, restore, import) enforces this (`RecordSetContainment`, `422 SF-DOM-0104`); nothing migrates records that predate it. A set's and a record's `datasetRef` are mirrored into `asset_version.template_asset_id`, so every reader of that column filters on `asset_type`. A record's `folder_path` is its set's folder path.

### 5.2 Asset: identity vs. state

The model strictly separates **identity** from **state**:

- `asset` — one row per asset for its entire lifetime. Holds `uuid`, `project_id`, `type`, `uid`, `created_at`, `created_by`. **Never updated** except `uid` on an explicit rename operation (which itself is a revisioned change and recorded).
- `asset_version` — one row per asset per change. Holds everything mutable: display name, parent folder, payload, deleted flag, plus the revision interval in which the row is valid.

This makes *any* read reproducible: "give me asset X as of revision R" is a single indexed query, and full-project reads at revision R are equally cheap.

### 5.3 Payload strategy

Type-specific data lives in a JSON payload column rather than in six divergent table trees.

**Rationale:** content shapes are user-defined (CDL declares arbitrary editors), so a relational projection would require dynamic DDL. JSON keeps the schema stable while Liquibase stays deterministic.

**Portability:** the column is declared `jsonb` on PostgreSQL and `varchar(max)`/`clob` on H2. Hibernate 6 maps it with:

```java
@JdbcTypeCode(SqlTypes.JSON)
@Column(name = "payload", nullable = false)
private JsonNode payload;
```

Liquibase emits the dialect-appropriate type via `<modifyDataType>`-free, dbms-scoped column definitions (see §22.4).

**Indexed projections:** fields needed for queries and integrity (uid, display name, folder, template reference, path, MIME type, file size) are **also** stored as real columns on `asset_version` and kept in sync by the domain layer. JSON is never used as a query predicate in hot paths.

### 5.4 Reference integrity

Assets reference each other (page → page template, section instance → section template, content value → media). References are stored **by UUID**, never by UID, so renames never break content. UIDs are resolved to UUIDs at authoring time in the UI and at parse time in templates.

A `asset_reference` table materializes the outgoing edges of each asset version:

```
asset_reference(from_asset_id, valid_from_revision, valid_to_revision,
                to_asset_id, kind, source_path)
```

An edge row carries the same kind of interval as a version row (§7.4): it is open (`valid_to_revision IS NULL`) while the edge exists in the asset's current version, and "edges valid at revision R" are the rows with `valid_from_revision <= R AND (valid_to_revision IS NULL OR valid_to_revision > R)`.

| `kind` | From → to | `source_path` |
|---|---|---|
| `TEMPLATE` | page → page template; page → section template of a body section; record and record set → their dataset (M19, M25) | `templateRef`, `bodies.<name>[i].templateRef`; `datasetRef` |
| `MEDIA_REF` | page → media (`media` editor values, media links) | editor path, e.g. `content.heroImage`, `bodies.main[0].content.image` |
| `CONTENT_REF` | page → asset of a `reference` value or internal link; page → section template of a catalog card | editor path; `….templateRef` for a card |
| `OCTL_VALUE` | template (or a dataset, from its record templates, M25) → asset read by `$CMS_VALUE`, or by an asset accessor in `$CMS_IF`/`$CMS_SET`/`$CMS_FOR` (not `nav:`) | `channelTemplates.<channel>` |
| `OCTL_REF` | template → target of `$CMS_REF`, `$CMS_NAVIGATION(nav:…)`, `$CMS_FOR(x : nav:…)` | `channelTemplates.<channel>` |
| `OCTL_INCLUDE` | template → section template of `$CMS_INCLUDE` | `channelTemplates.<channel>` |
| `NAV` | page reference → its target page or pages folder | `target` |

Media and folder assets have no outgoing edges. A template reference used in several ways yields one edge per use.

**Written on save.** `ReferenceMaterializer` is called by every code path that writes an asset version (asset create/update/move/delete/restore, folder subtree moves, template writes and rename cascades, channel seeding, project import, project restore), in the same transaction and with the same revision as the version. It derives the edge set from the new payload (templates: by compiling every channel source against the project's reference resolver) and diffs it against the open rows: unchanged edges keep their open row, removed edges are closed at the new revision, new edges are inserted. A soft delete closes every outgoing edge. Within one compound revision a row that would be closed in the revision it was opened in is deleted instead, and an edge closed earlier in that revision is re-opened, so no zero-length intervals exist. Targets that do not resolve to an asset of the project are skipped. Generation does not write reference rows.

**Backfill.** Rows written before this model (by generation runs) were removed by Liquibase changeset `015-references-drop-generation-rows`. At startup `ReferenceBackfillRunner` rebuilds the table by replaying `ReferenceMaterializer` over every asset's versions in revision order whenever `asset_reference` is empty while `asset_version` has rows; disable it with `sf.references.backfill-on-startup=false`. Historical template versions are resolved against today's UIDs.

This table powers:
- **Usage view** ("where is this image used?") — the open incoming edges, current right after a save; `GET …/assets/{uuid}/usages?revision=R` returns the edges valid at R. Deletion without `force` is blocked (`SF-DOM-0120`) only by open incoming edges from another asset whose current version is not deleted.
- **Incremental generation** — the reverse edges valid at the snapshot revision define what to rebuild (§18.2); an edge that closed since the last successful run belongs to an asset that itself changed, so it needs no separate lookup. Render-time-only dependencies, such as a `$CMS_NAVIGATION` over a folder whose descendants changed, are not edges and are not covered.
- **Broken-link report** — dangling `to_asset_id` after a delete.

### 5.5 Release state (M27)

Editorial content has a **draft** — the asset's current version, what every save writes — and, per language, a **released version**: the version generation renders. Released types: `PAGE`, `RECORD`, `RECORD_SET`, `GLOBAL_SET`, `MEDIA`, `PAGE_REFERENCE`, and `FOLDER` in the editorial stores (pages, media, navigation, globals, content), except the fixed store roots (`ReleasableTypes`, the single place encoding this). Everything else is **live**: page and section templates, datasets (a schema), template-store folders, channels, targets, locales and project settings render at the build revision as they are, so a template change reaches released pages with the next build.

```
asset_release(id, project_id, asset_id, locale_key, released_version_id → asset_version,
              released_uid, valid_from_revision, valid_to_revision, released_by, released_at)
```

A **pointer** row is revisioned exactly like `asset_reference` (§5.4): a release, unpublish or locale change closes the open row and opens the next one in the same revision, and "the release state at revision R" is the rows valid at R. No open row for (asset, locale) means not released there. `released_uid` is the uid the version was released under, because a uid change writes no version (§6.4): a rename stays a draft until released.

**Locale keys.** A project without languages, and media that isn't localized (§11.6), use the one key `""` ("every language"). In a project with languages every other released asset has one pointer per language, so German can stay on the old text while English goes live — including structural changes (move, rename, sections): language L renders the **whole** version released for L, shared fields included. Adding a language opens no pointers (the language is `NEW` everywhere); removing one closes its pointers in the locale-change revision. A project's first languages turn each `""` pointer into one per language, and removing the last ones keeps the default language's pointer as `""`, so enabling or disabling languages never unpublishes the site.

**Status** (`ReleaseStatus`, per asset and locale key, computed, never stored): `NEW` (never released), `PUBLISHED` (released, and the draft looks the same in that language), `CHANGED`, `UNPUBLISHED` (was released, isn't now; the draft exists), `DELETION_PENDING` (draft deleted, released version still live). "Looks the same in L" compares the **locale projections** (`LocaleProjection`) of draft and released version: uid, display name, folder path and parent, template, deleted flag, and the payload with every L10N value resolved along L's fallback chain (plain values as they are); for localized media the file L renders and its owner language instead of the file fields. Editing only the English value of a field leaves German `PUBLISHED`; a shared-field or structural edit changes every language. A deleted draft that is released nowhere has no status: it is gone. Every releasable asset DTO carries `release: {localeKey → {status, releasedRevision, releasedAt, releasedBy}}` (`null` for other assets and for past versions) and `scheduled: [{actionId, type, locale, runAt, nextRunAt, ownerUserId}]` — the pending schedules touching it (§18.7).

**Migration.** Changeset `v1.0/020-release-state.xml` adds the table and `project.release_state_initialized`; on start `ReleaseStateInitializer` releases every non-deleted editorial asset of each unflagged project at its current version, for every key it has, in one `RELEASE` revision without author ("Initial release state (M27)", one `PROJECT/INITIAL_RELEASE` summary entry). A full build right after is byte-identical to the build before. New projects start initialized.

**System migrations carry releases forward.** When a system migration rewrites an asset (the M24 localizable toggle and locale changes, CDL `renamedFrom` record migrations, record-set query migrations, localizing media), a pointer at the rewritten version — or one that projected equal to it — moves to the new version in the same revision (`ReleaseCarryForward`); a `CHANGED` language keeps its released version in the old shape, and every reader tolerates both shapes (a plain value where L10N is expected reads as every language, an L10N value where plain is expected resolves the render language).

**Rule gate (M33).** A release runs the `release` scope of the editor rules (§10.5, §14.8) for each asset version it releases and each released language (`ReleaseRuleCheck`, replacing M27's `ReleaseCompleteness`), against the current definition — the one a build validates with. First the `release` fills: when a fill changes a value of a **draft** being released, the release stores a new draft version with the filled values (optimistically locked like a save) and releases that version, all in the release's single revision, so draft and released version stay equal. A pinned older version (scheduled release) is released as it is — its fills are not applied. Then the `release` rules and built-ins, reading the released state: property sets (`global:`) and referenced assets (`ref`) as released, where assets released by the same request count as released. `error` findings refuse the request with `422 SF-DOM-0150`; `warning` findings refuse it with `422 SF-DOM-0156` unless the request carries `acceptWarnings: true` — both with `assets[{uuid, locale, issues}]`; `info` never blocks. A built-in finding concerns every released language of the asset (as in M27), a custom rule's finding only its own language. The plan (`POST …/releases/plan`) lists `incomplete` (errors), `warningFindings`, `infoFindings` (same shape) and `fills [{uuid, locale, path, value}]` (the values the release would write); its `warnings` string list keeps the pinned-version notes. The release result carries `warnings` — the rule warnings that were accepted. Scheduled releases always accept warnings and record them on each item's result (`warnings[{path, code, rule, message, locale}]`); errors skip items as before. Unpublish and discard run no rules.

---

## 6. Identity: UUID, display name, UID

### 6.1 UUID

- Type: `uuid` (Postgres), `java.util.UUID`.
- Generated **at creation** by the application using UUIDv7 (time-ordered) for index locality.
- **Immutable.** No API path exposes a UUID change. Import/copy operations create new UUIDs and record provenance in `payload.origin`.

### 6.2 Display name

- Free text, 1–200 chars, must not be blank, trimmed on input.
- Not unique. Two pages may both be called "Contact".
- Mutable; changing it does **not** change the UID (see §6.4).

### 6.3 UID derivation

The UID is generated from the display name when the asset is created.

**Algorithm `deriveUid(displayName, projectId, assetType)`**

1. **Normalize** — Unicode NFKD, strip combining marks (`Ä`→`A`), transliterate common ligatures (`ß`→`ss`, `æ`→`ae`).
2. **Lowercase.**
3. **Replace** every run of characters outside `[a-z0-9]` with a single `_`.
4. **Trim** leading/trailing `_`.
5. **Truncate** to 96 characters, cutting at the last `_` if that loses ≤ 12 chars.
6. **Fallback** — if the result is empty, use the asset type in lowercase (`page`, `media`, …).
7. **Reserved words** — if the result is in the reserved set (`new`, `edit`, `api`, `preview`, `_generated`), append `_1`. `index` is not reserved (it was until M31): it is the channels' default `indexUid` (§15.2), so a page must be able to take it.
8. **Uniqueness** — if `base` is free within `(project, assetType)`, use it. Otherwise probe `base_1`, `base_2`, … and take the first free value. The probe is bounded at 10,000; beyond that a random 6-char suffix is appended.

**Examples**

| Display name | Asset type | Existing UIDs | Result |
|---|---|---|---|
| `Über uns` | PAGE | — | `uber_uns` |
| `Über uns` | PAGE | `uber_uns` | `uber_uns_1` |
| `Über uns` | PAGE | `uber_uns`, `uber_uns_1` | `uber_uns_2` |
| `Über uns` | MEDIA | `uber_uns` (PAGE) | `uber_uns` — different type, no clash |
| `Hero – 2 Spalten!` | SECTION_TEMPLATE | — | `hero_2_spalten` |
| `!!!` | PAGE | — | `page` |

### 6.4 UID stability & rename

- The UID is **not** recomputed when the display name changes. Renaming "Über uns" to "About us" keeps `uber_uns`.
- An explicit **Change UID** action exists (`PATCH /assets/{uuid}/uid`), gated on `PROJECT_ADMIN` or `DEVELOPER`. It:
  1. Validates the new UID against the same charset rules and uniqueness constraint.
  2. Creates a new revision.
  3. Writes an `asset_uid_history` row (`asset_id, old_uid, new_uid, revision`).
  4. Emits a warning listing OCTL templates that reference the old UID literally (they are the only place a UID is not a UUID), so the developer can fix them.

### 6.5 Uniqueness constraint

```sql
ALTER TABLE asset ADD CONSTRAINT uq_asset_project_type_uid
  UNIQUE (project_id, asset_type, uid);
```

UID allocation happens inside the same transaction as the insert; on constraint violation the service retries the probe (bounded, 5 attempts) to survive concurrent creation of identically named assets.

---

## 7. Revision safety

### 7.1 Concept

Every project owns a **revision counter** (`long`, starts at `1`). A revision is the unit of atomic, attributable change: one API mutation → one revision, one transaction. The transaction covers everything the revision writes, including the `asset_reference` rows derived from the new versions (§5.4), so reference edges can never disagree with the payloads valid at the same revision.

Revision `1` is created together with the project and contains the initial (empty or seeded) state.

### 7.2 Revision record

```
revision
  project_id      bigint    FK project
  revision_id     bigint    project-scoped, starts at 1
  created_at      timestamptz
  created_by      bigint    FK app_user
  change_type     varchar   CREATE | UPDATE | DELETE | RESTORE | MOVE | RENAME | UID_CHANGE | BULK | IMPORT
                            | RELEASE | UNPUBLISH | DISCARD   -- M27
  comment         varchar(500) nullable
  summary         json      denormalized list of touched assets
  compacted       boolean   NOT NULL DEFAULT false -- its exact changes were absorbed by compaction (§7.7, M29)
  PRIMARY KEY (project_id, revision_id)
```

`summary` example:

```json
{
  "assets": [
    {"uuid":"018f…","type":"PAGE","uid":"home","action":"UPDATE","fields":["content.body.main"]},
    {"uuid":"018f…","type":"MEDIA","uid":"hero_jpg","action":"CREATE"}
  ]
}
```

**Release revisions (M27).** One release, unpublish or discard action is one revision with change type `RELEASE`, `UNPUBLISH` or `DISCARD`; its summary lists every (asset, locale, released version) with `locale` and `releasedVersion` on the entry (a released deletion is an `UNPUBLISH` entry inside a `RELEASE` revision). There are no separate audit entries: revisions are the content audit trail. The never-written `PUBLISH` constant was removed.

### 7.3 Counter allocation

The counter must be gapless and contention-safe.

```sql
CREATE TABLE project_revision_counter (
  project_id     bigint PRIMARY KEY REFERENCES project(id),
  next_revision  bigint NOT NULL
);
```

Allocation inside the mutating transaction:

```sql
UPDATE project_revision_counter
   SET next_revision = next_revision + 1
 WHERE project_id = :p
RETURNING next_revision - 1;
```

The row lock serializes writers **per project**; projects never block each other. Because the increment shares the transaction, a rollback yields no gap. Throughput per project is bounded by transaction duration (target < 50 ms for content saves), which is acceptable for editorial workloads.

> **H2 note:** `UPDATE … RETURNING` is not supported. The repository uses a `SELECT … FOR UPDATE` + `UPDATE` pair behind a `RevisionCounterRepository` interface; the PostgreSQL implementation uses the single-statement form. Both are covered by the same contract test.

### 7.4 Version intervals

```
asset_version
  id                    bigserial PK
  asset_id              bigint FK asset
  valid_from_revision   bigint NOT NULL     -- inclusive
  valid_to_revision     bigint NULL         -- exclusive; NULL = current
  deleted               boolean NOT NULL
  original_valid_from   bigint NULL         -- set by compaction when it moves valid_from_revision back (§7.7, M29)
  …state columns + payload…
```

Reading the state of a project at revision `R`:

```sql
SELECT av.*
  FROM asset_version av
  JOIN asset a ON a.id = av.asset_id
 WHERE a.project_id = :p
   AND av.valid_from_revision <= :R
   AND (av.valid_to_revision IS NULL OR av.valid_to_revision > :R)
   AND av.deleted = false;
```

Index: `idx_asset_version_lookup (asset_id, valid_from_revision DESC, valid_to_revision)`.

Writing a change at revision `R`:

1. `UPDATE asset_version SET valid_to_revision = :R WHERE asset_id = :a AND valid_to_revision IS NULL`
2. `INSERT INTO asset_version (…, valid_from_revision = :R, valid_to_revision = NULL, …)`

Deletion is a version row with `deleted = true` — nothing is physically removed, so restore is a normal write. The only code path that ever removes versions or moves `valid_from_revision` is revision compaction (§7.7), which a project must opt in to.

### 7.5 Optimistic concurrency

Every asset read returns `baseRevision` (the `valid_from_revision` of the row served). Writes must send it back:

```http
PUT /api/v1/projects/{p}/pages/{uuid}
If-Match: "rev-1841"
```

If the asset's current version has a different `valid_from_revision`, the server answers `409 Conflict` with a problem document containing both versions' payloads so the UI can offer a merge/diff dialog. The UI never silently overwrites.

### 7.6 Diff and restore

- `GET /projects/{p}/revisions/{r}/diff` — structural diff of the touched assets against `r-1`. Diff is computed on the canonical JSON payload with a field-path walker; rich text fields diff at block level.
- `POST /projects/{p}/assets/{uuid}/restore?fromRevision=R` — writes the payload of revision `R` as a **new** revision. History is append-only; restoring never rewrites the past.
- `POST /projects/{p}/restore?toRevision=R` — project-wide rollback, implemented as a bulk restore in one new revision. Requires `PROJECT_ADMIN`, requires an explicit typed confirmation in the UI.
- **Release state (M27).** A restore — of one asset or of the project — writes drafts only; the release state is unchanged, and the Changes view shows what the restore made different from what is released. Time travel and a build at revision R use the release state valid at R, so republishing an old revision reproduces what was online then.

### 7.7 Retention

Full history is retained by default. A project may opt in to **revision compaction** (M29): old versions collapse to the last version of each day, and nothing a release, a retained build or a pending schedule depends on is ever removed. Compaction deletes versions for good; it is the only exception to "nothing is physically removed" (§7.4).

**Policy.** `project.compaction_policy` json `{enabled, olderThanDays, enabledAt, enabledBy}`; `null` means off, and every project starts off (an imported one too: the policy is an operational setting of the instance and not part of project exports).

- `GET`/`PUT /projects/{key}/compaction` (`PROJECT_ADMIN`). `olderThanDays` is at least 30 (`422 SF-DOM-0183`); omitted, it keeps the current value (90 for a project that never set one).
- Enabling, or lowering `olderThanDays` while enabled, requires `?confirm=<projectKey>` (`422 SF-DOM-0182`); disabling or raising needs no confirmation. The UI asks for the typed project key and shows the estimate first.
- A change is audited `COMPACTION_POLICY_SET` (before/after) and records no revision: it doesn't change any output. An unchanged policy records nothing. Archived projects refuse it (`409 SF-DOM-0141`).
- `GET /projects/{key}/compaction/estimate?olderThanDays=N` is a dry run of the compaction with the cutoff "now − N days": versions in the window, versions that would be removed, assets touched, references rewritten, revisions marked and payload bytes freed. It changes nothing and is allowed on archived projects.

**Execution.** The `revision-compaction` system job (weekly, Sunday 03:00 UTC by default, §26.6) compacts every non-archived project with an enabled policy, with the cutoff "now − `olderThanDays`", and audits `REVISIONS_COMPACTED` (counts in the detail, actor: system) for each project that lost versions. It supports a dry run and writes no revision. It works in short batches of assets (`batchAssets`, default 200); each batch holds the project's `project_revision_counter` row lock (§7.3), so no revision is allocated while an asset is rewritten and saves wait milliseconds, not minutes.

**What compaction may remove.** A version is *in the window* when it is **closed** (`valid_to_revision` set) and the `created_at` of its `valid_from_revision` is older than the cutoff. Its *day* is the **UTC** date of that `created_at` (UTC is fixed: there is no project time zone, and schedules follow the viewer's zone). These versions are **protected** and never removed:

- (a) every version referenced by any `asset_release` row (§5.5), open or closed, in any locale, so "what was live on date X" stays exact;
- (b) every version valid at the revision or the consistent revision of a build still on disk in any target (§18.4), and at the revision of a `QUEUED`/`RUNNING` run, so rollback builds and incremental baselines stay exact;
- (c) every version pinned by a `PENDING`/`RUNNING` scheduled action (§18.7);
- (d) the last version of each asset's day.

An unprotected version in the window is removed, and its interval is **absorbed by the next surviving version of the same day**, whose `valid_from_revision` moves back (its original value is kept in `asset_version.original_valid_from`). A version is removed only when that survivor is itself in the window: the open version, and versions newer than the cutoff, are never moved, so their predecessors stay until a later save closes them. Tombstones (`deleted = true`) take part like any version. The job re-examines the whole window on every run, because protection can end (a pruned build, a finished schedule); running it twice with the same cutoff removes nothing new.

**Guarantees.**

- Exactly one version is valid per (asset, revision) for every revision, before and after compaction.
- Reads outside absorbed intervals, and reads of protected versions, are byte-identical to before. A read at a revision inside an absorbed interval returns the state at the end of that group; for a whole day, the project snapshot equals the exact snapshot at the day's last revision (or at the next protected point). A build at a released or retained-build revision produces the same output as before.
- `asset_reference` rows are rewritten with the versions: the edges valid at any revision R equal the edges materialized from the version valid at R (§5.4).
- Revision rows, summaries, authors and comments stay. `revision.compacted = true` marks each revision whose own changes were absorbed; `project.compacted_through` records the newest revision before the cutoff that compaction has processed.
- Media bytes referenced only by removed versions are collected by the next `blob-sweep` (§11.2) after its grace period.

**Reads of compacted history.**

- Revision views (list, detail, spine) carry `compacted`; the project view carries `compactedThrough`.
- A point-in-time read of an asset at R (`GET /assets/{uuid}/versions/{r}`) carries `compacted: true` when R lies in an interval the served version absorbed (R < its `original_valid_from`): the state shown is later than the exact state at R. The typed time-travel reads (`?revision=` on media, property sets, datasets, records, record sets and the record-set grid), the draft preview at a revision (checked for the page itself; a published preview renders released versions, which compaction never removes) and `POST /projects/{key}/restore` say the same with the response header `X-SF-Compacted: true`. The check short-circuits when `compacted_through` is null or older than R, so projects without compaction pay nothing.
- The diff of a compacted revision (§7.6) lists the summary's assets; an asset whose version at R absorbed R, or whose version at R − 1 absorbed R − 1, comes with `compacted: true`, its summary `action` and no field changes, and the diff carries `compacted: true` and the message "Exact changes of this revision were compacted; the state at the end of the day is kept". Assets whose versions survived diff normally.
- A restore from a compacted revision restores the surviving version (`compacted: true` on the asset response, the header on a project restore), i.e. the end-of-day state.

---

## 8. Projects, users, permissions

### 8.1 Project

```
project
  id            bigserial PK
  key           varchar(40)  UNIQUE     -- url-safe, immutable, e.g. "acme_site"
  name          varchar(200)
  description   text
  default_channel_id bigint FK output_channel
  created_at, created_by, archived
  publish_policy json                   -- {"editor": [...]}, what editors may publish (M28, §8.3)
  compaction_policy json                -- {enabled, olderThanDays, enabledAt, enabledBy}; null = off (M29, §7.7)
  compacted_through bigint              -- newest revision compaction has processed (M29, §7.7)
```

Projects are hard isolation boundaries. Every asset query is filtered by `project_id` at the repository level via a mandatory parameter — there is no repository method that can read across projects except instance-admin reports.

**Archived projects (M26).** `POST /projects/{key}/archive` (instance admin) makes a project read-only and hides it from its members; `POST /projects/{key}/unarchive` reverses it. Both record a revision, audit `PROJECT_ARCHIVED` / `PROJECT_UNARCHIVED` and bump the token epoch of every member (§9.2), so the change applies on each member's next request. While a project is archived:

- **Members** get `404` for every endpoint of the project, as for a non-member (it is left out of the token's `projects` claim); it is missing from their `GET /projects` and from the memberships of `/auth/me`. Their memberships stay and come back with unarchive.
- **Instance admins** see it (`archived: true`) and can read everything, but every write answers `409 SF-DOM-0141` "Project is archived" — theirs too. The guard is central (every revision allocation) plus explicit checks on the writes that allocate no revision (generation start and promote, share-link creation, search reindex, URL-registry overrides, generation targets). The API admits only: unarchive, archive (a no-op), requests that change nothing (`/generations/plan`, `/cdl/validate`, `/octl/validate`, text-media validation, section preview, record-set `preview-query`, `export/selection`, `import/analyze`, `releases/plan` and `schedules/preview-times`, M27; `publish-policy/impact`, M28; `compaction/estimate`, M29) and cancelling a run started before archiving, which may also finish. Schedules of an archived project don't execute (§18.7).
- Share links issued earlier answer `404`; the search index is closed and catches up on unarchive; published output is left as it is.
- Deleting an account (§8.2) still removes its memberships of archived projects.

### 8.2 Users

```
app_user
  id            bigserial PK
  username      varchar(100) UNIQUE
  email         varchar(255) UNIQUE
  display_name  varchar(200)
  password_hash varchar(255)          -- BCrypt cost 12 (Argon2id configurable)
  status        ACTIVE | LOCKED | DISABLED | DELETED
  system_role   USER | INSTANCE_ADMIN
  must_change_password boolean        -- M26: a temporary password is pending
  token_epoch   bigint                -- bumped to revoke every access token at once (§9.2)
  failed_logins, locked_until, last_login_at, created_at
```

Usernames consist of letters, digits and `. _ @ + -` (at most 100 characters) and are unique ignoring case; emails are unique ignoring case. Usernames starting with `deleted-user-` and addresses at `@invalid` are reserved for deleted accounts.

**Statuses.**

- `LOCKED` — set automatically after 15 failed sign-ins in a row, for 30 minutes; a successful sign-in afterwards, or an admin's *unlock*, returns the account to `ACTIVE`. (Per IP and username, sign-ins are also rate limited, §26.3.)
- `DISABLED` — set by an instance admin: sign-in is refused and every session is revoked at once; memberships stay, so *enable* restores access.
- `DELETED` — *delete* anonymizes the account, irreversibly: username `deleted-user-<id>`, email `deleted-<id>@invalid`, display name `Deleted user`, no password, system role `USER`, no lockout state, no pending password change; every membership is removed (one revision per project, archived projects included) and every session revoked. The row stays, because revisions, audit entries and grants reference it; audit entries about the account lose its name (their target becomes `user:deleted-user-<id>`). Deleted accounts are hidden from user lists unless asked for, and no action applies to them. The API requires `?confirm=<current username>`.

**Forced password change.** While `must_change_password` is set, every authenticated call answers **`428 SF-API-0428`** "Password change required", except exactly `GET /auth/me`, `POST /auth/password`, `POST /auth/logout`, `POST /auth/refresh` and `GET /auth/password-policy`. The flag is read from the account on every request, not from the token, and a successful password change clears it. An instance admin sets it by default when creating an account or resetting its password.

**Password policy.** `sf.security.password.min-length` (default `12` characters, counted as code points) and `sf.security.password.require-mixed` (default `false`; when `true`, at least one letter and at least one digit or symbol). A password is always at most **72 UTF-8 bytes** (BCrypt's input limit) and is rejected, not truncated, past it. A violation is `400 SF-API-0400` with one message per broken rule under `errors`. The policy applies to the own password change and to an admin's create and reset — never to sign-in, so existing passwords keep working. `GET /auth/password-policy` (public) serves `{minLength, requireMixed, maxBytes}`. Generated passwords are 16 characters from a secure random source and always satisfy the policy.

**Seeded administrator.** A fresh installation gets `Admin` / `Admin` (instance admin) — but only while `app_user` is **empty**: after a rename, or once another admin exists and this one is deleted, nothing is seeded again. Outside the `dev`, `demo` and `test` profiles the seeded account must change its password before it can do anything else.

**Guard rails.** The last `ACTIVE` instance admin can't be disabled, deleted or demoted (`409 SF-DOM-0131`), and an admin can't disable, delete or demote themselves (`409 SF-DOM-0132`). There is no "last project admin" rule.

### 8.3 Project membership & roles

```
project_member
  project_id  FK project
  user_id     FK app_user
  role        varchar(30)
  granted_at, granted_by
  PRIMARY KEY (project_id, user_id)
```

A user may hold exactly one role per project.

| Role | Read content | Edit content | Edit templates & channels | Generate/publish | Manage members |
|---|---|---|---|---|---|
| `VIEWER` | ✅ | — | — | — | — |
| `EDITOR` | ✅ | ✅ | — | preview; release and builds per the project's publish policy (M28) | — |
| `DEVELOPER` | ✅ | ✅ | ✅ | ✅ | — |
| `PROJECT_ADMIN` | ✅ | ✅ | ✅ | ✅ | ✅ |

`INSTANCE_ADMIN` (system role) may create/archive projects, manage users, and holds implicit `PROJECT_ADMIN` everywhere. Instance admin actions on project content are recorded with an `onBehalf` marker in the revision summary.

**Who manages what (M26).** Only instance admins create, edit, disable and delete accounts and change system roles (`/api/v1/admin/users`). A `PROJECT_ADMIN` adds **existing** accounts to their project — found through `GET /users/lookup`, which never returns emails — changes roles and removes members; a disabled or deleted account can't be added (`409`). Instance admins reach every project without a membership and are not listed as members. The members list shows emails to project admins and instance admins only; everyone else gets them as `null`.

**No per-asset rights in v1.** Authorization is `(user, project) → role`, evaluated once per request and cached in the security context; publishing operations add the project's publish policy (below, §8.4).

**Publish policy (M28).** A project admin decides per project what editors may do to put content online. Four permissions, all **off** by default — new projects and every project that existed before M28 start with none:

| Permission | Opens to editors | Requires |
|---|---|---|
| `RELEASE` | Release, discard and unpublish content (§5.5, §10.4) — in the release bar and as a batch in the Changes view | — |
| `SCHEDULE_RELEASE` | One-off scheduled `RELEASE`/`UNPUBLISH` actions (§18.7), and editing, running now, re-pinning and cancelling their own; a "then generate" step also needs the build permission that run needs | `RELEASE` |
| `INCREMENTAL_BUILD` | Incremental runs to the project's default target, whole or limited to a folder or pages; cancelling runs they started (§18.1) | — |
| `FULL_BUILD` | Full runs and runs to any target | `INCREMENTAL_BUILD` |

The toggles apply to `EDITOR` only: `VIEWER` never holds a publish permission; `DEVELOPER`, `PROJECT_ADMIN` and instance admins always hold all four, whatever the policy says. Whatever the policy, these stay with developers: generating at a pinned past revision, promote/rollback, generation schedules (`GENERATION`, `RECURRING_GENERATION`), changing or cancelling someone else's schedule, and target configuration (create `DEVELOPER`, update and delete `PROJECT_ADMIN`). There is no approval workflow and no extra role.

The policy is stored as `project.publish_policy` (JSON `{"editor": ["RELEASE", …]}`, changelog `v1.0/025-publish-policy.xml`) and changed through `PUT /projects/{key}/publish-policy` (§20.2). A policy that breaks an implication is `400 SF-API-0400` with one message per broken rule under `errors`. The column is overwritten in place, like the locale configuration; each change allocates an `UPDATE` revision (summary entry `PROJECT`, field `publishPolicy`) for attribution and is audited as `PUBLISH_POLICY_SET` (§26.3). Time travel doesn't show a historical policy, and enforcement always uses the current one. The archived guard applies (`409 SF-DOM-0141`).

### 8.4 Authorization implementation

```java
@PreAuthorize("@projectAuth.has(#projectKey, 'DEVELOPER')")
@PutMapping("/projects/{projectKey}/section-templates/{uuid}")
public TemplateDto update(...) { … }
```

`ProjectAuthorizationService.has(projectKey, minimumRole)` reads the role from the access token's `projects` claim (§9.2; an instance admin passes everywhere), compares against the role ordinal, and answers `403` with a problem document when the role is too low. A missing membership yields `404` rather than `403`, so project existence is not leaked. Archived projects are left out of the claim, so their members get `404` (§8.1); instance admins pass and then meet the read-only guard (`409 SF-DOM-0141`).

**Publish permissions (M28).** Publishing operations are checked with `ProjectAuthorizationService.can(projectKey, requirement)`:

```java
@PreAuthorize("@projectAuth.can(#projectKey, 'RELEASE')")          // a publish permission
@PreAuthorize("@projectAuth.can(#projectKey, 'ROLE:DEVELOPER')")   // a role no policy opens
```

The role still comes from the token; the project's policy is read from the database on **every** check — no cache, and it is not part of any claim — so a policy change applies on every editor's **next request** without a token refresh or an epoch bump. Non-members get `404` as with `has`. A denial is `403 SF-API-0403` whose problem carries the extension `permission`: the missing permission name, or `ROLE:<role>` (Appendix B). The publishing controllers use `can` for their role-only guards too (`ROLE:EDITOR`, `ROLE:DEVELOPER`, `ROLE:PROJECT_ADMIN`), so every denial on them names what is missing; other endpoints keep `has`. A test scans every `@projectAuth.can(…)` literal and fails on an unknown name.

One rule, three callers. `PublishRequirements` (a minimum role plus publish permissions) is the single requirement type for endpoints, generation requests (`GenerationAuthorization`, §18.1) and scheduled actions (`ScheduledActionHandler.requirements`, §18.7); `PublishPolicy.grants(role, permission)` is the single rule (`VIEWER` nothing, `EDITOR` what the policy lists, `DEVELOPER`/`PROJECT_ADMIN` everything). Requests whose requirement depends on the body call `satisfies(projectKey, requirements)`. Where there is no token — the scheduler, when a schedule is saved or changed and before every execution, and the release service for whoever acts (`PolicyReleasePermissionCheck`) — `PublishPermissionEvaluator` (sf-domain) evaluates the same requirements for a stored user: the role from the **membership row**, the current policy, and the account — a `DISABLED` or `DELETED` account holds nothing, a `LOCKED` one (temporary sign-in lockout) keeps its permissions (M27.4.1), an instance admin holds everything. `ProjectDetail.permissions` lists the caller's effective permissions; clients show publishing controls from it and never derive them from the role.

---

## 9. Authentication with JWT

### 9.1 Token model

| Token | Lifetime | Storage (browser) | Contents |
|---|---|---|---|
| Access token | 15 min | in-memory only (Angular signal) | `sub`, `uid`, `name`, `sysRole`, `projects: {key: role}`, `epoch`, `jti`, `iat`, `exp` |
| Refresh token | 8 h sliding, 30 d absolute | `HttpOnly; Secure; SameSite=Strict` cookie, path `/api/v1/auth` | opaque, server-side row |

**Rationale:** the access token never touches `localStorage` (XSS exfiltration), and the refresh cookie is unreachable to JS. A CSRF token is not needed for the Bearer-authenticated API; the refresh endpoint is protected by `SameSite=Strict` plus an `X-Requested-With` header check.

### 9.2 Access token claims

```json
{
  "iss": "https://cms.example.com",
  "sub": "018f6a2e-…",
  "preferred_username": "elena",
  "name": "Elena Farkas",
  "sysRole": "USER",
  "projects": { "acme_site": "EDITOR", "acme_docs": "DEVELOPER" },
  "epoch": 3,
  "jti": "018f6a3d-…",
  "iat": 1755561600,
  "exp": 1755562500
}
```

Embedding project roles keeps authorization at O(1). Archived projects are left out of `projects` (§8.1).

**Immediate revocation (M26).** The token carries the account's `epoch` (`app_user.token_epoch`). The authentication converter loads the account on every request — it also refuses a disabled or deleted one (a lock only blocks sign-in) — and rejects a token whose `epoch` differs with `401`; the client then refreshes and gets the current roles. The epoch is bumped, revoking every access token of the account, on: a member role set or removed, a system role change, disable, delete, an admin password reset, admin "revoke sessions", "sign out everywhere", the own password change, and archive/unarchive (for every member of the project). A rename, a profile edit, enable and unlock don't bump it. A plain epoch bump leaves the refresh cookie valid; disable, delete, password reset and change, system role change and both "revoke sessions" actions also drop every refresh-token family, which ends the session. Login, refresh and the password policy ignore a `Bearer` header, so a revoked access token a client sends along can't block the refresh that replaces it.

### 9.3 Signing

- Algorithm **RS256**, 2048-bit key pair.
- Keys held in a Java keystore or mounted PEM; `kid` in the header; JWKS exposed at `/.well-known/jwks.json` for future service-to-service use.
- Key rotation: two active keys (current + previous) so rotation does not invalidate live tokens.
- HS256 is supported for single-node dev profiles only (`sf.security.jwt.algorithm=HS256`), never in `prod`.

### 9.4 Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/auth/login` | username+password → access token + refresh cookie |
| `POST` | `/api/v1/auth/refresh` | refresh cookie → new access token (rotates refresh) |
| `POST` | `/api/v1/auth/logout` | revokes refresh token family |
| `GET` | `/api/v1/auth/me` | current principal from the account row: `id, username, displayName, email, systemRole, mustChangePassword, projectRoles, memberships[{projectKey, projectName, role}]` (archived projects only for instance admins) |
| `PATCH` | `/api/v1/auth/me` | own profile `{displayName?, username?, email?, currentPassword?}` — username and email need the current password (`400` with `field: currentPassword` otherwise), duplicates are `409` with `field`; sessions stay valid (M26) |
| `POST` | `/api/v1/auth/password` | change own password `{currentPassword, newPassword}`: password policy (§8.2), clears `mustChangePassword`, revokes every session including this one — the client signs in again |
| `POST` | `/api/v1/auth/sessions/revoke` | sign out everywhere, this session included; clears the refresh cookie (M26) |
| `GET` | `/api/v1/auth/password-policy` | public: `{minLength, requireMixed, maxBytes}` (M26) |

Refresh tokens are **rotated** on each use and stored as a family. Reuse of a consumed refresh token invalidates the entire family and forces re-login (detects theft).

### 9.5 Spring Security configuration sketch

```java
@Bean
SecurityFilterChain api(HttpSecurity http, JwtDecoder decoder) throws Exception {
  return http
    .securityMatcher("/api/**")
    .csrf(CsrfConfigurer::disable)
    .sessionManagement(s -> s.sessionCreationPolicy(STATELESS))
    .authorizeHttpRequests(a -> a
        .requestMatchers("/api/v1/auth/login", "/api/v1/auth/refresh").permitAll()
        .requestMatchers("/api/v1/admin/**").hasAuthority("SYS_INSTANCE_ADMIN")
        .anyRequest().authenticated())
    .oauth2ResourceServer(o -> o.jwt(j -> j
        .decoder(decoder)
        .jwtAuthenticationConverter(new SfJwtAuthenticationConverter())))
    .exceptionHandling(e -> e
        .authenticationEntryPoint(problemEntryPoint())
        .accessDeniedHandler(problemDeniedHandler()))
    .build();
}
```

Rate limiting on `/auth/login`: 10 attempts / 5 min / (IP + username), then exponential backoff; account lock after 15 failures until admin unlock or 30 min.
---

## 10. Asset type: Page

### 10.1 Definition

A page is a content asset that will be rendered into one output file per enabled channel. It binds a **page template**, fills the template's **own editors**, and fills its **bodies** with ordered section instances.

### 10.2 Folder structure

Pages live in a folder tree. Folders are themselves assets (`type = FOLDER`) so they are revisioned, renameable and referenceable by navigation.

- Each project has a hidden shared root folder (`uid = root`, `path = /`) above every store; it is never shown and holds no pages. Pages live below the protected store root **`pages_root`** (`path = /pages_root/`, `FolderScope.PAGES_ROOT_UID`), shown as **All pages**. `pages_root` is the **site root**: output paths and URLs strip its segment (`/pages_root/products/` → `products/`), so no generated path or link contains `pages_root/`. It can't be renamed, moved or deleted, and — like every fixed store root — it isn't releasable (§5.5): its payload is live.
- A folder's `path` is materialized (`/pages_root/products/tools/`) and denormalized onto every descendant version row for fast subtree queries and prefix indexing.
- Moving a folder rewrites the `path` of the subtree in a single revision; the number of touched assets is reported to the user before confirmation when it exceeds 100.
- Depth limit 12, 1,000 children per folder (soft warnings in UI at 80%).

**Folder path ≠ output path.** The output path is derived by the page's `outputPath` rule (§18.3): default `{folderPath}{uid}.{channelExtension}`, overridable per page (`payload.output.pathOverride`) and per channel.

**The folder's index page.** A pages folder's index page is its page whose UID is the channel's `indexUid` (§15.2, default `index`); a folder without one has none. Output paths (§18.3), folder links (§16.4), preview links (§19.2), navigation (§17.2) and the URL registry follow the same rule (`NavigationService.indexPage`). Because UIDs are unique per project and type, a channel's `indexUid` matches at most one page per project — typically a page named "Index" in **All pages**, which then renders as the site's `index.html`. Pages folders have no start page setting (a navigation folder's *Entry page*, `startNode`, §17, only chooses what a navigation entry points at).

### 10.3 Page payload

```json
{
  "templateRef": "018f-…-page-template-uuid",
  "content": {
    "title": "Autumn collection",
    "teaser": "Warm things for cold days.",
    "heroImage": { "type": "MEDIA_REF", "uuid": "018f-…" }
  },
  "bodies": {
    "main": [
      { "instanceId": "b1f2…", "templateRef": "018f-…", "content": { … } },
      { "instanceId": "c3d4…", "templateRef": "018f-…", "content": { … } }
    ],
    "sidebar": []
  },
  "nav": { "visible": true, "position": 30, "label": "Autumn", "noIndex": false },
  "output": { "pathOverride": null, "channels": ["html", "markdown"] },
  "meta": { "description": "…", "openGraph": { … } }
}
```

- `content` is validated against the page template's CDL.
- `bodies` keys must be a subset of the bodies declared by the page template's channel templates (§16.6). Content in a body that no longer exists is **retained but flagged** as orphaned — never silently dropped.
- `instanceId` is a UUID stable across edits so revisions can be diffed per section.
- **`nav.noIndex` (M30)** — "Hide from search engines": a boolean, default `false` (new pages are created with it; a page saved before M30 without it reads as `false`, no migration). A non-boolean value is `422`. It is part of the payload, so it follows the page's release state and language like every other value. A `noIndex` page stays published and linked; generation leaves every output of it (all page numbers) out of `sitemap.xml` — also as an `hreflang` alternate of its other languages — and leaves it out of the duplicate title/description checks (§18.8); `search-index.json` (the site's own search) still lists it. Templates read it as `$CMS_META(noIndex)$` / `CMS_META.noIndex` (§16.2) to write `<meta name="robots" content="noindex">`, and rule `SF-CHK-0212` reports a `noIndex` page whose HTML lacks that meta. The page editor edits it as the switch "Hide from search engines" next to "Show in navigation" (`nav.visible`) under *Navigation and search* in the page's properties popover (opened from the page title).

### 10.4 Page lifecycle

| Action | Effect |
|---|---|
| Create | Choose page template + display name + folder → UID derived → revision |
| Edit content | Field-level save (debounced batch, one revision per save action) |
| Reorder sections | Body array reorder → revision |
| Move | Change folder → revision, path rewrite |
| Delete | `deleted = true` version; usage check warns about inbound references. A page released in some language stays online (`DELETION_PENDING`) until the deletion is released (M27); a page `NEW` in every language is simply gone |
| Restore | New version from a chosen revision (a draft; the release state is unchanged) |
| Release (M27) | Makes the draft of the chosen languages the released version, with the proposed unreleased dependencies, in one `RELEASE` revision; refused for rule errors, and for rule warnings unless accepted (§5.5, §10.5); `release` fills are written in the same revision. Changes nothing on the site until the next build |
| Unpublish (M27) | Closes the release pointer of the chosen languages (`UNPUBLISH` revision); the draft stays and can be released again |
| Discard changes (M27) | Writes the released version of a language back as a new draft version (`DISCARD` revision; append-only). Not offered for `NEW` |

**Structural changes are drafts (M27).** Move, rename, uid change, section add/remove/reorder and delete are ordinary drafts: the released version keeps rendering at its old path until released. A folder rename or move writes a version of every descendant (their denormalized paths), so every descendant turns `CHANGED`; the release dialog offers them as the optional "descendants of a changed folder" group.

**Dependencies (M27).** Releasing computes the selection's unreleased dependencies (`POST …/releases/plan`): transitively over the drafts' `asset_reference` edges to editorial assets that are `NEW`, `CHANGED` or `UNPUBLISHED` in the same language (`REFERENCE`), the folders and record sets the selection sits in when they aren't released at all (`CONTAINER`), a selected set's unreleased records (`SET_MEMBER`) — all proposed and ticked by default — and a selected changed folder's changed descendants (`DESCENDANT`, offered unticked). Whatever stays unreleased renders like a missing asset (§16.4).

**Discard in one language.** Discarding language L restores L's language-dependent values and, only when every other language is `PUBLISHED` against the same released version, the shared fields too; otherwise the shared fields stay and the result lists the item in `sharedFieldsKept`.

### 10.5 Validation rules

- `templateRef` must resolve to an existing, non-deleted `PAGE_TEMPLATE` in the same project.
- Section instance `templateRef` must be an allowed section template for that body (`allow` list in CDL, §14.6).
- Everything else is decided by **rules** (M33): the built-in rules of the editors' attributes (`required`, `min`, `max`, `maxLength`, `maxChars`, `pattern`, `mimeTypes`, §14.4) and the template's own `rules {}` (§14.8). Each rule has a **level** and the **scopes** it runs in; without overrides the built-ins behave as before M33 — a save succeeds if structurally valid, releasing refuses `error` findings (`422 SF-DOM-0150`, M27 — pages against their template, records against their dataset, global sets against their own CDL), and generation holds such pages back as a safety net (`SF-GEN-0120`).

Content findings (`ContentIssue`: `path`, `code`, `severity`, `message`, `kind`, and since M33 `rule`, `scopes`, `messages`, `locale`, `onGeneration`) are produced by `ContentValidator`, `PageContentValidator` and the `RuleEngine` against the compiled CDL of the page template (its effective definition, §13.3) and of each section and catalog card template. `visibleWhen`-hidden editors are skipped. Paths are full, e.g. `content.title`, `bodies.main[2].content.cards.cards[0].content.headline`. Every finding has one of two kinds:

| Kind | Codes | On save | On release / generation |
|---|---|---|---|
| **Structural** — the value has the wrong shape | `type` (wrong JSON type; malformed `media`/`reference`/`link`/`richtext`/catalog value; a list item that is not an object), `option` (value outside `options`), `allow` (section or catalog card template not allowed there), `template` (catalog card template not found), `dataset`, `pagination` | always rejected: `422` `SF-API-0422` with the findings in an `issues` array; not a rule, no level or scope to change | does not block |
| **Completeness** — well-formed but unfinished, or a rule doesn't hold | built-ins `required`, `min`, `max`, `maxLength`, `maxChars`, `pattern`, `mimeType`, `visibleWhen`; custom rules `rule`; runtime `rule-eval`, `read-only` | blocks when an `error` has the scope `save` | blocks when an `error` has the scope `release` / `generation` |

**Levels and scopes.** `Severity` is `ERROR`, `WARNING`, `INFO` or `HINT` (CDL `error`, `warning`, `info`, `hint`). A finding **blocks** a scope's action iff its severity is `ERROR` and the scope is among its `scopes`. What each level does per scope:

| Level | `edit` (form, `rules/evaluate`) | `save` (every save, autosave included) | `release` | `generation` |
|---|---|---|---|---|
| `error` | shown at the field, counted in the Issues panel | save rejected, `422 SF-API-0422` with `issues` | release refused, `422 SF-DOM-0150` | `onGeneration holdBack`: page and language held back (`SF-GEN-0120`, run `PARTIAL`); `onGeneration fail`: run `FAILED` (`SF-GEN-0121`) |
| `warning` | shown and counted | returned in `issues`, save succeeds | refused with `422 SF-DOM-0156` unless the request has `acceptWarnings: true`; scheduled releases accept and record them | run diagnostic `SF-GEN-0122`, counted in `warning_count`, run `PARTIAL` |
| `info` | shown, not counted | returned, save succeeds | listed in the plan (`infoFindings`), never blocks | run diagnostic `SF-GEN-0122` (severity `INFO`), not counted |
| `hint` | shown only at the field | — | — | — |

A rule runs only in the scopes it names. Built-ins without modifiers are `level error`, `scope [edit, release, generation]`, `onGeneration holdBack` — exactly the pre-M33 behavior; `edit` makes them visible while typing. A built-in `required` on a localizable editor checks the default language only (M24); custom rules run per language (§14.8).

- **Save scope.** Every save path — page `PUT` (autosave is the same `PUT`), `PATCH …/content` (content and bodies), section add, reorder, move and delete, record create and update, property-set values update — runs, after the structural check: (1) **read-only enforcement** — a field whose `readOnlyWhen` holds on the **stored** version keeps its stored value; a changed value is ignored with an `info` finding `read-only`; (2) **save fills** — `mode empty` writes only into empty fields, `mode always` overwrites (a typed value that differs from the computed one gets a `read-only` info); fills run in dependency order before the rules, so assertions see filled values; (3) **save rules** — any finding that blocks `save` rejects the request with `422 SF-API-0422` and every finding under `issues`, autosave included. The stored content is the filled and enforced one and comes back in the response. Read-only enforcement never fails a save. Imports do not run save rules. `PUT` validates the whole page; `PATCH …/content` validates `content` if patched and every section of each patched body; adding and moving a section validate that section's structure, including the target body's `allow` list, and the page's save rules. Legacy structural findings outside the validated subtree therefore never block an unrelated save.
- **Untouched editors.** The form engine's placeholder values (`{"type":"MEDIA_REF","uuid":null}`, an `INTERNAL` link without `uuid`, `{"format":"html","value":""}`, `{"type":"CATALOG","cards":[]}`) count as empty: they save, and `required` fires for them in its scopes.
- **Advisory `issues`.** Every page response (`GET`, create and each mutation) carries `issues`: the `edit`-scope outcome of the stored draft, structural and completeness, each with its `kind`; after a save the save's `read-only` notes come first. `RecordDetailView.issues` (also on `GET` of the current record) and `GlobalSetDetailView.issues` do the same for records and property sets.
- **Edit scope.** The form engine asks `POST /projects/{p}/rules/evaluate` (§19.5) for findings, fill values and field states of the unsaved value; nothing is stored.
- **Release.** Per asset version and released language: release fills, then release rules and built-ins (§5.5).
- **Generation.** The VALIDATE stage runs the `generation` scope per page and language on the snapshot (§18.2). Structural findings do not block release or generation.
- **Groups.** A `group` is a transparent wrapper: its children's values are stored at the top level of `content`, next to the group's siblings, and validated there. Values nested under the synthetic `_group_N` key by older UI builds are read by the form engine as a fallback and flattened on the next save.

---

## 11. Asset type: Media

### 11.1 Definition

Media assets are binary files: images, video, audio, documents, CSS, JS, fonts. They are referenced from content (`MEDIA_REF` editors) and from OCTL (`$CMS_REF(media:uid)$`), and they are copied to the output during generation.

### 11.2 Storage

- Metadata → `asset` / `asset_version` like every other asset.
- Bytes → **content-addressed blob store** keyed by SHA-256, so re-uploading the same file costs nothing and version history is cheap.

```
blob
  sha256        char(64) PK
  size_bytes    bigint
  mime_type     varchar(150)
  storage_key   varchar(500)     -- fs path or S3 key
  ref_count     bigint           -- derived, informational (recomputed by the sweep)
  created_at
  last_referenced_at             -- last write that created or reused it (M29.2.3)
```

`asset_version.payload.blobSha256` (and `variants[].blobSha256`, also inside each `localeFiles` entry) links a media version to its bytes. The nightly `blob-sweep` system job (M29.2.3) collects blobs by **mark and sweep**: it marks every blob referenced by any `asset_version` row of any revision (closed and deleted versions included), by `media_variant` rows whose source blob is still referenced by a version or that are younger than the grace period (§11.4; older rows of an unreferenced source mark nothing and are deleted, so compacted images free their variants too) and by `generation_run.log_blob_sha`; it deletes unmarked rows whose `COALESCE(last_referenced_at, created_at)` is older than the grace period (default 24 h) and store objects without a row older than the grace period (orphan bytes of failed commits and imports). Each deletion re-checks under the blob row's lock, the same lock every blob write takes to reuse a row, so a concurrent upload of the same bytes is never lost. `ref_count` is derived and informational: the sweep recomputes it, and no code path deletes by it. Deleting or replacing media frees no space while history references the old bytes; revision compaction (§7.7) removes such versions and the next sweep collects their blobs.

Every blob write (upload, text write, variant, import) goes through one write path that inserts a new row before writing the bytes, or locks an existing row `FOR UPDATE`, increments `ref_count`, sets `last_referenced_at` and rewrites missing bytes. The sweep deletes the store object first and then the row, in one transaction under that lock, so a crash leaves at most a row without bytes (deleted by the next sweep while still unreferenced, or repaired by the next write that reuses it). An orphan object is claimed with a placeholder row before it is deleted, so a concurrent write of the same bytes either waits and writes them again or makes the claim fail. The sweep supports a dry run (same counts, nothing deleted), reports blobs examined, marked and deleted, orphan objects deleted, bytes freed and a sample, and publishes its last outcome as `lastSweep` in the blob-store health details. A restore drill that restores the database to an earlier point may reference blobs swept after that point: see §26.5. `S3BlobStore` is still a stub; listing its objects for the orphan sweep (`ListObjectsV2`) follows when it becomes real.

Backends behind a `BlobStore` interface: `FilesystemBlobStore` (default, `sf.media.root`), `S3BlobStore` (optional). Path layout `{root}/{sha[0:2]}/{sha[2:4]}/{sha}`.

### 11.3 Media payload

```json
{
  "blobSha256": "9f2c…",
  "fileName": "hero-autumn.jpg",
  "mimeType": "image/jpeg",
  "sizeBytes": 483920,
  "image": { "width": 2400, "height": 1350, "orientation": 1, "dominantColor": "#3B2F2A" },
  "altText": "Model wearing the autumn parka",
  "caption": "Autumn 2026",
  "copyright": "© Acme",
  "focalPoint": { "x": 0.42, "y": 0.31 },
  "variants": [
    { "name": "w800",  "blobSha256": "1a4b…", "width": 800,  "format": "webp" },
    { "name": "w1600", "blobSha256": "7c8d…", "width": 1600, "format": "webp" }
  ],
  "processCms": false
}
```

`processCms` (M18) opts a **text** media file into OCTL processing (§16.12). It can only be `true`
for text MIME types: every `text/*` type, every `+json`/`+xml` type (`image/svg+xml`,
`application/manifest+json`, `application/rss+xml`, …) and `application/javascript`, `application/json`,
`application/xml`, `application/yaml`; a
payload without the key reads as `false`. `replace` keeps it while the new file is text and clears
it otherwise. The blob stays the file's **source**: rendered output is produced per generation run
and per preview request and never written back to blob storage.

### 11.4 Upload flow

1. `POST /projects/{p}/media` — `multipart/form-data`, or `POST …/media/bulk` for multi-file drops.
2. Server streams to a temp file, computes SHA-256, sniffs the MIME type with Apache Tika (**never trusting the client-supplied type**), enforces the allow-list and size limit.
3. Metadata extraction: image dimensions and EXIF orientation (metadata-extractor); EXIF GPS is stripped by default (`sf.media.strip-exif=true`).
4. Variants generated per the **variant policy** (declarative; see *Implemented variant policy* below for how M29 deviates from this sketch):

```yaml
variants:
  - name: w400
    width: 400
    format: webp
    quality: 82
    appliesTo: "image/*"
  - name: w1600
    width: 1600
    format: webp
    quality: 78
    appliesTo: "image/*"
```

5. Blob `ref_count` incremented; asset version written; revision created.

**Implemented variant policy (M29).** The policy is still **instance-wide** (`sf.media.variants`, `name`, `width`, `format`, `quality`), not per project as sketched above, and there is no `appliesTo`: a definition applies to raster images (`image/*` except SVG) with a positive width. Uploads generate the variants synchronously and keep writing them into the version payload (`variants[]`). A definition whose format has no encoder (`webp` today) is skipped.

**Derived variants (M29).** Variants are a pure function of the source bytes and the definition, so they are also kept as derived data outside the revision history:

```
media_variant
  id, source_sha, name, width, format,
  quality        -- effective encoder quality (JPEG: the definition's or 82; 0 for formats without one)
  blob_sha, created_at
  UNIQUE (source_sha, name, width, format, quality)
```

Rows are project-independent (like blobs). Uploads record the variants they create here too. Every reader — binary serving and preview (`?variant=`), the media view, export, and generation (through the build snapshot) — sees the payload's variants merged with the rows for the current policy; the payload wins on the same name. The stored versions are never changed, so point-in-time reads stay byte-identical. The `media-variant-backfill` system job (§26.6) creates the variants of the current policy that media files lack (a definition added later, a failed encode) **in this table only**: no revision, no draft, no change of release state. It works on current versions (and, with `includeHistorical`, closed ones), at most `maxPerRun` attempts per run; failures are reported per MIME type, definition and reason and retried on the next run, and a definition without an encoder is reported once as unsupported. A backfilled variant is not a content change: an incremental build doesn't re-render for it, the next full build (or a change of the referencing page or media) publishes it. Rows of a definition removed from the policy are ignored by readers but not deleted, and their blobs stay marked by the sweep (§11.2) while the rows exist.

**Editing text media (M18).** `GET /media/{uuid}/text` returns a text file's content (decoded as
UTF-8, with a flag when the bytes aren't valid UTF-8); `PUT /media/{uuid}/text` stores new content as
a new content-addressed blob in one revision, keeping the MIME type, file name, metadata and
`processCms`. The upload rules apply (size cap, SVG sanitizing); line endings are stored as sent, and
content identical to the stored blob writes no revision. Switching `processCms` on, a text write to a
processed file and a replace of a processed file compile the source first: errors are a `422` with
`diagnostics` and nothing is stored (§16.12).

### 11.5 Constraints & safety

- Default max upload 100 MB (configurable), default max image dimension 12,000 px.
- Allow-list by MIME family; SVG is sanitized (script/foreignObject/event attributes stripped) or rejected per project setting — on upload, on every text write, and, for a processed SVG (M18), again **after rendering**, so a rendered value can't reintroduce script.
- Uploaded files are served from a **separate origin/path** with `Content-Disposition: attachment` for non-renderable types and a strict `Content-Security-Policy` for previews.
- Media referenced by any non-deleted asset cannot be hard-deleted without confirmation; the UI shows the usage list first.

### 11.6 Localized media (M27)

In a project with languages a media asset may carry **one file per language**. The flag lives in the payload; the top-level file fields stay the file of `fileLocale` (the language it belongs to, recorded when localizing, so a later change of the default language doesn't hand it to another language), the other languages' own files live in `localeFiles`:

```json
{
  "localized": true,
  "fileLocale": "de",
  "blobSha256": "9f2c…", "fileName": "hero.png", "mimeType": "image/png", "sizeBytes": 483920, "variants": [ … ],
  "localeFiles": {
    "en": { "blobSha256": "1a4b…", "fileName": "hero-en.png", "mimeType": "image/png", "sizeBytes": 471002,
            "image": { … }, "variants": [ … ], "processCms": false }
  }
}
```

A language without its own file uses the first file along its fallback chain; the top-level file is the last resort (`MediaFiles.fileFor`). The media view answers `localized` and `localeFiles: {language → {own, fromLocale, blobSha256, fileName, mimeType, sizeBytes, image, processCms, textEditable}}` for every project language; `?locale=` on `binary`, `thumbnail`, `text` and `process` addresses the file a language renders (a text write for a language that falls back gives it its own file).

- **Toggle** (`PUT /media/{uuid}/localized`, one revision). Localizing makes the existing file the default language's. Un-localizing keeps the default language's file and discards the others only when confirmed: without `confirmDiscard: true` the answer is `409 SF-MEDIA-0505` listing them (`files: [{locale, fileName, sizeBytes}]`). Release pointers are re-keyed in the same revision (`""` ↔ one per language), each keeping the status the shared or default pointer had.
- **Files.** `POST /media/{uuid}/files/{locale}` uploads or replaces a language's own file through the upload rules of §11.4; `DELETE` removes it so the language falls back again. The default language's file can't be removed (`422 SF-MEDIA-0509`); media that isn't localized refuses both (`0506`), as does a language the project doesn't declare (`0507`); a project without languages can't localize (`0508`).
- **Release.** Localized media is released per language; its status compares the file each language renders and who owns it, so replacing only the French file changes only the French status, and a language that gains its own file is `CHANGED` even with identical bytes (it publishes at another path).
- **Output** (§18.3): a language's own file is written under that language's prefix; a language that falls back links the owner's published file.

---

## 12. Asset type: Section template

A section template is the **smallest reusable content block**. It consists of:

1. a **content definition** (CDL) — which editors exist, and
2. one **output channel template** (OCTL) per channel — how the block is rendered.

### 12.1 Payload

```json
{
  "contentCdl": "…the editors (CDL, §14.9)…",
  "bodiesCdl": "",
  "rulesCdl": "…rule, state and fill entries…",
  "compiledDefinition": { …normalized JSON AST… },
  "channelTemplates": {
    "html":     { "source": "…OCTL…", "compiledHash": "ab12…" },
    "markdown": { "source": "…OCTL…", "compiledHash": "cd34…" }
  },
  "preview": { "sampleContent": { … }, "thumbnailMediaRef": "018f-…" },
  "category": "Hero",
  "deprecated": false
}
```

### 12.2 Rules

- Editor names are **unique within one template**; the CDL compiler rejects duplicates with the offending line/column.
- A section template must define a channel template for every **required** channel of the project. Missing optional channel templates cause the section to render as empty in that channel (with a build warning), not to fail the build.
- Changing the CDL never destroys stored content. Removed editors leave orphaned values that are preserved in the payload under `content._orphaned` and surfaced in the UI as "no longer part of this template — remove or restore the field".
- `deprecated: true` hides the template from the "add section" picker but keeps existing instances working.
- Editor rules (M33, §14.8): a section template's `rules {}` target its own editors or the whole instance (`on section`). They run for every instance of the template when the page is saved, released or built, with `section.page` (the page's content and meta) in context; evaluated on its own (`rules/evaluate` with `kind: SECTION`) there is no `section.page`. Finding paths carry the instance prefix (`bodies.main[2].content.headline`).

### 12.3 Migration of content on CDL change

When an editor is renamed, the developer may declare a migration hint:

```
editor richtext body { label "Body", renamedFrom "text" }
```

On save the server performs a project-wide content migration in one revision, moving `text` → `body` for every instance of the template, and records it in the revision summary.

---

## 13. Asset type: Page template

A page template declares the frame of a page: the surrounding HTML, the `<head>`, the bodies, and — like a section template — its own content editors.

### 13.1 Differences from a section template

| Aspect | Section template | Page template |
|---|---|---|
| Own CDL editors | ✅ | ✅ (identical capability) |
| Bodies | ❌ | ✅ via `$CMS_BODY(name)$` |
| Rendered standalone | ❌ (always inside a page) | ✅ (produces the output file) |
| Output path rule | n/a | `outputPath` expression |
| Usable inside another template | ✅ (`$CMS_INCLUDE`) | ❌ |
| Inheritance (M20) | ❌ (`$CMS_EXTENDS` is `SF-TPL-0156`) | ✅ extends another page template, may be `abstract` (§13.3) |

### 13.2 Payload

```json
{
  "contentCdl": "…CDL: editors…",
  "bodiesCdl": "…CDL: body declarations…",
  "rulesCdl": "…CDL: rules…",
  "channelTemplates": {
    "html":     { "source": "…OCTL…" },
    "markdown": { "source": "…OCTL…" }
  },
  "bodies": [
    { "name": "main",    "label": "Main content", "allow": ["*"],                 "min": 0, "max": null },
    { "name": "sidebar", "label": "Sidebar",      "allow": ["teaser","cta_box"],  "min": 0, "max": 4 }
  ],
  "outputPath": { "html": "{folder}{uid}.html", "markdown": "{folder}{uid}.md" },
  "category": "Standard",
  "abstract": false,
  "parentTemplateRef": "7f0c…-uuid-of-docs_layout"
}
```

`bodies` is authored explicitly (not only inferred from OCTL) so that allow-lists and cardinality can be declared; the compiler cross-checks it against the `$CMS_BODY` occurrences in every channel template and reports mismatches.

`abstract` and `parentTemplateRef` were added by M20 and are absent (`false`/`null`) in data saved before it. The CDL sections (§14.9), `compiledDefinition` and `bodies` are always the template's **own** definition; the inherited parts are computed (§13.3).

### 13.3 Inheritance (M20)

- **Layouts.** A channel source that starts with `$CMS_EXTENDS(page_template:uid)$` renders its parent's layout, replacing the parent's `$CMS_BLOCK(name)$` regions with its own top-level blocks; `$CMS_PARENT$` inside an override renders the parent's definition (§16.2). Rendering starts at the root layout. Chains are at most 8 ancestors deep; cycles are compile errors. Each channel links its own chain.
- **`parentTemplateRef`** is derived on every save from the channel sources, which must all extend the same parent (`SF-TPL-0159`); clients can't write it. It is also the child → parent `TEMPLATE` reference edge (source path `parentTemplateRef`, §5.4), so usages list a layout's children, a layout with live children can't be deleted (`SF-DOM-0120`, naming them), exporting a template includes its ancestors as implicit picks, and an incremental build reaches every page of every descendant of a changed layout (§18.1). Importing a template whose parent is neither in the archive nor in the target project is the blocking conflict `PARENT_TEMPLATE_MISSING`.
- **`abstract`** templates are layouts: pages can't be created on or switched to them (`SF-DOM-0123`), and a template that pages use can't become abstract (`SF-DOM-0122`, with `pageCount`, `pageUids`, `pageUuids`). Pickers leave them out; the template list exposes the flag.
- **Effective definition.** The union of the own definitions along `parentTemplateRef`, root first. A name a template declares that an ancestor already declares is `SF-CDL-0109`. The page form, server-side content validation and rules (§10.5, §14.8), generation's rule check and every OCTL editor/body name check use it. It is computed at read and render time against the same revision, never copied into descendants. The template read model returns it as `effectiveDefinition` with `inheritedFrom` (name → ancestor uid) and `ancestors` (parent first).
- **Rules (M33).** The effective definition also carries the effective rule set (§14.8): the `rules {}` entries of the chain, root first. A child's `rule` with an ancestor's name replaces it, a child's `state` or `fill` on an ancestor's path replaces that entry, and `rule "<name>" off` removes an inherited rule; switching off a name no ancestor defines is `SF-CDL-0118`. A child's rules may target inherited editors. Built-in modifiers (§14.4) belong to the editor's declaration, so a child can't re-level an inherited editor's built-ins (redeclaring the editor is `SF-CDL-0109`, the ancestor's editor wins), and a child rule can't be named after a built-in (`SF-CDL-0119`). A fill cycle across the chain is `SF-CDL-0117` on the child. Section templates, dataset schemas and property sets have no chain: their `rules {}` is used as is. The page template's live check (`/cdl/validate` without the parent chain) reports an unknown target or identifier as a warning `SF-CDL-0115`, since it may be inherited; the template save checks it against the chain.
- **Parent changes.** Saving a page template recompiles every descendant against the proposed version before anything is written; an error rejects the save with `422 SF-DOM-0124` and `descendants[]` (uid, channel, diagnostics), warnings come back as `descendantWarnings`. A `renamedFrom` hop on the template's editors migrates the `content` of the pages of the template and of every descendant in the template save's revision. A descendant saved concurrently against the old parent can slip past the check; the next save of either template re-validates it, and generation's VALIDATE stage reports it.

---

## 14. Content definition language (CDL)

### 14.1 Purpose and shape

CDL declares *what an editor can fill in*. It is a small, readable, brace-based DSL. The authoring form is text (edited in code editors, one per section — §14.9; diffable, copy-pasteable); the persisted form additionally carries a normalized JSON AST for fast server-side validation.

### 14.2 Example

```
content {
  group "Headline area" {
    editor text headline {
      label       "Headline"
      help        "Shown as H1. Keep it under 60 characters."
      required
      maxLength   80
      default     "New headline"
    }
    editor text kicker {
      label    "Kicker"
      maxLength 40
    }
  }

  editor richtext body {
    label    "Body text"
    features [bold, italic, link, list, h2, h3, quote]
    maxChars 4000
  }

  editor media heroImage {
    label      "Hero image"
    mimeTypes  ["image/jpeg", "image/png", "image/webp"]
    minWidth   1200
    required
  }

  editor reference relatedPage {
    label      "Related page"
    assetTypes [PAGE]
    folder     "/products/"
  }

  editor select layout {
    label   "Layout"
    options [
      { value "left",  label "Image left"  },
      { value "right", label "Image right" },
      { value "full",  label "Full bleed"  }
    ]
    default "left"
  }

  editor boolean showCta { label "Show call to action" default false }

  editor list links {
    label "Link list"
    min 0
    max 8
    item {
      editor text      label  { label "Link text" required }
      editor link      target { label "Target" }
    }
  }

  editor date publishedOn { label "Published on" format "yyyy-MM-dd" }
}
```

### 14.3 Editor types

| Type | Stored value | Angular control |
|---|---|---|
| `text` | `string` | single-line input, char counter |
| `textarea` | `string` | auto-growing textarea |
| `richtext` | `{ "format":"html", "value":"…" }` | TipTap, feature-gated toolbar |
| `markdown` | `string` | Monaco (markdown mode) + split preview |
| `number` | `number` | numeric input with min/max/step |
| `boolean` | `boolean` | switch |
| `date` / `datetime` | ISO-8601 `string` | date/time picker |
| `select` | `string` | radio group (≤4 options) or listbox |
| `multiselect` | `string[]` | checkbox group / token field |
| `color` | `#rrggbb` | swatch picker constrained to project palette |
| `link` | `{kind:"INTERNAL"\|"EXTERNAL"\|"MEDIA"\|"ANCHOR"\|"MAIL", uuid?, url?, anchor?, target?, title?}` | link dialog |
| `media` | `{type:"MEDIA_REF", uuid, variant?, altOverride?}` | media picker + drop zone |
| `reference` | `{type:"ASSET_REF", uuid, assetType}` | asset picker with type filter |
| `list` | `array` of item objects | repeatable rows, drag-reorder |
| `group` | nested object | visual grouping, collapsible |
| `json` | arbitrary JSON | Monaco (json mode), schema-validated |
| `pagination` | `{type:"PAGINATION", source:{kind:"NAV"\|"DATASET", uuid}, pageSize, sort:{key, direction}}` or `null` | source picker (Navigation folder / dataset), page size, sort + direction (M21; page templates only, at most one; `docs/editors/pagination.md`) |

### 14.4 Common attributes

`label`, `help`, `required`, `default`, `readOnly`, `hidden`, `group`, `order`, `visibleWhen`, `validate`.

**Conditional visibility**

```
editor text ctaLabel {
  label "Button label"
  visibleWhen "showCta == true"
}
```

The expression grammar is deliberately tiny: `identifier (== | != | > | < | >= | <= | in) literal`, combined with `&&`, `||`, `!`, parentheses. Evaluated identically in the backend validator and the Angular form engine (one grammar, two implementations, one shared test-case fixture file).

**Custom validation**

```
editor text slug {
  validate pattern "^[a-z0-9-]+$" message "Only lowercase letters, digits and hyphens."
  validate maxLength 60
}
```

**Built-in modifiers (M33).** The completeness attributes are built-in rules (§10.5). `required`, `maxLength n`, `maxChars n`, `min n`, `max n`, `mimeTypes [...]` and every `validate …` clause accept trailing modifiers, in any order:

| Modifier | Values | Default |
|---|---|---|
| `level` | `hint`, `info`, `warning`, `error` | `error` |
| `scope` | a non-empty list of `edit`, `save`, `release`, `generation` | `[edit, release, generation]` |
| `onGeneration` | `holdBack`, `fail` — only with level `error` and `generation` among the scopes | `holdBack` |
| `message` | a map per UI language, `message { en "…" de "…" }`; a single string (`message "…"`) is the `en` entry | the built-in text |

```
editor text title {
  required level warning scope [release]
  maxLength 160 level info scope [edit]
  validate pattern "^[A-Z]" message "Start with a capital" level hint
}
editor list tags { min 1 max 5 onGeneration fail }
```

Without modifiers a built-in is `level error scope [edit, release, generation] onGeneration holdBack` — the pre-M33 behavior. An invalid modifier (unknown level or scope, `onGeneration` without `error`/`generation`, an unknown message placeholder) is `SF-CDL-0119`. Modifiers belong to the editor's declaration: a child template can't change an inherited editor's built-ins (§13.3). Structural checks (`type`, `option`, `allow`, `template`, `dataset`, `pagination`) are not rules and take no modifiers.

**Expressions.** `visibleWhen` keeps the version 1 boolean subset above, evaluated identically on the server and in the Angular form engine; v2-only syntax there is `SF-CDL-0105`. The rules of `rules {}` (§14.8) use **expression language v2**, evaluated only on the server (`sf-template` `ExpressionCompiler`/`ExpressionInterpreter`, each expression compiled once per definition):

- **Values:** string, number (decimal), boolean, `null`, list, object, date and datetime. Literals: `'text'` or `"text"`, numbers, `true`, `false`, `null`, list literals `[a, b]`.
- **Operators:** `+ - * / %` (`+` concatenates when either side is a string), `== != < <= > >=` (no chained comparisons), `and`/`or`/`not` and `&&`/`||`/`!`, `in` (list element, object key, or substring of a string), ternary `c ? a : b`, `??` (null-coalescing), parentheses. Precedence, lowest first: ternary, `??`, `or`, `and`, comparisons and `in`, `+ -`, `* / %`, unary `!`/`not`/`-`, then member access `.name`, indexing `[i]` and calls. The v1 single `=` is a parse error in rules.
- **Functions:** `length`, `isEmpty`, `matches(s, re)`, `lower`, `upper`, `trim`, `substring(s, start, end?)`, `concat(…)`, `slugify` (lower case, hyphens, accents and ligatures transliterated), `stripTags`, `wordCount`, `now()`, `today()`, `date(s)`, `daysBetween(a, b)`, `count(list)`, `min(…)`, `max(…)`, `sum(…)`, `any(list, expr)`, `all(list, expr)` (the element is `it` inside `expr`), `sections(body, templateUid?)`, `ref(value)`. Unknown functions and wrong arity are compile errors (`SF-CDL-0116`). Text functions read `null` as `""`, list functions as `[]`.
- **Context:** the definition's editor values at the root (group members by their own name, `list[]` rows as lists); `value` (the rule's target); `item`, `index` (0-based) and `parent` (the enclosing row) in row rules; `locale`, `defaultLocale`; `page` / `section` / `record` / `global` meta (`uid`, `uuid`, `name`, `path`, plus `template` for pages and `dataset` for records); `release.status` (the evaluated language's `ReleaseStatus`, `NEW` when never released); `global:<set>.<field>` (a property set's value, as in OCTL); `body.<name>` in page rules (the body's section instances, each `{template, content}`); `section.page` in section rules evaluated as part of a page (the page's content and meta). Localizable values resolve to the evaluated language along its fallback chain. An unknown identifier path is `SF-CDL-0115`.
- **`ref(value)`** turns a `media`, `link` or `reference` value into a read-only view of the target: `{uid, name, path, type, content, meta, mimeType, release {status}}` — `meta` of media is its descriptive fields plus `alt` (the alt text), of a page its meta; `mimeType` for media. The `edit` and `save` scopes read **drafts**, `release` the released state (assets released by the same request count as released), `generation` the build snapshot.
- **Results.** `assert`, `when`, `requiredWhen` and `readOnlyWhen` must yield `true` or `false`; anything else (and any runtime error) produces a `warning` finding with code `rule-eval`, and the rule counts as passed. A literal that can't be a condition is `SF-CDL-0116`. A fill's `value` may be any value.
- **Limits.** At most 200 `ref` lookups per evaluation (beyond: `rule-eval`); an evaluation budget of 200,000 steps and 200 ms per definition; regular expressions run with a bounded matcher (1 M character reads). Expressions are data: no reflection, no host access.

### 14.5 Naming rules

- Editor name: `[a-zA-Z][a-zA-Z0-9_]{0,63}`.
- **Unique within one template**, including across groups — groups are presentational, not a namespace. Inside `list … item { … }` a new namespace opens; item editor names must be unique within that item.
- Reserved names rejected: `uid`, `uuid`, `type`, `template`, `bodies`, `nav`, `meta`, `_orphaned`.

### 14.6 Body declaration (page templates only)

```
bodies {
  body main    { label "Main content" allow ["*"] }
  body sidebar { label "Sidebar" allow ["teaser","cta_box"] max 4 }
}
```

`allow` entries are section template **UIDs** (resolved to UUIDs at compile time) or `"*"`.

### 14.7 Compiler

`CdlCompiler` (in `sf-template`), hand-written recursive-descent parser over an ANTLR-free lexer (~600 LOC, no runtime dependency):

```
CDL source ──lex──▶ tokens ──parse──▶ AST ──validate──▶ ContentDefinition (JSON)
                                                  │
                                                  └─▶ Diagnostics[] (line, col, severity, code, message)
```

Diagnostics are returned by `POST /projects/{p}/cdl/validate` so Monaco can render squiggles while typing, and are re-run server-side on save (never trusting client validation).

**Diagnostics of `rules {}` and built-in modifiers (M33).** `/cdl/validate` returns them for every kind (`?kind=` page template by default, `SECTION_TEMPLATE`, `DATASET`, `GLOBAL_SET`); template, dataset and property-set saves re-run them.

| Code | Severity | Meaning |
|---|---|---|
| `SF-CDL-0113` | error | Invalid `rules {}` entry: syntax, an unknown key, an unknown level, scope, mode or placeholder, a `fill` with scope `generation`, a `state` on a whole-definition target, a whole-definition keyword that doesn't match the kind (`page` in a dataset), a second `rules {}` section |
| `SF-CDL-0114` | error | A `rule` without `level`, `scope`, `assert` or `message`; a `fill` without `value` or `on`; a `state` without `requiredWhen`/`readOnlyWhen` |
| `SF-CDL-0115` | error (warning in a page template's live check without its parent chain) | Unknown target or identifier path: an editor that doesn't exist, `[]` on a non-list, a list's field without `[]`, `item`/`index`/`parent` outside a row rule |
| `SF-CDL-0116` | error | Expression error: parse error, unknown function, wrong arity, a literal assertion that can't be a condition, the v1 single `=` |
| `SF-CDL-0117` | error | Duplicate rule name, duplicate `state` or `fill` path, or a fill cycle (the message names it: `slug → teaser → slug`), also across the inheritance chain |
| `SF-CDL-0118` | error | `rule "<name>" off` for a name no ancestor defines |
| `SF-CDL-0119` | error | Invalid built-in modifier (§14.4); `onGeneration` without level `error` and scope `generation` (on a built-in or a rule); a custom rule named after a built-in (`required`, `maxLength`, …) |

### 14.8 Rules (M33)

A CDL source may have one top-level `rules { … }` section next to `content {}` (and `bodies {}` in page templates). It is allowed in page templates, section templates, dataset schemas (records) and property-set (global set) CDL. `//` and `/* */` comments are allowed anywhere in CDL. Rules live in the CDL source, so they travel with export and import; there is no separate storage.

```
rules {
  rule "title-length" on title {
    level warning
    scope [edit, save]
    when "category == 'news'"
    assert "length(value) <= 70"
    message { en "Keep titles under 70 characters ({length})" de "Titel unter 70 Zeichen halten ({length})" }
    locales all
  }
  rule "caption-per-image" on gallery[] {
    level error  scope [release, generation]  onGeneration holdBack
    assert "!isEmpty(item.caption)"
    message { en "Image {index} needs a caption" }
  }
  rule "one-hero" on page {
    level error  scope [save, release]
    assert "count(sections(body.main, 'hero')) == 1"
    message { en "Exactly one hero section" }
  }
  rule "alt-text" on image {
    level warning  scope [edit, release]
    assert "!isEmpty(ref(value).meta.alt)"
    message { en "The selected image has no alt text" }
  }
  state teaser { requiredWhen "category == 'news'"  readOnlyWhen "release.status == 'PUBLISHED'" }
  fill slug { value "slugify(title)"  mode empty  on [edit, save] }
  fill publishDate { value "today()"  mode empty  on [release] }
  rule "legacy-check" off
}
```

**Grammar (abridged).**

```
rules      = "rules" "{" { entry } "}"
entry      = rule | state | fill | off
rule       = "rule" STRING [ "on" target ] "{" { ruleKey } "}"
ruleKey    = "level" level | "scope" scopes | "when" STRING | "assert" STRING
           | "message" messages | "locales" locales | "onGeneration" ("holdBack" | "fail")
state      = "state" path "{" { "requiredWhen" STRING | "readOnlyWhen" STRING
                               | "level" level | "scope" scopes | "message" messages } "}"
fill       = "fill" path "{" { "value" STRING | "mode" ("empty" | "always") | "on" scopes } "}"
off        = "rule" STRING "off"
target     = path | "page" | "section" | "record" | "global"
path       = NAME [ "[]" ] { "." NAME [ "[]" ] }
level      = "hint" | "info" | "warning" | "error"
scopes     = "[" scope { "," scope } "]"          -- edit, save, release, generation
messages   = "{" LANG STRING { LANG STRING } "}" | STRING   -- a lone STRING is the en entry
locales    = "all" | "[" "default" "]" | "[" LANG { "," LANG } "]"
```

**`rule`** — a validation rule. `level`, `scope`, `assert` and `message` are required (`SF-CDL-0114`); there are no defaults. `when` is an optional precondition: the rule runs only where it holds. `locales` is `all` (default), `[default]` (the project's default language only) or a list of language codes. `onGeneration` is allowed only with level `error` and `generation` in the scope (`SF-CDL-0119`); default `holdBack`. Names are unique within the effective definition (`SF-CDL-0117`) and can't be a built-in's name.

**Targets.** `on` names an editor path — `title`, a group member by its name (`seoTitle`) or a path through groups (`group.field`), `gallery[]` for each row of a list, `gallery[].caption` for a field of each row, nested `list[].inner[]` — or the whole definition with the keyword of the CDL's kind: `page` (page templates), `section` (section templates), `record` (datasets), `global` (property sets); another keyword is `SF-CDL-0113`. A rule without `on` targets the whole definition. `value` is the target's value; a row rule runs once per row with `item` (the row), `index` (0-based in expressions) and `parent` (the enclosing row of a nested list). A finding's path is the target's path with the row index (`gallery[2]`), prefixed like every content finding (§10.5).

**`state <path>`** — conditional field state: `requiredWhen "<expr>"` produces a `required` finding while it holds, with the state's `level`, `scope` and `message` (all optional; default those of the editor's `required` built-in); `readOnlyWhen "<expr>"` makes the field read-only in the form, and on save a changed value is ignored (§10.5). At least one of the two is required.

**`fill <path>`** — a computed value: `value "<expr>"` (any value), `mode empty` (default: write only into an empty field) or `mode always` (overwrite; the field is computed and read-only in the form), `on` a non-empty list of `edit`, `save`, `release` — never `generation` (`SF-CDL-0113`). A duplicate fill path or a fill cycle (a fill reading a field another fill writes, transitively reaching itself; reading the own field by name counts, `value` doesn't) is `SF-CDL-0117`. Fills run in dependency order before the rules of the same scope, so assertions see filled values. `edit` fills are proposed to the form (§23.5), `save` fills written by the save, `release` fills by the release (§5.5).

**`rule "<name>" off`** switches off an inherited rule (§13.3).

**Messages.** A map per UI language; the request's `Accept-Language` picks the entry, else the first one. Placeholders: `{value}`, `{length}`, `{min}`, `{max}`, `{index}` (1-based row number), `{locale}`; any other `{…}` is `SF-CDL-0113` (`SF-CDL-0119` on a built-in).

**Languages.** A rule runs once per language (with `locale` set) only when it reads a language-dependent value, `locale`, `release`, `body`, `section`, `global:` or `ref`; otherwise once. Its findings carry that `locale`. Edit and save evaluate every project language (or the requested one plus the default, §19.5); release the languages being released; generation the language being built.

**Engine.** `RuleEngine` (`sf-domain`, pure) takes the effective definition, the content, a scope, the languages and a context provider and returns the outcome `{findings, fills, fieldStates}`; the built-in checks stay in `ContentValidator` and the engine adds them to its outcome, so every scope has one code path. Editors hidden by `visibleWhen` are skipped. Catalog cards are evaluated with their section templates' rules wherever a `catalog` editor sits — in a page, a body section, a record or a property set, through groups, list rows and nested catalogs: paths `<catalog>.cards[i].content.<field>`, `section` reads `page` (the enclosing top-level content), `catalog`, `index` and `template`. A `mode empty` fill whose value is empty writes nothing. The finding code of a custom rule is `rule` (with `rule` = its name); runtime codes are `rule-eval` (an evaluation error or limit, `warning`) and `read-only` (an ignored change, `info`).


### 14.9 Sections as stored and edited (M34)

A holder's CDL is stored and edited as its sections, not as one text: `contentCdl` (the text inside `content { … }`), `bodiesCdl` (inside `bodies { … }`, page templates only) and `rulesCdl` (inside `rules { … }`), each **without** its keyword and braces. Datasets and property sets have `contentCdl` and `rulesCdl`; a section template sends an empty `bodiesCdl` (a non-empty one is rejected on save: a section template has no bodies). The API, the payload (§12.1, §13.2) and `/cdl/validate` all take the three fields; there is no whole-text form.

The compiler (`CdlCompiler.compile(CdlSources)`) lexes each section on its own and wraps it in its keyword and braces. A section's text can't close its own section: an unmatched `}` is `SF-CDL-0200` "Unmatched '}'" at its position (and dropped), an unclosed `{` is `SF-CDL-0200` "Missing '}'" at the end of the section. An empty bodies or rules section is left out.

Every diagnostic names the source it is in with `field`: `content`, `bodies` or `rules` for a CDL section — with `line`/`column` relative to that section — and `channel:<key>` for a channel template (or a dataset's record template). A whole-definition finding without a position (e.g. a property set's catalog editor) is placed on `content`. Internally a section's lines are encoded as `section × 1 000 000 + line` in the definition's positions, which `Diagnostic` decodes, so rule diagnostics reported later (a page template's chain check) keep their section too.

**One save, one revision.** The editors show the sections as tabs and save them together with everything else of the holder in one request, so one save is one revision (§7.1):

- a template's single *Save template* sends the metadata, the CDL sections and **every** channel's source (`channelSources` of `PUT /{templateKind}/{uuid}`); adding or removing a channel only stages it until that save. The per-channel endpoints (`PUT`/`DELETE …/channels/{channelKey}`) remain in the API; the UI no longer uses them;
- a dataset's *Save dataset* sends the sections and every record template (as before, M25);
- a property set's single *Save* sends a schema change with the values edited against the stored schema (`PUT /globals/{uuid}/schema` with `content`): the values are saved as `PUT …/content` would, then migrated into the new schema, in one version. Values alone still go to `PUT …/content`, which an `EDITOR` may call.

---

## 15. Output channels

### 15.1 Concept

A channel is a named render target. `html` is created with every project and cannot be deleted (only disabled); further channels (`markdown`, `amp`, `rss`, `json`) are fully CRUD-managed.

### 15.2 Model

```
output_channel
  id                bigserial PK
  project_id        FK project
  key               varchar(40)   -- [a-z][a-z0-9_]{1,39}, unique per project
  name              varchar(100)
  file_extension    varchar(10)   -- "html", "md"
  mime_type         varchar(100)
  default_escaping  varchar(20)   -- HTML | MARKDOWN | NONE
  enabled           boolean
  is_default        boolean
  position          int
  settings          json          -- output path settings; other keys stored as sent
  UNIQUE (project_id, key)
```

`settings` example:

```json
{
  "indexUid": "index",
  "indexFileName": "index.html",
  "urlStrategy": "RELATIVE",
  "trailingSlash": false,
  "prettyPrint": true,
  "minify": false,
  "lineEnding": "LF",
  "charset": "UTF-8"
}
```

Generation, the URL registry and preview navigation links read a channel's output configuration as `ChannelOutputSettings`. Only these values are honored:

| Field | Default | Effect |
|---|---|---|
| `file_extension` (`fileExtension`) | `md` for key `markdown`, otherwise the channel key | `{ext}` in output paths (§18.3) |
| `settings.indexUid` | `index` | UID of the page rendered as its folder's index |
| `settings.indexFileName` | `index.<ext>` | File name of a folder index; the index page's `{uid}` expands to its stem, and the PRETTY directory form writes into it |
| `settings.urlStrategy` | `RELATIVE` | `RELATIVE` or `PRETTY` |
| `settings.trailingSlash` | `false` | Only with `PRETTY`: `about.html` is written as `about/<indexFileName>` and linked as `about/`; the site-root index is linked as `./`. `PRETTY` without it behaves like `RELATIVE` |

`prettyPrint`, `minify`, `lineEnding` and `charset` are stored and returned but not applied.

`settings.highlightAs` (M33 follow-up) is read by the code editors only: how the channel's templates are highlighted — `AUTO` (or absent: the project's code highlighting overrides, then the built-in detection from `mimeType` and `fileExtension`, §24.5) or one of `HTML`, `MARKDOWN`, `JSON`, `XML`, `CSS`, `JAVASCRIPT`, `YAML`, `PLAIN`, which always wins.

**HTML channels (M30).** A channel whose `file_extension` is `html` or `htm` is an *HTML channel*: the build-time quality checks (§18.8) parse and check its outputs. Outputs of every other channel (Markdown, text) are never checked. A draft check (§19.4) of such a channel returns no findings and lists every enabled rule as skipped. Redirects (§18.9) are detected and written for every channel.

- **Validation.** Channel create and update reject malformed values with `400` `SF-API-0400` and a `fieldErrors` array of `{field, message}` (fields `fileExtension`, `settings`, `settings.urlStrategy`, `settings.indexFileName`, `settings.indexUid`, `settings.trailingSlash`, `settings.highlightAs`): `fileExtension` must match `[a-z0-9]{1,10}`, `urlStrategy` must be `RELATIVE` or `PRETTY`, `indexFileName` must match `[A-Za-z0-9._-]{1,64}`, `indexUid` must be a string, `trailingSlash` a boolean and `highlightAs` one of `AUTO` and the formats above. Blank values fall back to the defaults. Unknown keys are kept. An update without `settings` keeps the stored settings. Channels arriving through project import are parsed leniently: unusable values fall back to defaults.
- **Live configuration.** Channel settings are not revision-pinned: generating an older revision uses the current settings.
- **Changing settings.** An update that changes `fileExtension` or `settings` records a `CHANNEL` entry in its revision summary; channel creation records one too. An `INCREMENTAL` generation that finds such an entry after its last successful run is planned as `FULL` (the run keeps its requested mode). When the resulting `ChannelOutputSettings` differ, the channel's URL registry entries that are not manual overrides are deleted in the same transaction, so they are recomputed with the new paths; overrides are kept. Channels added by project import carry no summary entry and do not trigger this.

### 15.3 CRUD API

| Method | Path | Role |
|---|---|---|
| `GET` | `/projects/{p}/channels` | VIEWER |
| `POST` | `/projects/{p}/channels` | DEVELOPER |
| `PUT` | `/projects/{p}/channels/{key}` | DEVELOPER |
| `DELETE` | `/projects/{p}/channels/{key}` | PROJECT_ADMIN |
| `POST` | `/projects/{p}/channels/{key}/enable` \| `/disable` | DEVELOPER |

Deleting a channel is blocked while channel templates exist for it; the response lists them. The UI offers "delete channel and its N templates" as an explicit second step (one revision).

### 15.4 Adding a channel

Creating channel `markdown` immediately makes a new tab appear in every template's OCTL editor. Templates without a markdown body render nothing for that channel and produce build warning `SF-GEN-0210`. A **Copy from channel** action seeds the new channel template from an existing one so developers start from working markup.

---

## 16. Output channel template language (OCTL)

### 16.1 Design principles

- **Text-first.** A template is the target format with CMS instructions embedded — a designer can paste HTML and it works.
- **Unmistakable delimiters.** Every instruction is `$CMS_…$`; nothing else is interpreted, so `{{`, `<%`, `${}` from other toolchains pass through untouched.
- **Safe by default.** Values are escaped for the channel's `default_escaping` unless explicitly opted out.
- **No arbitrary code.** No Java calls, no reflection, no I/O. The language is total: every construct terminates.

### 16.2 Syntax overview

| Construct | Meaning |
|---|---|
| `$CMS_VALUE(editorName)$` | Value of an editor in the current scope |
| `$CMS_VALUE(assetType:uid.editorName)$` | Value from another asset's root value object (see §16.4); dotted paths, conditions, loops and filters work as for local values |
| `$CMS_VALUE(assetType:uid)$` | The whole value object of another asset; stringifies to nothing useful and warns (`SF-TPL-0111`) — except `recordset:uid`, below |
| `$CMS_VALUE(recordset:uid)$` | Renders a record set (M25): the records its stored query selects, each through the dataset's record template for the channel; a `reference` editor value pointing at a set renders the same way (`$CMS_VALUE(featured)$`). No record template for the channel → empty with `SF-GEN-0241`; a stored query that no longer validates → empty with `SF-GEN-0240`. A set has no URL (`$CMS_REF(recordset:uid)$` is `SF-TPL-0105`) |
| `$CMS_REF(assetType:uid)$` | Resolved URL/href to another asset in the current channel |
| `$CMS_REF(editorName)$` | Resolved URL for a `link`/`media`/`reference` editor value. A link to no asset renders its own target, escaped: `EXTERNAL` its `url` (a scheme other than `http`, `https`, `mailto`, `tel` renders empty), `MAIL` `mailto:` + the address, `ANCHOR` `#anchor` |
| `$CMS_BODY(name)$` | Renders a page body (page templates only) |
| `$CMS_INCLUDE(section_template:uid)$` | Renders another template inline |
| `$CMS_NAV(structure:uid)$` | Renders a navigation |
| `$CMS_IF(expr)$ … $CMS_ELSEIF(expr)$ … $CMS_ELSE$ … $CMS_END_IF$` | Conditional |
| `$CMS_FOR(item : listEditor)$ … $CMS_END_FOR$` | Iteration over `list` editors and nav nodes |
| `$CMS_FOR(item : dataset:uid, where="…", sort="…", limit=n, offset=n, folder="…")$ … $CMS_END_FOR$` | Iteration over a dataset's records (M19): `where` is an OCTL expression over `item.<field>` and the render scope, `sort` a comma list of fields with `-` for descending; all arguments optional, applied folder → where → sort → offset → limit (`SF-TPL-0140`–`0142`) |
| `$CMS_FOR(item : recordset:uid, where="…", sort="…", limit=n, offset=n)$ … $CMS_END_FOR$` | Iteration over a record set's selected records (M25): the set's query runs first, then the arguments narrow its result — `where` AND-ed, `sort` re-sorts stably, `offset`/`limit` slice; `folder` is `SF-TPL-0140`. Also over a `reference` editor holding a set: `$CMS_FOR(item : featured, …)$` |
| `$CMS_VALUE(record:uid.editorName)$` | A record's value; a `reference` editor value pointing at a record dereferences the same way (`author.name`) |
| `$CMS_SET(name = expr)$` | Local variable in the current scope |
| `$CMS_META(key)$` | Page/system metadata (`uid`, `uuid`, `displayName`, `path`, `revision`, `channel`, `now`, `projectKey`; `noIndex` — the page's `nav.noIndex` in the render language, `true`/`false`, M30). `CMS_META` is also a read-only expression root (M30): `$CMS_IF(CMS_META.noIndex)$…$CMS_END_IF$`; a `$CMS_SET` or loop variable of that name is `SF-TPL-0163` |
| `$CMS_COMMENT$ … $CMS_END_COMMENT$` | Not emitted |
| `$CMS_EXTENDS(page_template:uid)$` | This page template extends a layout (§13.3). First instruction (whitespace and comments may precede it), once; outside its top-level blocks a template that extends may contain only `$CMS_SET` and comments |
| `$CMS_BLOCK(name)$ … $CMS_END_BLOCK$` | A named region. Renders its most-derived definition along the inheritance chain; without a chain, its own body. Blocks may nest and are looked up by name |
| `$CMS_PARENT$` | Inside a block of a template that extends: the next less-derived definition of that block; empty at the root |
| `$$` | Literal `$` |

### 16.3 Filters

Piped, left to right, inside the parentheses:

```
$CMS_VALUE(headline | upper | truncate(40) | html)$
```

Built-in filters: `html`, `attr`, `js`, `url`, `raw`, `upper`, `lower`, `capitalize`, `trim`, `truncate(n[,suffix])`, `default("…")`, `date("pattern")`, `number("pattern")`, `stripTags`, `nl2br`, `md` (markdown → HTML), `plain` (HTML → text), `json`, `slug`, `join(", ")`, `size`.

The channel's `default_escaping` is applied automatically as the final step unless the chain already contains an escaping filter or `raw`. `raw` on a richtext editor is the normal case and does not warn; `raw` on a `text` editor produces build warning `SF-GEN-0301`.

### 16.4 Reference syntax `assetType:uid`

`assetType` is one of `page`, `media`, `section_template`, `page_template`, `folder`, `page_reference` (the lowercase asset type), `nav` (a navigation folder, resolved through its navigation reference UID), `global` (a `GLOBAL_SET` property set), `dataset` and `record` (M19), or `recordset` (a `RECORD_SET`, M25 — the enum-derived `record_set` is not accepted). `uid` is the asset's UID within the current project. `AssetReferencePrefixes` is the single registry of these prefixes for template save, preview and generation.

At **compile time** the reference is resolved to a UUID; the compiled template stores the UUID. On **template save** every resolved reference of every channel source is recorded in `asset_reference` as an `OCTL_VALUE`, `OCTL_REF` or `OCTL_INCLUDE` edge (§5.4). Consequences:

- Renaming an asset's UID does not break already-compiled templates, but the *source* still shows the old UID — the UID-change API therefore reports affected templates (§6.4).
- An unresolvable UID is a **compile error** (`SF-TPL-0110`), not a silent empty string, so broken references cannot reach production.
- A generation run without an explicit revision is pinned to the project's head revision, so its snapshot is identical to a pinned run's and includes soft-deleted versions. A cross-asset value whose target is soft-deleted renders empty with warning `SF-TPL-0112` (preview and generation alike); `$CMS_REF`, `$CMS_INCLUDE` and body sections pointing at a deleted asset render empty with warning `SF-GEN-0220` in generation.
- **Unreleased = absent (M27).** Generation renders the released view (§5.5): an asset not released in the render language is absent exactly where a deleted one is — pages, outputs, navigation, sitemap, robots, redirects, `search-index.json`, dataset and record-set loops, pagination sources, global values, media copies. A link to it — `$CMS_REF`, a `media` or `link` editor value — renders empty with warning `SF-GEN-0221` "Reference to an unreleased asset" (one per target, page and language), never with the missing-page error; a cross-asset value of it reads as a deleted target (empty, `SF-TPL-0112`). Templates — and so `$CMS_INCLUDE` and body section templates — are live: they need no release.
- **Missing targets are findings, not failures (M30).** A link (`$CMS_REF`, a `media` or `link` editor value, a folder link) whose target page, media or folder uuid isn't in the snapshot at all renders `""` without a render warning; before M30 a missing page failed the whole run with `SF-GEN-0204`. During RENDER the renderer records every reference it could not resolve as a *reference event* of the output being rendered — `MISSING`, `DELETED` (the `SF-GEN-0220` cases, a deleted section template included) or `UNRELEASED` (the `SF-GEN-0221` cases) — with the target and, when the link comes from a field, the editor path. The CHECK stage turns them into findings on the linking page: `SF-CHK-0101` (missing), `SF-CHK-0105` (deleted), `SF-CHK-0104` (unreleased) (§18.8). The `SF-GEN-0220`/`0221` warnings stay, so such a run is still `PARTIAL`; `SF-GEN-0204` remains for real render failures.

**Cross-asset values.** `$CMS_VALUE(assetType:uid.path)$`, and an asset accessor in `$CMS_IF`, `$CMS_SET` or a `$CMS_FOR` source (other than `nav:`), read the target's **root value object** and walk `path` over it exactly like a local value: dotted paths, truthiness, loop variables and filters behave identically, and escaping follows the channel default unless `raw` is used. Generation reads the revision-pinned snapshot (`SnapshotAssetValueResolver`); preview reads the version valid at the preview revision, live or time travel (`LiveAssetValueResolver`). Both project through the same function (`AssetValueProjection`), so they cannot disagree:

| Target type | Root value object |
|---|---|
| `page` | The page's editor values (`payload.content`); `bodies`, `nav`, `output` and `meta` are not exposed |
| `media` | `altText`, `caption`, `copyright`, `fileName`, `mimeType`, `sizeBytes`, `focalPoint`, and from the image metadata `width`, `height`, `orientation`, `dominantColor`; blob hashes and variants are not exposed |
| `page_reference` | `label` |
| `global` | The property set's values (`payload.content`); its CDL is not exposed |
| `record` | The record's values plus `_uuid`, `_uid`, `_displayName`, `_folderPath`, `_recordSet`, `_changedAt` — the item a dataset loop binds |
| `recordset` | `{records, _count, _meta: {uid, displayName, dataset}}`: the records the set's stored query selects in the render language (M25). Built by the renderer, not by `AssetValueProjection`, because the selection depends on the language |
| `section_template`, `page_template`, `folder`, `dataset` | No values |

Every root value object also carries the reserved `_meta` object with `uid` and `displayName` (`$CMS_VALUE(page:about._meta.displayName)$`). A value object is raw stored JSON, never rendered output, so reading one cannot trigger a render; a `catalog` value read this way renders its cards through the current page's block resolver, bounded by the include cycle guard (§16.10). Lookups are scoped to the rendering project, and a target whose type does not match the prefix is treated as missing.

- A missing or soft-deleted target renders empty and emits `SF-TPL-0112` once per reference per render. Preview discards render warnings; in generation the warning is reported in the run's diagnostics and the run ends `PARTIAL`.
- `$CMS_VALUE(assetType:uid)$` without a path is compile warning `SF-TPL-0111`. `$CMS_REF(assetType:uid)$` and conditions such as `$CMS_IF(page:about)$` are path-less by nature and do not warn.
- The page that reads another asset's value has no edge of its own; its template holds the `OCTL_VALUE` edge, and an incremental build reaches the page from the changed target through that template's edges (`OCTL_VALUE`, then `OCTL_INCLUDE`/`TEMPLATE`).

`$CMS_REF` resolves to:

A `$CMS_REF` on another asset *with* a value path (`$CMS_REF(page:about.heroImage)$`, `$CMS_REF(CMS_GLOBAL.site.logo)$`) resolves the link held by that editor, exactly like a local `$CMS_REF(editorName)$`; the linked media is a dependency of the rendering page. A path-less `$CMS_REF(global:site)$` is `SF-TPL-0105`, since a property set has no URL of its own.

| Target | Result |
|---|---|
| `page` | Output path of that page in the current channel, according to the channel URL strategy |
| `media` | Public path of the media file (optionally `?variant=w800`) |
| `folder` | URL of the folder's **index page** (§10.2: its page with the channel's `indexUid` in the render language's view), page 1, relative to the rendering page and following the URL strategy (`index.html`, `./` or `products/` with pretty URLs); without an index page the folder's directory URL (`OutputPathExpander.folderUrl`: `{locale}/{folder}/`, the site root as `./`). Never contains `pages_root/` |

`$CMS_REF(media:logo_svg, variant="w400")$` selects a variant. `$CMS_REF(page:about, locale="en")$` links the page in another of the project's languages; a language the project doesn't declare, or an empty value, links it in the render language (generation and preview alike).

**Argument values (M32).** A quoted argument value is literal. An unquoted one is a path evaluated when the reference renders, in the same scope as `$CMS_VALUE`: a loop or `$CMS_SET` variable, an editor, a cross-asset or `CMS_GLOBAL` value. An object with a textual `code` — a `CMS_LOCALES` item — passes its code, any other scalar its text, so a language loop links another page in every language:

```
$CMS_FOR(l : CMS_LOCALES)$<a href="$CMS_REF(page:about, locale=l)$" hreflang="$CMS_VALUE(l.code)$">$CMS_VALUE(l.label)$</a>$CMS_END_FOR$
```

`locale=l.code` is the same. A single unquoted word that resolves to nothing keeps its literal meaning (`variant=w400`, `locale=de-CH`), so templates written before stay valid; any other path that yields nothing, an empty text, a list or an object without `code` leaves the argument out. A dotted path is compile-checked like a value (`SF-TPL-0103` for an unknown editor, `SF-TPL-0110` for an unresolvable asset), and a cross-asset path records an `OCTL_VALUE` edge. Only `$CMS_REF` evaluates argument values; the arguments of `$CMS_INCLUDE`, `$CMS_NAVIGATION` and `$CMS_FOR` stay literal.

### 16.5 Scopes

| Scope | Available identifiers |
|---|---|
| Section channel template | its own editors, `$CMS_META`, `$CMS_PAGE.*` (read-only access to the enclosing page's editors), loop variables |
| Page channel template | its own editors, bodies, `$CMS_META`, loop variables |
| Navigation renderer | nav node fields (`label`, `href`, `active`, `level`, `children`, `page`) |
| List loop | `item.<itemEditorName>`, `item._index`, `item._first`, `item._last`, `item._count` |
| Dataset record template (M25) | the record's fields as top-level names, `_uuid`, `_uid`, `_displayName`, `_folderPath`, `_recordSet`, `_changedAt`, `_meta`, the position `_index`, `_first`, `_last`, `_count`, `$CMS_META`, `CMS_PAGE`, `CMS_GLOBAL`, loop variables; no `$CMS_EXTENDS`/`$CMS_BLOCK`/`$CMS_PARENT`/`$CMS_BODY` (`SF-TPL-0122`) |

`$CMS_PAGE.headline$` inside a section reads the enclosing page's `headline` editor — a controlled, read-only upward reference; sections never write.

`CMS_PAGINATION.*` (M21) is available in the page and section channel templates of a paginated page: `items`, `current`, `total`, `pageSize`, `itemCount`, `firstHref`, `prevHref`, `nextHref`, `lastHref`, `canonicalHref`, `pages[]`. It is read-only (`SF-TPL-0163` for a `$CMS_SET`/loop variable of that name), missing on any other page, and not available in text media. `$CMS_META(pageNumber|totalPages)$` mirror `current`/`total`.

`CMS_GLOBAL.<set>.<path>` is available in every channel template scope and reads a global property set. It is an accessor root used inside `$CMS_VALUE`, `$CMS_IF`, `$CMS_SET`, `$CMS_FOR` and `$CMS_REF`, not an instruction: `$CMS_VALUE(CMS_GLOBAL.site.title)$`. The compiler treats it as exactly `global:<set>.<path>` (§16.4). `CMS_GLOBAL` without a set is `SF-TPL-0105`.

### 16.6 Example — section channel template (HTML)

```html
<section class="teaser teaser--$CMS_VALUE(layout)$" id="sec-$CMS_META(instanceId)$">
  $CMS_IF(kicker)$
    <p class="teaser__kicker">$CMS_VALUE(kicker)$</p>
  $CMS_END_IF$

  <h2 class="teaser__headline">$CMS_VALUE(headline)$</h2>

  $CMS_IF(heroImage)$
    <img class="teaser__image"
         src="$CMS_REF(heroImage, variant="w1600")$"
         srcset="$CMS_REF(heroImage, variant="w800")$ 800w,
                 $CMS_REF(heroImage, variant="w1600")$ 1600w"
         sizes="(max-width: 60rem) 100vw, 60rem"
         width="$CMS_VALUE(heroImage.width)$"
         height="$CMS_VALUE(heroImage.height)$"
         alt="$CMS_VALUE(heroImage.altText | attr)$"
         loading="lazy">
  $CMS_END_IF$

  <div class="teaser__body">$CMS_VALUE(body | raw)$</div>

  $CMS_IF(showCta && ctaLabel)$
    <a class="button" href="$CMS_REF(relatedPage)$">$CMS_VALUE(ctaLabel)$</a>
  $CMS_END_IF$

  $CMS_IF(links | size > 0)$
    <ul class="teaser__links">
      $CMS_FOR(link : links)$
        <li class="teaser__link$CMS_IF(link._first)$ is-first$CMS_END_IF$">
          <a href="$CMS_REF(link.target)$">$CMS_VALUE(link.label)$</a>
        </li>
      $CMS_END_FOR$
    </ul>
  $CMS_END_IF$
</section>
```

### 16.7 Example — same section, Markdown channel

```
$CMS_IF(kicker)$_$CMS_VALUE(kicker)$_

$CMS_END_IF$## $CMS_VALUE(headline)$

$CMS_IF(heroImage)$![$CMS_VALUE(heroImage.altText)$]($CMS_REF(heroImage)$)

$CMS_END_IF$$CMS_VALUE(body | plain)$

$CMS_FOR(link : links)$- [$CMS_VALUE(link.label)$]($CMS_REF(link.target)$)
$CMS_END_FOR$
```

### 16.8 Example — page channel template (HTML)

```html
<!doctype html>
<html lang="$CMS_META(language)$">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>$CMS_VALUE(title)$ — $CMS_META(projectName)$</title>
  <meta name="description" content="$CMS_VALUE(metaDescription | attr)$">
  <link rel="stylesheet" href="$CMS_REF(media:main_css)$">
  $CMS_IF(canonical)$<link rel="canonical" href="$CMS_REF(canonical)$">$CMS_END_IF$
</head>
<body class="page page--$CMS_META(uid)$">
  <a class="skip-link" href="#main">Skip to content</a>

  <header class="site-header">
    <a class="site-header__logo" href="$CMS_REF(page:home)$">
      <img src="$CMS_REF(media:logo_svg)$" alt="$CMS_META(projectName)$" width="140" height="32">
    </a>
    $CMS_NAV(structure:main_navigation)$
  </header>

  <main id="main">
    $CMS_BODY(main)$
  </main>

  <aside class="sidebar">$CMS_BODY(sidebar)$</aside>

  <footer class="site-footer">
    $CMS_NAV(structure:footer_navigation)$
    <p>© $CMS_META(now | date("yyyy"))$ Acme</p>
  </footer>
</body>
</html>
```

### 16.9 Grammar (EBNF, abridged)

```ebnf
template      = { text | instruction } ;
instruction   = "$CMS_" , ( value | ref | body | include | nav | control | meta | set | comment
                          | extends | block | parent ) , "$" ;

value         = "VALUE(" , accessor , { "|" , filter } , [ "," , namedArgs ] , ")" ;
ref           = "REF("   , accessor , [ "," , namedArgs ] , ")" ;
body          = "BODY("  , identifier , ")" ;
include       = "INCLUDE(" , assetRef , [ "," , namedArgs ] , ")" ;
nav           = "NAV("   , assetRef , [ "," , namedArgs ] , ")" ;
extends       = "EXTENDS(" , "page_template" , ":" , uid , ")" ;
block         = "BLOCK(" , identifier , ")$" , template , "$CMS_END_BLOCK" ;
parent        = "PARENT" ;

accessor      = assetRef | path ;
assetRef      = assetType , ":" , uid , [ "." , path ] ;
path          = identifier , { "." , identifier } ;
assetType     = "page" | "media" | "section_template" | "page_template" | "folder" | "page_reference" | "nav" ;

control       = ifBlock | forBlock ;
ifBlock       = "IF(" , expr , ")$" , template ,
                { "$CMS_ELSEIF(" , expr , ")$" , template } ,
                [ "$CMS_ELSE$" , template ] , "$CMS_END_IF" ;
forBlock      = "FOR(" , identifier , ":" , accessor , ")$" , template , "$CMS_END_FOR" ;

expr          = orExpr ;
orExpr        = andExpr , { "||" , andExpr } ;
andExpr       = cmpExpr , { "&&" , cmpExpr } ;
cmpExpr       = unary , [ ( "==" | "!=" | "<" | ">" | "<=" | ">=" | "in" | "contains" | "startsWith" | "endsWith" ) , unary ] ;
unary         = [ "!" ] , ( literal | accessorWithFilters | "(" , expr , ")" ) ;
filter        = identifier , [ "(" , argList , ")" ] ;
```

Truthiness: `null`/absent → false; empty string/list/object → false; `0` → false; everything else true.

`a in b` is true when list `b` has an element equal to `a`, or text `b` contains `a`; `a contains b` is `b in a`. `a startsWith b` / `a endsWith b` is true when both are text and `a` begins / ends with `b`. All four are case-sensitive (use `| lower`) and false for a missing value. The same operators work in `$CMS_IF`, `$CMS_SET` and a dataset or record set `where`.

### 16.10 Engine implementation

```
OCTL source ──lex──▶ tokens ──parse──▶ AST ──resolve refs──▶ CompiledTemplate (immutable)
                                                                    │
                                       RenderContext ───render──────┘──▶ output string + collected deps
```

- Generation and preview compile through `CompiledTemplateCache` (per-build memo and cross-request cache, §21.5), so a template version is not recompiled per page. Template save compiles uncached.
- Rendering is a stack-machine walk with an output `StringBuilder` sized from the previous render of the same template (adaptive).
- Guard rails (`RenderBudget`, one per page render): max nesting depth 32 below the page template (`SF-TPL-0130`), max loop iterations 100,000 (`SF-TPL-0131`), max output size 32 MB (`SF-TPL-0132`), wall-clock budget 5 s (`SF-TPL-0133`). Body sections, `$CMS_INCLUDE`d sections and catalog cards render inside the page's budget, so depth counts every nesting level and the loop, output and time limits apply to the whole page render, not to each nested template.
- Cycle guard: rendering a template that is already being rendered further up the chain (`a → b → a`, through an include, a body section or a catalog card) fails with `SF-TPL-0135` and the chain in the message. The check runs before the depth check. The same template rendered twice side by side is not a cycle.
- Exceeding a limit fails only that page in generation: the diagnostic names the page and channel, the other pages render and are published, and the run ends `PARTIAL` (the same as a page held back with `SF-GEN-0120`, and as `SF-GEN-0203` oversized file and `SF-GEN-0205` per-page timeout). Run-level errors still fail the run: template VALIDATE errors, `SF-GEN-0110` path collisions, `SF-GEN-0204` and `SF-GEN-0206`. Preview returns a `422` problem carrying the diagnostic's code.
- Rendering is side-effect free and thread-safe → pages render in parallel on virtual threads.
- Inheritance (M20): `OctlCompiler.compile(source, channel, resolver, ownDefinition, Inheritance)` loads each ancestor through a `ParentTemplateLoader` (snapshot-backed in generation, live or revision-pinned in save, validate and preview), compiles it once per build or request (`ChainCompileMemo`), and links a `CompiledTemplate` whose layout nodes are the root's, with a block table (name → definitions, most-derived first), the chain's child-level `$CMS_SET`s, the union of references, and a hash over every layer. The compile cache re-checks each ancestor's version on a hit, so a parent edit never serves a stale layout. Ancestor UUIDs are render dependencies.

### 16.11 Diagnostics

| Code | Severity | Meaning |
|---|---|---|
| `SF-TPL-0101` | error | Unknown instruction |
| `SF-TPL-0102` | error | Unbalanced block (`$CMS_END_IF$` missing) |
| `SF-TPL-0103` | error | Unknown editor name in this scope |
| `SF-TPL-0104` | error | Unknown filter |
| `SF-TPL-0105` | error | `CMS_GLOBAL` without a property set, or `$CMS_REF` on a property set without an editor path |
| `SF-TPL-0110` | error | Unresolvable asset reference |
| `SF-TPL-0111` | warning | Cross-asset `$CMS_VALUE(assetType:uid)$` without an editor path |
| `SF-TPL-0112` | warning (render) | Cross-asset value target missing or soft-deleted; renders empty |
| `SF-TPL-0120` | error | `$CMS_BODY` used in a section template |
| `SF-TPL-0121` | error | Processed text media: `$CMS_BODY`, `$CMS_INCLUDE`, leaf `$CMS_NAVIGATION` or `CMS_PAGE` (§16.12) |
| `SF-TPL-0130` | error (render) | Nesting depth above 32 below the page template |
| `SF-TPL-0131` | error (render) | Loop iterations above 100,000 in one page render |
| `SF-TPL-0132` | error (render) | Output above 32 MB in one page render |
| `SF-TPL-0133` | error (render) | Page render exceeded the 5 s time budget |
| `SF-TPL-0135` | error (render) | Include cycle (`a → b → a`) |
| `SF-TPL-0150` | error | `$CMS_EXTENDS` not first, nested, or repeated |
| `SF-TPL-0151` | error | Content outside top-level blocks in a template that extends |
| `SF-TPL-0152` | error | Invalid or duplicate block name |
| `SF-TPL-0153` | error | `$CMS_PARENT$` outside a block, without `$CMS_EXTENDS`, or with arguments |
| `SF-TPL-0154` | error | Inheritance cycle (`a → b → a`) |
| `SF-TPL-0155` | error | Inheritance chain deeper than 8 |
| `SF-TPL-0156` | error | `$CMS_EXTENDS` target isn't `page_template:`, or used in a section template |
| `SF-TPL-0157` | warning | Override of a block no ancestor defines ("did you mean") |
| `SF-TPL-0158` | error | Ancestor has no template for the channel |
| `SF-TPL-0159` | error | Channels extend different parents |
| `SF-TPL-0160` | error | Ancestor has compile errors (reported once with its uid) |
| `SF-TPL-0161` | error | Parent can't be loaded (not a live page template, or no loader in this context) |
| `SF-TPL-0162` | error | Block contains itself through nesting or overrides |
| `SF-TPL-0201` | warning | Body declared but never rendered |
| `SF-TPL-0301` | warning | `raw` filter on a plain-text editor |
| `SF-TPL-0310` | warning | Editor declared in CDL but never used in any channel template |
| `SF-TPL-0320` | warning | Processed text media: `$$` is output as `$` (per occurrence outside `$CMS_COMMENT$`) |
| `SF-TPL-0321` | warning | Processed JS/JSON: `$CMS_VALUE` without an escaping filter |

### 16.12 Text media context (M18)

A media file with `processCms` (§11.3) is OCTL source rendered in a context that belongs to no page:

- **Compile.** Against a content definition with no editors or bodies. `$CMS_BODY`, `$CMS_INCLUDE`,
  the leaf form of `$CMS_NAVIGATION` (it emits HTML) and `CMS_PAGE` are `SF-TPL-0121`; `$CMS_VALUE`,
  `$CMS_REF`, `$CMS_IF`, `$CMS_FOR` (including `nav:` sources), `$CMS_SET`, `$CMS_META`,
  `$CMS_COMMENT` and the block form of `$CMS_NAVIGATION` are allowed. Every `$$` outside a comment is
  an `SF-TPL-0320` warning, and a JS/JSON `$CMS_VALUE` without `js`, `json`, `attr`, `url`, `html` or
  `raw` is an `SF-TPL-0321` warning. Warnings never block a save.
- **Render.** Once per generation run, in the project's **default channel**, with escaping `NONE`;
  `$CMS_META` offers `uid`, `uuid`, `displayName`, `path` (the media output path), `revision`,
  `channel`, `projectKey` and `mimeType`; cross-asset values and globals resolve as for pages. Links
  are relative to the media file's own output path (§18.3 rule for pages). Output goes to the media's
  normal path `assets/media/{uid}.{ext}`.
- **References.** The source's resolved references are `OCTL_*` edges of the media asset with
  source path `source`, written in the save's revision (§5.4) and closed when the flag goes off, so
  usages, delete protection and incremental planning cover them. The UID-change report scans processed
  sources for the old uid literally, like template sources.

---

## 17. Structure & navigation

### 17.1 The `structure` asset

A structure asset declaratively defines (a) which pages form a navigation and (b) how it is rendered per channel.

```
navigation {
  source {
    root      page:home           # or folder:/products/
    depth     3
    include   pages where nav.visible == true
    exclude   pages where nav.noIndex == true
    order by  nav.position asc, displayName asc
    expand    activePathOnly       # all | activePathOnly | none
  }

  node {
    label     coalesce(nav.label, displayName)
    href      ref(page)
    active    isCurrentPage
    trail     isAncestorOfCurrentPage
  }
}
```

Per-channel renderers live in the same asset's `channelTemplates`, exactly like other templates:

```html
<nav class="nav" aria-label="Main">
  <ul class="nav__list nav__list--level-$CMS_VALUE(level)$">
    $CMS_FOR(node : nodes)$
      <li class="nav__item$CMS_IF(node.active)$ is-active$CMS_END_IF$$CMS_IF(node.trail)$ is-trail$CMS_END_IF$">
        <a class="nav__link" href="$CMS_VALUE(node.href)$"
           $CMS_IF(node.active)$aria-current="page"$CMS_END_IF$>$CMS_VALUE(node.label)$</a>
        $CMS_IF(node.children | size > 0)$
          $CMS_NAV_RECURSE(node)$
        $CMS_END_IF$
      </li>
    $CMS_END_FOR$
  </ul>
</nav>
```

`$CMS_NAV_RECURSE(node)$` re-enters the same renderer with the child list and `level + 1`.

### 17.2 Navigation computation

1. Resolve `root` to a folder or page and collect the subtree from the **generation snapshot** (a revision-pinned in-memory index).
2. Apply `include`/`exclude` predicates against page `nav.*` fields and metadata.
3. Sort per `order by`.
4. Cut at `depth`.
5. Mark `active` / `trail` relative to the page being rendered.
6. Render once per page (results memoized per `(structureUuid, channel, activePageUuid)` within a build).

Cycle protection: the tree walk tracks visited UUIDs; a cycle yields `SF-GEN-0410` and truncates the branch.

**Released navigation (M27).** Generation computes navigation over the released view of the render language: folders, page references and target pages as released there. A page reference whose target page isn't released in the language is left out of that language's navigation (not a dangling-reference error); an unreleased reference or folder is absent like a deleted one. The published preview (§19.1) computes navigation the same way at the preview revision.

**Folders resolve to their index page (M31).** A page reference whose target is a pages folder (`FOLDER` kind), and a navigation folder entry whose `startNode` chain ends in such a reference, resolve to a page through `NavigationService.firstNavigablePage`: the folder's **index page** (§10.2 — with a channel, its page with that channel's `indexUid`) first, else its own direct pages in navigation order, else its subfolders depth-first — each subfolder again preferring its own index page. So a navigation entry for a folder links the page written as the folder's `index.html`. Channel-less lookups (the Navigation screen's tree and resolve endpoints, pagination sources, page-reference validation) know no index page: the `indexUid` needs a channel.

### 17.3 Other structure uses

The same asset type also backs breadcrumbs, sitemaps and index listings; `navigation`, `breadcrumb`, `list` are the three declarable `kind` values, sharing the source/order/filter grammar.

---

## 18. Generation pipeline

### 18.1 Trigger and scope

| Trigger | Scope | Actor |
|---|---|---|
| `POST /projects/{p}/generations` | full or incremental | DEVELOPER / PROJECT_ADMIN; EDITOR per the publish policy (below, M28) |
| Save (auto) | preview only, in-memory | any editor |
| Scheduled (M27) | one-off or recurring (cron) generation, or "then generate" after a scheduled release — §18.7 | the schedule's owner |

Request body:

```json
{
  "mode": "INCREMENTAL",
  "revision": null,
  "channels": ["html", "markdown"],
  "targetId": 3,
  "folderPath": "/products/",
  "assetUuids": [],
  "comment": "Autumn campaign live"
}
```

A request without `mode` is a `FULL` run; one without `targetId` goes to the default target (else the first one).

`revision: null` means "current". Passing a revision generates the site **as it was** — its drafts of live types and its release state (§5.5) — which is the mechanism behind reproducible republishing and rollback verification.

**Saving changes nothing online (M27).** A build renders released versions only; a release, unpublish or discard is a state change and starts no build. The site changes with the next run — started by hand, by a schedule, or by a scheduled release's "then generate".

The scope — `folderPath`, `assetUuids` — limits the pages a run renders: pages in `folderPath` (and below) or listed in `assetUuids`; with both, either qualifies. A scoped run publishes its pages on top of the build the target serves, so the rest of the site stays online (§18.4).

**Who may start which run (M28).** `GenerationAuthorization.requiredFor(project, mode, targetId, revision)` decides, for the generation endpoints and a scheduled release's "then generate" alike:

| Request | Needs |
|---|---|
| `revision` set (rendering the past is rollback-like) | `DEVELOPER`, whatever the policy |
| `mode: INCREMENTAL` **explicitly**, `targetId` absent or the target an absent one resolves to (the default, else the first), scoped or not | `INCREMENTAL_BUILD` |
| anything else — a missing `mode` is `FULL`, another target | `FULL_BUILD` |

`VIEWER`s are refused at the annotation (`ROLE:EDITOR`); the body is checked next (`403` with the missing permission). An incremental request that the planner turns into a full plan (`fallbackCause`, e.g. after a channel settings change) still needs only `INCREMENTAL_BUILD`: the fallback is the system's decision. A target id of another project needs `FULL_BUILD` like any non-default id, so the answer reveals nothing. The dry run (`POST /generations/plan`) is authorized exactly like a start. **Cancel:** developers cancel any run; an editor holding `INCREMENTAL_BUILD` only a run they started — a scheduled run counts as started by the schedule's owner — and anyone else's run is `403` with `ROLE:DEVELOPER`. **Promote** stays `DEVELOPER`.

### 18.2 Stages

```
1  SNAPSHOT    Pin revision R. Load an immutable in-memory index of all assets at R,
               as one view per language: live types at R, releasable assets at
               the version released for that language at R (M27; an unreleased
               one is present as an absent marker, like a tombstone).
2  PLAN        Determine the file set:
               full        → every page × every enabled channel
               incremental → assets changed since the target's baseline
                             (live types: version or uid changes; releasable
                             types: release pointer changes per language, M27),
                             expanded over
                             asset_reference reverse edges (transitive;
                             navigation-affecting changes expand to all pages
                             that render that structure), plus any output the
                             base build lacks. Processed text media reached by
                             the walk is planned for re-rendering even when no
                             planned page links it (§16.12); like a page, a
                             merely reached one stops the walk.
               Every planned output records why (reason chain, below).
3  VALIDATE    Compile every needed template and resolve refs.
               ERROR-severity findings abort before any file is written.
               Run the generation scope of the editor rules per page and
               language on the snapshot (M33, §10.5): error + holdBack (every
               built-in) holds that page language back (SF-GEN-0120, run
               PARTIAL); error + fail fails the run after every page was
               validated (SF-GEN-0121, nothing rendered or published);
               warning/info become run diagnostics (SF-GEN-0122).
4  RENDER      Parallel over virtual threads (bounded by sf.generate.parallelism).
               Each unit: (page, channel) → rendered bytes. Reference edges come
               from save (§5.4); rendering does not write them. References the
               renderer can't resolve are recorded per output as reference
               events (M30, §16.4).
5  ASSETS      Copy referenced media (and requested variants) to the target.
               Content-addressed: unchanged blobs are skipped.
               Processed text media (§16.12) is rendered instead of copied, to
               the same path; the media it references joins the set
               transitively (a visited set ends cycles). A file that fails to
               compile or render is left out and the run is PARTIAL.
6  CHECK       (M30, §18.8) "Checking output": parse every HTML output of this
               run once, run the page rules, then the site rules over new and
               carried outputs. ERROR findings hold their page back
               (SF-GEN-0125, run PARTIAL); then the rules that look at held-back
               pages run, capped at WARNING. Detect automatic redirects on the
               final output set (§18.9).
7  POST        Per-target post-processors, in this order: prettify/minify HTML,
               sitemap.xml, robots.txt, search index JSON, then the redirect
               formats the target writes (§18.9): redirects.json, .htaccess,
               HTML stubs.
8  WRITE       Atomic publish into the target (§18.4). An incremental or scoped
               run publishes the whole site: the base build's unchanged files
               are carried forward, what went away is removed.
9  REPORT      Persist GenerationRun with counts, timings, diagnostics, the
               quality findings (§18.5) and — only when publishing succeeded —
               the new automatic redirects, in one transaction.
```

The SSE progress stream names the stages as above; `CHECK` reports "Checking output" and then "Checked N outputs: e errors, w warnings[; k held back]". Clients ignore stage names they don't know.

**Content validation (M33).** `RenderPipeline.validateContent` (replacing `incompletePages`) evaluates each planned page's effective definition — the page's content, its section instances and their section templates' rules — in the `generation` scope, once per page and language, with the project's `LocalizationContext`: localizable editors are checked per language as at release (before M33 the build checked without it), and a finding of another language doesn't hold back this language's output. Rules read the snapshot: `release.status` is `PUBLISHED` for a released page, `NEW` for an unreleased page rendered by a draft build; `global:` and `ref` read the snapshot's versions. Per finding:

- `error` with `onGeneration holdBack` (every built-in, and the rule default) — the page's outputs in that language are held back; one `SF-GEN-0120` per page and language lists `path (message)`; the run ends `PARTIAL`.
- `error` with `onGeneration fail` — VALIDATE still checks every page, then the run ends `FAILED` with one `SF-GEN-0121` per page, language and rule; nothing is rendered or published.
- `warning` / `info` — a run diagnostic `SF-GEN-0122` of that severity naming rule, page and language. A warning counts in `warning_count` and makes the run `PARTIAL` like any other build warning; an info is listed but neither counted nor affecting the status.

Structural findings don't block a build. The dry-run plan runs no rules.

**What a build withholds (M30).** Every page output the run planned but doesn't publish — held back for incomplete content (`SF-GEN-0120`), a render limit, a missing channel source, or a quality check (`SF-GEN-0125`) — is also left out of `sitemap.xml` and `search-index.json`. (Before M30, pages held back by `SF-GEN-0120` were still listed there although they had no file.) Held back means all outputs of that page in that channel and language, every page number of a paginated page.

**Baseline (M22).** An `INCREMENTAL` request builds on the build its target currently serves (the last published or the promoted one) when that build's manifest shows it holds every page in every requested channel. Changes are counted from the build's *consistent revision*: its own revision, or for a scoped build published on top of another, that build's consistent revision, so a scoped run never advances the baseline and a build of another target never counts. Otherwise the request plans a full build and says why (`fallbackCause`): `NO_COMPLETE_BUILD_FOR_TARGET`, `BASE_BUILD_MISSING` (gone, or published before builds had manifests), `CHANNEL_SETTINGS_CHANGED` (every page of that channel may have moved), `REVISION_BEFORE_BASELINE`, and since M30 `BASE_BUILD_WITHOUT_QUALITY_FACTS` (the base build's manifest names no checked rule configuration, `qualityFingerprint` — it was built before M30 — so its outputs' facts are unknown) or `QUALITY_RULES_CHANGED` (the project's rule configuration changed after the baseline — a `qualityRules` revision summary entry — or the base build was checked under a different configuration fingerprint (its manifest's `qualityFingerprint`), e.g. after an application update changed a rule). Clients tolerate cause names added later.

**Reason chains (M22).** The planner's walk (`RebuildExpansion`) is a breadth-first search seeded in UUID order over neighbours in a stable order, keeping the first edge each asset is reached by. Every planned asset therefore has a deterministic shortest chain back to the change that reached it — `page:about ← section_template:teaser (bodies.main[0].templateRef) ← media:hero (changed in r1842)` — and a `causeCount` of all changes reaching it. Root kinds: `FULL_BUILD`, `INCREMENTAL_FALLBACK_FULL` (with the cause), `EXPLICIT_SCOPE` (listed in `assetUuids`), `ASSET_CHANGED`, `ASSET_DELETED`, `ASSET_RELEASED` and `ASSET_UNPUBLISHED` (M27: a release pointer of the language opened or moved, or closed with the draft kept), `URL_CHANGED` (M32: the asset's registered URL changed since the base build — an override, a reset or an import; pages and media are found by comparing their paths with the base manifest, folders and wide resets by the registry's change log `url_registry_change` since the base build started; the asset renders again and so does every page linking it and the navigation showing it), `NOT_IN_BASE_BUILD` (nothing it depends on changed, but the base build lacks the output, e.g. the page was held back). Edges: `PAGE_TEMPLATE`, `SECTION_TEMPLATE`, `PARENT_TEMPLATE` (named `TEMPLATE` reference rows), `REFERENCE` (any other row, with its kind and source path), `NAVIGATION`, `DATASET_MEMBERSHIP` (a loop that may select the changed record), `PAGINATION_SOURCE`, `RECORD_SET_MEMBERSHIP` (a reader of the record's set whose stored query — and loop `where` — may select it before or after the change, M25), `RECORD_SET_QUERY` (a reader of a set whose stored query changed), `RECORD_TEMPLATE` (a reader rendering a set through its dataset's record template, when only the record templates changed). `RULE_REFERENCE` (M33): a page template, section template, dataset or property set whose `rules {}` read a property set via `global:<uid>` — materialized on save as `asset_reference` rows of kind `RULE_REFERENCE` (source path `rules.<name>`, `states.<path>` or `fills.<path>`) — so a change to that property set rebuilds the template's pages (chain `page ← page_template ← property set` with edges `PAGE_TEMPLATE ← RULE_REFERENCE`); such a set counts as used by the template (delete protection, usages). Assets read via `ref(value)` need no extra edge: `ref` reads editor values (`media`, `link`, `reference`) that are already `MEDIA_REF`/`CONTENT_REF` rows, so a change to them reaches the page over `REFERENCE`. Names are served as strings; clients tolerate names added later.

**Released planning (M27).** Saving plans nothing: only releases change output. The planner walks once per language, seeded by that language's pointer changes in `(baseline, R]` (own key, else `""`), with the release revision as root revision; the "before" version of a releasable root is its released version at the baseline. Plan entries carry their `locale`. The walk's edges are the edges valid at R plus the edges of released versions that are no longer their asset's draft, so a released page is reached over what it references even when its draft dropped the reference. A localized media root is also seeded in every language that falls back to a language whose pointer changed. The initial release-state migration seeds nothing: a baseline without any release state rendered the drafts, which is what the migration released. `GET /assets/{uuid}/impact` answers "what would rebuild if this draft were released".

**Walk rules.** A merely reached page stops the walk (its output depends on what it references, not on who references it) unless its output path moved since the base build (a template `outputPath` edit), in which case every page linking it is reached too — and, since M31, it counts as navigation-visible: it reaches its pages folders over `NAVIGATION` and the page references pointing at it, so navigation picks up the new href in the same build.

**Navigation rule.** `$CMS_NAVIGATION(nav:x)$` and `$CMS_FOR(i : nav:x)$` render `x`'s whole subtree, but only `x` is an edge target. So a navigation-affecting change reaches the Navigation folders that render it with edge `NAVIGATION`, and their template and media referrers walk as usual. Navigation-affecting: a changed page reference (created, moved, deleted, relabelled, reordered, retargeted: its ancestor folders now and at the baseline); a changed Navigation folder (its ancestors); a page reference pointing at a page, or at a pages folder containing a page, whose display name, uid, output path or existence changed; a page merely reached whose output moved (M31). A page's body edit is not navigation-affecting.

### 18.3 Output paths

Resolution order for a page in channel `c`:

1. `page.payload.output.pathOverride[c]` if set,
2. else the page template's `outputPath[c]` expression,
3. else the project default `{folder}{uid}.{ext}`.

`{folder}` is the page's folder path relative to the site root: the `pages_root/` segment is stripped (§10.2).

Placeholders: `{folder}`, `{uid}`, `{ext}`, `{displayNameSlug}`, `{year}`, `{month}`, `{day}` (from `nav.date`/`publishedOn`), `{channel}`.

Index handling (per channel, §15.2): for a page whose UID equals the channel's `indexUid` (default `index`), `{uid}` expands to the stem of the channel's `indexFileName` (default `index.{ext}`), so it renders to `{folder}index.{ext}` by default. With `trailingSlash: true` and `urlStrategy: PRETTY`, `/products/hammer.html` becomes `/products/hammer/index.html` and `$CMS_REF` emits a relative href to `/products/hammer/`.

Path collisions between two pages are a **build error** (`SF-GEN-0110`) listing both assets.

**Media paths.** Media is written to `assets/media/{uid}.{ext}` (variants `assets/media/{uid}-{variant}.{ext}`). Localized media (§11.6, M27): a language's own file is written under that language's prefix — `{localePrefix}assets/media/{uid}.{ext}`, where the prefix is the language tag and a slash as `{locale}` expands in page paths, empty for the default language when the project publishes it without prefix. A language that falls back links the owner language's output when the owner publishes its own file there; otherwise (owner not released, or no own file) it writes the file it renders under its own prefix, so no link points at a file nobody wrote. Links stay relative to the rendering page. Page outputs are checked against every media output path (`SF-GEN-0110`).

**The URL registry decides the path (M32).** The rules above compute a path only for an output that has no URL yet. Every output of a build is registered in the URL registry (`url_registry_entry`, `v1.0/030`) — each page and page number per channel and language, each media file and variant per language (media rows are channel-independent), and each pages folder without an index page (its directory, what `$CMS_REF(folder:…)` links) — and its **registered URL is authoritative**: the build writes the file there, and every link, navigation entry, sitemap line, canonical and `hreflang` tag, the link checks (§18.8) and the redirect detection (§18.9) read it. A URL is stored as the site-root-relative href (`products/hammer/`, `./` for the site root with pretty URLs); the file is the channel's `indexFileName` inside a directory URL, the URL itself otherwise. A URL is **assigned once**: renaming a page, moving it or changing its template's `outputPath` keeps its URL until its row is reset (`POST …/url-registry/reset`) or overridden (`PUT`/`PATCH …/url-registry`); a channel output settings change drops the channel's computed rows (§15.2). Page references and folders with an index page have no rows of their own: they link their page's URL. Page N of a paginated page is assigned next to page 1's *registered* URL, so the pages stay together while page 1 is frozen. A build reads its area (`GENERATED`) once, claims first-time URLs in memory and stores them only when it publishes (a dry run and a draft check store nothing); a first-time URL that another output holds — a registered row, overrides of deleted assets included, or an earlier claim of the same build — is a path collision (`SF-GEN-0110`, naming a manual override as such). An unscoped build drops the computed rows of outputs that left the site (a deleted or unpublished page, a language withdrawn, page numbers past the new count, media and folders gone); manual overrides are kept.

**Paginated pages (M21).** A page whose template has a `pagination` editor with a value is planned as `max(1, ceil(items / pageSize))` outputs per channel, counted from the source at the snapshot revision. Page 1 is the path above. Pages 2..N use the page template's `paginationPath[c]` pattern when set — `{pageNumber}` (required), `{pagePath}` (page 1's path without its extension) plus the placeholders above — and otherwise sit next to page 1 with `-N` before the extension in every channel (`news/blog.html` → `news/blog-2.html`, `news/blog/index.html` → `news/blog/index-2.html`); pagination paths are never prettified. An output is owned by its page and page number, so a collision names the page number (`blog (page 2)`). Sitemap and search index list every output (search entries carry `pageNumber`; pages 2..N get the title suffix ` – page n`); navigation and `$CMS_REF(page:…)` always target page 1.

### 18.4 Targets and atomic publish

```
generation_target
  id, project_id, name, type (FILESYSTEM | ZIP | S3), config json, is_default
```

Each target owns the directory `{root} = {sf.generate.output-root}/{projectKey}/{path}`, where `path` is `config.path` (relative, `[A-Za-z0-9._-]` segments, no `.`/`..`) or `target-{id}` when unset. Targets of one project may not share or nest directories, and a project has at most one default target. `config.baseUrl` is used for sitemap and absolute links; it also decides which absolute `http(s)` links the quality checks treat as internal (§18.8).

`config.redirectFormats` (M30) chooses the redirect output of the target's builds (§18.9): an array of distinct values of `HTML_STUB`, `HTACCESS` and `JSON`. Absent (or `null`) means `["HTML_STUB"]`; `[]` writes no redirect output at all. Target create and update reject anything else with `400 SF-API-0400`, `field: config.redirectFormats`; builds read the key leniently (unknown names ignored). The target view carries the effective list as `redirectFormats`, sorted.

Filesystem publish is atomic via staged directories:

```
{root}/builds/{runId}/     ← files written here
{root}/current             ← symlink flipped after a successful run
```

Failed runs leave `current` untouched. The last *N* **published** builds (`sf.generate.keep-builds`, default 5) plus `current` are retained for instant rollback (`POST /generations/{runId}/promote`).

**Published builds and cleanup (M29).** The writer tells a published build without database access: a filesystem build with its manifest (written inside the run's final locked write, right before the flip), a finished `{runId}.zip` (only publish renames `{runId}.zip.tmp`), an S3 mirror with its key manifest. Only these count toward `keep-builds`, so failed builds never displace rollback points; unpublished staging is never pruned by a publish but removed by the `build-output-cleanup` system job (§26.6). Builds from before M22 (no manifest) are neither counted nor pruned. **Promote** refuses a run that isn't `SUCCESS`/`PARTIAL`, has no target, or whose build is no longer on disk: `409 SF-GEN-0505`, and `current` stays. `build-output-cleanup` removes, per project and target: staged output (`builds/{id}`, `{id}.zip.tmp`, manifests without a build) of `FAILED`/`CANCELLED` runs at any age and of runs without a row after `minAge` (default 1 h); `.current-*.link` temporary links older than `minAge`; and folders under `{output-root}/{projectKey}/` that look like target output and that no existing target owns (deleted targets). It never touches `current`, the build `current` points at, or a run this node still executes; every deletion is asserted to stay under the target root and deletes links as links. S3 targets are not cleaned while `S3TargetWriter` is a local-mirror stub.

**Build manifests and carried builds (M22).** Every published build has a manifest next to it (`{root}/builds/{runId}.manifest.json`, outside the served directory, pruned with the build): each file with the page (and channel, page number) or media asset that produced it and the media it depends on, plus the build's consistent revision and complete channels. An incremental or scoped run stages its build as the base build's files minus removed paths, overlaid with its own files (`TargetWriter.stage(runId, baseRunId, files, removedPaths)`), into its own staging area, and publishes with the same single flip. Filesystem builds hard-link unchanged files (copying where links aren't supported) and never write into a linked file; ZIP builds rewrite the archive from the base entries; the S3 mirror carries the base keys and fingerprints, so the invalidation set holds only what changed. A base output is kept when the run is responsible for it (page in scope, channel requested) and it still exists at the same path unplanned; outside the run's scope or channels it is kept only by a scoped run. Media is kept while a kept or re-rendered file still needs it. Site files (sitemap, robots, search index, and the redirect files and stubs, §18.9) are always written again from the full list of site outputs; the search index text of a carried page comes from the base build's index. A stub whose redirect is gone is therefore removed by the next build, full or incremental.

**Quality sidecar (M30).** Every published build also writes `{root}/builds/{runId}.quality.json` next to its manifest (outside the served directory, pruned with the build, removed by `build-output-cleanup` with the rest of an unpublished build's staging; ZIP and S3-mirror writers keep it the same way): format `version` 1, the `configFingerprint` of the rule configuration the build was checked under, and per checked HTML output its facts (title, meta description, `h1` count, `lang`, canonical, `hreflang` alternates, robots meta, element ids and `<a name>` anchors, outgoing references with their resolved path and fragment — ids and links capped at 2,000 each per output, with a flag when the cap was hit), its page-local findings and the renderer's reference events. The build's manifest records the same fingerprint (`qualityFingerprint`, absent in manifests written before M30), so planning can tell whether a base build's facts are usable without reading the sidecar. An incremental or scoped run reads its base build's sidecar for the outputs it carries when it executes (§18.8).

S3 publish writes to a key prefix, then updates a CloudFront/Nginx origin path or invalidates the changed keys only (derived from the diff, not a wildcard).

### 18.5 Generation run record

```
generation_run
  id, project_id, revision_id, mode, channels, target_id,
  status (QUEUED|RUNNING|SUCCESS|PARTIAL|FAILED|CANCELLED),
  started_at, finished_at, started_by,
  files_written, files_skipped, bytes_written,
  error_count, warning_count, diagnostics json, log_blob_sha,
  plan_summary json                         -- M22
  comment (≤ 500)                           -- the note the run was started with; scheduled runs
                                            --   "Scheduled generation #n: …" / "After scheduled release #n"
  executor_node varchar(100)                -- sf.node-id of the node that queued and executes it (M29)
  heartbeat_at                              -- refreshed while RUNNING (M29)
  finding_errors, finding_warnings,         -- M30: every quality finding of the run, stored or not
  finding_truncated, finding_counts json    --   (counts by category); truncated = not stored (caps)

generation_run_finding                      -- M30 (v1.0/028-quality-checks.xml): one row per stored finding
  id, run_id FK ON DELETE CASCADE, asset_uuid, channel, locale, page_number, output_path,
  code, category (LINKS|SEO|ACCESSIBILITY), severity (WARNING|ERROR, effective at run time),
  message, selector (short CSS path), section_instance_id, carried boolean
  INDEX (run_id, severity, category), INDEX (run_id, asset_uuid)

generation_run_plan_entry                   -- one row per planned output
  run_id, asset_uuid, asset_type, uid, display_name, channel,
  output_path, page_number, root_kind, node_asset_uuid, cause_count
generation_run_plan_node                    -- one row per asset on a stored chain
  run_id, asset_uuid, asset_type, uid, parent_asset_uuid,
  edge_kind, reference_kind, source_path, root_kind, root_revision
```

The plan is stored right after PLAN, so a run failing later is still explainable. `plan_summary` holds the requested mode, `incremental`, `fallbackCause`, `baselineRevision`, `baseRunId`, `coverage {scoped, channels}`, the changed assets (up to 200, with `changedAssetCount`), `entryCount`/`pageCount`/`processedMediaCount`, counts `byRootKind`/`byFirstEdge`/`byChannel`, the largest `via` groups and `planAvailable`; since M30 also `redirectsAdded` (automatic redirects the published run added or re-pointed, §18.9) and `redirectsActive` (redirects the build emitted; `0` for a target without redirect formats, `null` for a run that didn't publish).

**Findings (M30).** A run's quality findings (§18.8) are stored in the REPORT step, in the transaction that records the run's final status — a cancelled or failed run stores none. The counts on the run cover **every** finding; storage is capped at `sf.quality.max-findings-per-output` (default 50) findings per rule and output and `sf.quality.max-findings-per-run` (default 100,000) per run, errors stored first, the rest counted in `finding_truncated`. The run view carries `findingCounts {errors, warnings, byCategory {links, seo, accessibility}, truncated}` (`null` for a run that stored none: before M30, or not finished); the run list reads these columns, never the findings table. Check findings never enter `warnings`, `warning_count` or `fileErrors`: a run with warning findings only stays `SUCCESS`, and `warning_count` keeps meaning render and copy warnings. Only a held-back page (`SF-GEN-0125`, a file error) makes the run `PARTIAL`. A stored finding carries its output (asset, channel, locale, page number, path), rule code, category, effective severity, message, CSS selector, the section instance id when known, and `carried` (taken over from the base build's sidecar for an output the run carried forward). `GET /generations/{runId}/findings` serves them paged and filtered (§20.2), each row with the page's current uid and display name (`null` once it was deleted). Findings go with their run: the FK cascades and `generation-run-retention` deletes them explicitly with the plan rows; runs whose build is retained stay (their sidecar and findings back carried outputs). Chains are normalized: nodes are the parent-pointer tree of the walk, so entries sharing a chain suffix store it once. Plans of the newest `sf.generate.plan-retention-runs` (default 50) runs per project are kept; older runs keep their summary with `planAvailable: false`.

**Editor-rule diagnostics (M33).** Rule findings of the VALIDATE stage (§18.2) are run `diagnostics`, not quality findings: `SF-GEN-0120` (held back, an error per page and language, run `PARTIAL`), `SF-GEN-0121` (a `fail` rule, errors, run `FAILED`, no output published, `current` of the target unchanged) and `SF-GEN-0122` (severity `WARNING` — counted in `warning_count`, run `PARTIAL` — or `INFO` — listed only).

Runs are queued per project (one active run per project; a second request returns `409 SF-GEN-0500` with the running run's id; a run left active by a crash is failed by recovery, below). Progress is streamed to the UI via Server-Sent Events on `GET /generations/{id}/events`.

**Attribution (M28).** `started_by` is the caller — for a scheduled run the schedule's owner. The request's `comment` is stored trimmed; a blank one is none, a longer one is cut to 500 characters ending in "…". The run view carries `comment` and `startedBy {id, displayName}` — "Deleted user" for a deleted account, `null` when unknown (a system start). Start, cancel and promote are audited (§26.3). An `Idempotency-Key` is scoped by project and user: another user reusing a key starts their own run instead of receiving someone else's. Keys are remembered for `sf.generate.idempotency-ttl` (default 24 h, evicted by the `memory-eviction` job); a re-submission after that starts a new run.

**Interrupted runs and real cancel (M29).**

- **Heartbeat.** A run records its node (`executor_node`, the node's `sf.node-id`) when it is queued and refreshes `heartbeat_at` at every stage and at least every `sf.generate.heartbeat-interval` (default 15 s) while `RUNNING`.
- **Recovery.** The `generation-run-recovery` system job runs at startup and every 5 minutes. A `QUEUED`/`RUNNING` run that this node's executor doesn't hold is **interrupted** when it has no node (rows from before M29), its node is this node, its node is a dead earlier process of this host (the default node id changes with every restart), or its heartbeat (for a queued run, its queue time) is older than `staleAfter` (default 5 min, minimum 1 min). Interrupted means `FAILED` with the diagnostic `SF-GEN-0504` "Run interrupted (node restart or lost heartbeat)", `finished_at` set, local SSE emitters completed; the staged output is left to `build-output-cleanup`. The project can build again at once, and a scheduled generation waiting for the stuck run (§18.7) proceeds.
- **Cancel is real.** The executor checks for a stop at every stage, before each page renders and before publishing. The final status is written under a row lock (`SELECT … FOR UPDATE`) together with the state check, and publishing (manifest, flip) happens inside that locked write, so whichever of cancel and the final write commits first wins: a run is never published, and never `SUCCESS`/`PARTIAL`, after `CANCELLED` was committed. A stopped run writes and publishes nothing; its emitters get a final `REPORT` event with the terminal status.
- **Retention.** The `generation-run-retention` system job deletes runs older than `keepDays` (default 90) **and** outside the newest `keepPerProject` (default 50) of their project, with their plan rows. A run's age is its `finished_at` (else `started_at`). Protected, never deleted: runs with a build on disk in any target (`TargetWriter.retainedRunIds()`), the `current` run of every target, `QUEUED`/`RUNNING` runs, the base runs (`planSummary.baseRunId`) of builds on disk, and runs referenced by schedule executions younger than `keepDays`. A schedule execution whose run was deleted keeps the id in `detail.deletedGenerationRunId` and answers `generationRunId: null`; `GET /generations/{id}/plan` of a deleted run is `404`. Run ids may have gaps.

### 18.6 Performance targets

| Project size | Full build | Incremental (1 page) |
|---|---|---|
| 500 pages | < 20 s | < 2 s |
| 5,000 pages | < 5 min | < 10 s |
| 50,000 pages | < 45 min | < 30 s |

Measured with 2 channels, 8 vCPU, media unchanged.

### 18.7 Scheduler (M27)

Releases, unpublishing and builds can be scheduled. Tables (`v1.0/022-scheduler.xml`): `scheduled_action` (`uuid` — its identity across export/import, unique per project, `v1.0/024`; type, `run_at` or `cron` + `zone_id`, `pin_policy`, `missed_policy`, `max_lateness_seconds`, `status`, `next_run_at`, lease columns, `params`/`then_generate` JSON, owner, `@Version`), `scheduled_action_execution` (one row per execution: `scheduled_for`, `started_at`, `finished_at`, `outcome`, `late_by_ms`, `message`, `detail` JSON, `revision_id`, `generation_run_id`, `executed_as_user_id`) and `scheduled_action_asset` (the (asset, locale key) pairs an action touches — the `scheduled` block of asset views and the `assetUuid` filter, in one indexed query).

**Engine.** Every node with `sf.scheduler.enabled` polls every `sf.scheduler.poll-interval` (default 15 s) and claims up to `batch-size` due actions (status `PENDING`/`RUNNING`, `next_run_at ≤ now`, lease free or expired, project not archived) with a conditional update — `UPDATE … SET lease_owner, lease_until, status = 'RUNNING' WHERE id = ? AND version = ? AND (lease_until IS NULL OR lease_until < now)` — portable across H2 and PostgreSQL and safe with several nodes: a claim wins once. The executing node extends its lease every `lease / 3` (`sf.scheduler.lease`, default 2 min); a node that dies loses the lease, and another node resumes the open execution after it expired. Handlers checkpoint their progress in the transaction of each step (the release revision, the run row), so a resumed execution never repeats a committed step. Handlers implement the SPI `ScheduledActionHandler` (`type()`, `timing()`, `validate(spec, actor)`, `requirements(spec)`, `execute(ctx)`, and optionally `assets(spec)`, `describe(specs)`, `repin(spec, actor)`); a new action type is a new bean.

**Action types.**

| Type | Timing | Params | Effect |
|---|---|---|---|
| `RELEASE` | one-off | `{items: [{assetUuid, locale?}], includeDependencies: […], comment?}`; stored resolved, one item per locale key, with `pinnedVersionId` | Releases the items in one `RELEASE` revision ("Scheduled release #id: …"); an item that can't be released any more is skipped with its reason (asset or language gone, pinned draft deleted since, a `LATEST` item with rule errors): outcome `PARTIAL`. Rule warnings are accepted and recorded on the item's result (M33) |
| `UNPUBLISH` | one-off | `{items, comment?}` | Unpublishes the items in one revision |
| `GENERATION` | one-off | `{mode, channels[], targetId?, scope?: {folderPath?, assetUuids[]}, comment?}` | Starts a run as the owner |
| `RECURRING_GENERATION` | cron | as `GENERATION` | Starts a run per slot |

`RELEASE`/`UNPUBLISH` take an optional **then generate** (`thenGenerate: {targetId?, channels[]}`): an `INCREMENTAL` run at the release revision, started right after it.

**Pin policy** (`RELEASE`): `PINNED` (default) releases the versions that were the drafts when the schedule was created or last **re-pinned**; a pinned version with `release`-scope errors is refused when scheduling (`422 SF-DOM-0150`; warnings are shown, never refused), and a pinned item whose draft changed since shows `draftChangedSinceScheduled` (the list counts them in `driftCount`). `LATEST` releases whatever is saved at execution.

**Missed policy.** `RUN_LATE` (default) runs a missed action as soon as possible; `SKIP_IF_LATER_THAN` (`maxLateness`, ISO duration) skips it (outcome `SKIPPED`) when it starts later than that. A recurring action that missed several slots runs at most once for them, then continues with the next future slot.

**Time zones.** One-off actions are stored as UTC instants. Recurring ones store the cron expression (5 fields, normalized to Spring's 6 with seconds `0`) **and** the creator's IANA zone, and are evaluated in that zone: a local time skipped by a DST switch runs at the end of the gap, a repeated one runs once. A one-off time the viewer enters follows the same rule (a skipped time becomes the end of the gap, a repeated one its first occurrence) before it is sent as an instant. The UI takes and shows times in the viewer's zone and names the schedule's zone where it differs; next-run previews come from the server (`POST …/schedules/preview-times`).

**Authority.** An action runs as its **owner** (initially the creator). `requirements(spec)` returns `PublishRequirements` (§8.4; M28): `RELEASE`/`UNPUBLISH` need `SCHEDULE_RELEASE`, plus with "then generate" what that incremental run needs (§18.1: `INCREMENTAL_BUILD` for the default target, `FULL_BUILD` for another — evaluated on the target as stored, so a target that stops being the default raises the requirement); `GENERATION`/`RECURRING_GENERATION` need `DEVELOPER` whatever the policy. The API checks them for the caller on create and edit (the action as saved), cancel, run-now, re-pin and take-over; editing, cancelling, running now or re-pinning **someone else's** action needs `DEVELOPER` on top, while taking over needs only the requirements. The engine checks them for the owner at every execution (`ActionAuthority` → `PublishPermissionEvaluator`), and the release service checks the owner's `RELEASE` again. An owner who lost them — removed, demoted, disabled, deleted, or an editor whose permission the policy no longer grants — fails the execution with `SF-DOM-0163` and a message naming what is missing ("Owner no longer permitted (SCHEDULE_RELEASE): 'bob' is EDITOR without SCHEDULE_RELEASE in the project's publish policy."); a recurring action is **paused** (`FAILED`, no `next_run_at`), a one-off one fails; a permitted user **takes over** (becomes the owner): a paused recurring action resumes at its next slot, a failed one-off becomes due at its original time with the missed policy applied to it.

**Busy project.** A generation step that meets an active run stays open (`WAITING`, the action `PENDING` with its `next_run_at` unchanged) and is retried on every poll until the run ends, bounded by the missed policy; the execution's `detail.waitingForRun` names the run. A scheduled release that can't start its then-generate within a `SKIP_IF_LATER_THAN` bound ends `PARTIAL` with the release done.

**Archived projects** execute nothing; after unarchiving, the missed policy applies. Creating or changing schedules of an archived project is refused (`409 SF-DOM-0141`).

**Export and import (M27.8).** Open schedules — pending, and paused recurring ones — travel with a project export (protocol 9, §26.5) and are imported last, in the import's transaction, each checked like a new schedule (as its owner) and audited as `SCHEDULE_IMPORTED` by the importing user. A schedule the target already has under the same `uuid` is replaced in place while it is open (its id and history stay); one that executes or has finished is left alone.

**Lifecycle.** `PENDING` → `RUNNING` (claimed) → `SUCCEEDED` | `FAILED` | `SKIPPED` for one-off actions; a recurring action returns to `PENDING` between slots and is `FAILED` only while paused; `CANCELLED` ends either. Edits (`PUT`, `If-Match: "v{version}"`) are allowed while `PENDING` and keep the stored items unless `params` are sent; an action a node is executing (or whose execution waits for a busy project) refuses changes with `409 SF-DOM-0167`, cancel excepted for a waiting one. Every change is audited (`SCHEDULE_CREATED`, `_UPDATED`, `_CANCELLED`, `_TAKEN_OVER`, `_RUN_NOW`) and so is every finished execution (`SCHEDULE_EXECUTED`, `_FAILED`, `_SKIPPED`, as the owner). Execution outcomes: `SUCCEEDED`, `PARTIAL`, `FAILED`, `SKIPPED`.

### 18.8 Quality checks (M30)

Every build looks at what it wrote. The CHECK stage (§18.2) parses every output of an **HTML channel** (§15.2) with jsoup — once per output, on the render's virtual-thread pool (`sf.generate.parallelism`) — and runs a fixed set of rules over it: internal **links**, **SEO** basics and the **accessibility** checks static HTML can answer without a browser. Checks only read: an output written by a build with checks is byte-identical to one written with every rule `OFF`. The budget is +15 % on the full-build time of the 5,000-page fixture (§18.6).

**Internal only, no network.** Every `href`/`src`/`srcset` is resolved against the build itself, never fetched (§26.3). References read: `a[href]`, `link[href]`, `img[src]`, `img[srcset]`, `source[src|srcset]` (each candidate), `script[src]`, `iframe[src]`, `video[src|poster]`, `audio[src]`. Resolution: a relative URL against the output's own path (generated links are page-relative), a root-relative one against the site root, an absolute `http` or `https` URL only when its host and path start with the target's `baseUrl` (then it is internal); `./` and `../` normalized, `%XX` decoded, `?query` ignored, `#fragment` kept apart. A path ending in `/` means the channel's `indexFileName` in that folder. Anything escaping the site root, every other absolute URL and `mailto:`, `tel:`, `javascript:`, `data:` are skipped.

**Rules.** The list is fixed in code (`QualityRule` beans, codes unique, checked at start-up); projects configure, they don't add rules. A rule is either a **page rule** (one parsed document) or a **site rule** (the facts of every output of the build: duplicates, links, anchors, alternates). Every rule's default severity is `WARNING`. Each declares a `fixHint` — where its findings are usually fixed: `CONTENT`, `TEMPLATE` or `CONTENT_OR_TEMPLATE` — and says the same in its description.

| Code | Name | Category | Kind | Fix hint | Parameters | Max. severity |
|---|---|---|---|---|---|---|
| `SF-CHK-0001` | Output could not be checked | `LINKS` | page | `TEMPLATE` | — | `WARNING` |
| `SF-CHK-0101` | Link to a missing page or file | `LINKS` | site | `CONTENT_OR_TEMPLATE` | — | `ERROR` |
| `SF-CHK-0102` | Link to missing media | `LINKS` | site | `TEMPLATE` | — | `ERROR` |
| `SF-CHK-0103` | Link to a page held back in this build | `LINKS` | site | `CONTENT` | — | `WARNING` |
| `SF-CHK-0104` | Link to an unreleased asset | `LINKS` | site | `CONTENT_OR_TEMPLATE` | — | `ERROR` |
| `SF-CHK-0105` | Link to a deleted asset | `LINKS` | site | `CONTENT_OR_TEMPLATE` | — | `ERROR` |
| `SF-CHK-0106` | Link into another channel | `LINKS` | site | `CONTENT_OR_TEMPLATE` | — | `ERROR` |
| `SF-CHK-0107` | Missing anchor | `LINKS` | site | `CONTENT_OR_TEMPLATE` | — | `ERROR` |
| `SF-CHK-0108` | Empty or #-only link | `LINKS` | page | `CONTENT_OR_TEMPLATE` | — | `ERROR` |
| `SF-CHK-0109` | Link reaches only a redirect | `LINKS` | site | `CONTENT_OR_TEMPLATE` | — | `ERROR` |
| `SF-CHK-0201` | Missing or empty title | `SEO` | page | `TEMPLATE` | — | `ERROR` |
| `SF-CHK-0202` | Title length | `SEO` | page | `CONTENT_OR_TEMPLATE` | `min` 10 (0–1000), `max` 60 (1–1000) | `ERROR` |
| `SF-CHK-0203` | Missing meta description | `SEO` | page | `TEMPLATE` | — | `ERROR` |
| `SF-CHK-0204` | Meta description length | `SEO` | page | `CONTENT` | `min` 50 (0–1000), `max` 160 (1–1000) | `ERROR` |
| `SF-CHK-0205` | Duplicate title | `SEO` | site | `CONTENT_OR_TEMPLATE` | — | `ERROR` |
| `SF-CHK-0206` | Duplicate meta description | `SEO` | site | `CONTENT_OR_TEMPLATE` | — | `ERROR` |
| `SF-CHK-0207` | No h1 heading | `SEO` | page | `TEMPLATE` | — | `ERROR` |
| `SF-CHK-0208` | More than one h1 heading | `SEO` | page | `CONTENT_OR_TEMPLATE` | — | `ERROR` |
| `SF-CHK-0209` | Language attribute doesn't match the page's language | `SEO` | page | `TEMPLATE` | — | `ERROR` |
| `SF-CHK-0210` | Language alternates incomplete or broken | `SEO` | site | `TEMPLATE` | — | `WARNING` |
| `SF-CHK-0211` | Canonical link missing or broken | `SEO` | site | `TEMPLATE` | `required` false | `ERROR` |
| `SF-CHK-0212` | Hidden page without robots noindex | `SEO` | page | `TEMPLATE` | — | `ERROR` |
| `SF-CHK-0301` | Image without alt attribute | `ACCESSIBILITY` | page | `CONTENT_OR_TEMPLATE` | — | `ERROR` |
| `SF-CHK-0302` | Link without accessible text | `ACCESSIBILITY` | page | `CONTENT_OR_TEMPLATE` | — | `ERROR` |
| `SF-CHK-0303` | Button without accessible text | `ACCESSIBILITY` | page | `TEMPLATE` | — | `ERROR` |
| `SF-CHK-0304` | Heading level skipped | `ACCESSIBILITY` | page | `CONTENT_OR_TEMPLATE` | — | `ERROR` |
| `SF-CHK-0305` | Duplicate id | `ACCESSIBILITY` | page | `TEMPLATE` | — | `ERROR` |
| `SF-CHK-0306` | Form control without label | `ACCESSIBILITY` | page | `TEMPLATE` | — | `ERROR` |
| `SF-CHK-0307` | iframe without title | `ACCESSIBILITY` | page | `TEMPLATE` | — | `ERROR` |
| `SF-CHK-0308` | `<html>` without lang | `ACCESSIBILITY` | page | `TEMPLATE` | — | `ERROR` |

`SF-CHK-0001` is the check framework's own code (filed under `LINKS`): an output that can't be parsed, or on which a rule fails, gets it with the cause; it never fails the run and never holds anything back. The table is kept in step with `GET /projects/{p}/quality-rules` by a test (`QualityRuleCatalogTest`). What the rules look for:

- **Links.** `0101`: an `a`/`iframe` target that is no output of this build (pages, media, carried outputs and the build's site files count; a redirect stub doesn't — that is `0109`), and every `MISSING` reference event (the target uuid in the message). `0102`: the same for `img`, `source`, `video`, `audio`, `script` and `link` targets (each `srcset` candidate, `poster`); the canonical link and `hreflang` alternates are left to `0211`/`0210`, so one broken `<link>` is reported once. `0103`: the target is a page output held back in this build (after the hold-back). `0104`/`0105`: the renderer's `UNRELEASED`/`DELETED` reference events, naming the target (uid, display name, type) and, when the link comes from a field, its editor path. `0106`: the target is a page output of another channel. `0107`: the `#fragment` is not among the target's element ids and `<a name>` anchors (same-page fragments check the page itself; a bare `#` and `#top` pass; fragments on media aren't checked). `0108`: an `a[href]` that is empty, whitespace or `#` — except `role="button"`, and except empty hrefs on an output whose renderer reported an unresolved reference (reported by `0101`/`0104`/`0105` instead). `0109`: the target path is the source of a redirect this build emits (§18.9): it works, but costs a hop.
- **SEO.** Title and description text are whitespace-normalized and measured in code points after trimming; a pair of length parameters with `min` > `max` is refused on `PUT`. `0205`/`0206` group outputs by channel and language and report every member of a duplicate group, naming up to 10 others; `noIndex` pages are left out of the groups. The page numbers of a paginated page are separate URLs, so pages 2..N that repeat page 1's title or description are reported too; both rules' descriptions name the fix, the page number (`$CMS_META(pageNumber)$`). `0209` (projects with languages only): the primary subtag of `<html lang>` must equal the render language's (`de-CH` rendered with `lang="de"` passes, `lang="en"` fails). `0210` (projects with languages only): a page output's alternates must name every language the page has an output in, point at outputs of this build (not held back or unreleased ones), point at the same page, and be answered by the pages they name — reciprocity per page and language, not per page number (page 2 may name page 1 of the other languages); a page without any alternates is fine unless the page exists in more than one language. `0211`: a canonical link, when present, must resolve to an output of the build (a paginated page may point at page 1 or itself) and be absolute when the target has a `baseUrl`; with `required: true` a missing canonical is reported too. `0212`: a `nav.noIndex` page (§10.3) whose HTML has no `<meta name="robots">` containing `noindex`.
- **Accessibility.** `0301`: `img` or `input[type=image]` without an `alt` **attribute** (`alt=""` is a decorative image and passes); the message names the media asset when the `src` resolves to a media output. `0302`/`0303`: a link / a `button` or `[role=button]` whose accessible name is empty — no text, no `aria-label`, no `aria-labelledby` resolving to non-empty text, no `img[alt]` with text inside, no `title` (`a[role=button]` is left to `0303`). `0304`: a heading more than one level deeper than the one before (`h2` → `h4`; the first heading may be any level). `0305`: an `id` used more than once (one finding per value, with the count). `0306`: `input` (not `hidden`, `submit`, `button`, `reset`, `image`), `select` or `textarea` without `label[for]`, a wrapping `label`, `aria-label`, `aria-labelledby` or `title`. `0307`: `iframe` without a non-empty `title`. `0308`: `<html>` without a non-empty `lang`. Hidden elements (`hidden`, `aria-hidden="true"` on them or an ancestor) are skipped by `0302`, `0303`, `0306` and `0307`, not by `0301`. Colour contrast, focus order and anything needing computed styles are out of scope.

**Configuration** (per project, `project.quality_rule_config` JSON, `v1.0/028-quality-checks.xml`): `{rules: {"SF-CHK-0202": {severity: "OFF"|"WARNING"|"ERROR", params: {min: 20}}}}`; a rule without an entry, and a parameter without a value, is at its default, and only entries that differ from the default are stored. `GET /projects/{p}/quality-rules` (VIEWER) serves every rule with its code, name, category, kind, description, `fixHint`, default, configured and maximum severity, parameters (value, default, bounds) and the note "HTML channels only". `PUT` (DEVELOPER — the templates own the markup) replaces the whole configuration: it validates every entry (`400 SF-API-0400` with one message per problem under `errors`: unknown code, unknown severity, unknown parameter, value out of bounds, `min` above `max`), records one revision with a `PROJECT` summary entry `qualityRules` (time travel shows the configuration read-only) and audits `QUALITY_RULES_UPDATED` with the changed codes; a `PUT` that changes nothing records neither. Unknown codes in a stored configuration are dropped on read, so a rule removed by a later version never breaks a project. A configured severity above a rule's maximum is kept but applied as the maximum. Changing the configuration makes the next incremental request a full build (`QUALITY_RULES_CHANGED`, §18.2). Archived projects refuse the `PUT` (`409 SF-DOM-0141`).

**Severity effects.** `OFF` doesn't run the rule. `WARNING` findings are reported only: they don't make a run `PARTIAL` and aren't counted in `warning_count`. An `ERROR` finding on an output **rendered by this run** holds its page back — every output of that page in that channel and language, all page numbers — exactly like incomplete content: the outputs leave the files, the manifest, the sitemap and the search index, and the page gets one file error `SF-GEN-0125` "Quality check failed for page '…' (…): SF-CHK-…" listing the codes → run `PARTIAL`. The run's `diagnostics` list the same pages as data, `heldBack: [{asset, uid, channel, locale, codes}]` — one entry per page, channel and language, in the order of the `SF-GEN-0125` messages, `uid` `null` when the snapshot no longer has the page, the key absent when nothing was held back — so clients link them to the page's findings without parsing messages. Findings on carried outputs are reported but never hold anything back (this run didn't render them).

**No cascade.** Rules run in two phases: first every page rule and every site rule that doesn't look at held-back pages; their `ERROR` findings hold pages back; then the rules that read the held-back set run — `SF-CHK-0103` and `SF-CHK-0210` — capped at `WARNING`. So holding one page back never holds back the pages that link to it.

**Incremental and scoped runs.** Carried outputs have no bytes in the run; their facts, page-local findings and reference events come from the base build's sidecar (§18.4). Carried page-local findings take their rule's current severity (a rule switched `OFF` drops them) and are stored with `carried: true`. Site rules always run fresh over the whole site — new and carried outputs, links of carried outputs re-resolved against this build's paths — so a carried page linking a page that was unpublished since is reported (`0101`, `carried: false`) without being held back. A base build whose manifest names no checked configuration (built before M30) or another one plans the request `FULL` (`BASE_BUILD_WITHOUT_QUALITY_FACTS`, `QUALITY_RULES_CHANGED`). Planning decides on the manifest alone and never reads the sidecar; a run loads the base facts when it executes, and a base whose sidecar can't be read leaves its carried outputs unchecked rather than changing the plan. The dry run (`/generations/plan`) doesn't run checks.

**Findings** carry a short, stable CSS selector for the element (tag with id, or an `nth-of-type` path), so the UI can point at it, and the section instance id when the document carries section markers (draft checks only, §19.4). They are stored per run (§18.5).

**Metrics.** `sf.quality.check.duration` (timer, per build) and `sf.quality.findings` (counter, tags `severity`, `category`).

### 18.9 Redirects (M30)

Old URLs keep working. Every build notices pages whose output path changed since the build the target serves and records old path → page in a per-project **redirect registry**; people add, edit and delete redirects by hand; and each target writes the active redirects in the formats it chooses.

**Registry** (`redirect`, `v1.0/029-redirects.xml`): `id, project_id, channel_key, locale_key ('' in a project without languages), from_path, to_asset_uuid, to_page_number, to_path, kind (AUTO|MANUAL), created_at, created_by (null for AUTO), source_run_id, updated_at, updated_by, version`, unique `(project_id, channel_key, locale_key, from_path)`. Exactly one target: a page (`to_asset_uuid` + `to_page_number`, default 1) or `to_path` — an output path, optionally with `?query` and `#fragment`, or an absolute `http(s)` URL (manual only). Paths are **output paths** as the manifest stores them (`products/hammer.html`, `de/about/index.html`): a leading `/` is dropped, `%XX` is decoded, and a directory (`old/`, `/`) means the channel's `indexFileName` in it; `..`, a scheme other than `http(s)`, `//host`, backslashes and control characters are refused (`422 SF-DOM-0193`), as is a query or fragment on the source. Redirects are not revisioned assets: they aren't part of time travel or project restore.

An `AUTO` entry points at the **page**, not at a path: its target is resolved at build time to the page's current output path in the same channel and language. A page moved A → B → C therefore has two entries, A → page and B → page, both leading straight to C (one hop each), and a later move is followed without touching the registry.

**Detection.** Every build — a `FULL` one too, although it has no base — reads the target's **current** manifest (the build visitors see; after a promote, the promoted one) and indexes its page outputs by (asset, channel, locale, page number). After the hold-back (§18.8), each page output of the new build whose key is in that manifest under a **different path** becomes an `AUTO` candidate: old path → the page and page number. Anything that moves an output counts: a page moved to another folder, a page UID change, a folder move (every page below it), a template `outputPath` change, a channel output-settings change such as `urlStrategy` — per language (a page moved in `en` only adds an `en` entry) and per page number. Outputs that disappear — unpublished, deleted, fewer paginated pages — add nothing. A scoped run detects only for the outputs it rendered; without a current build (or with a manifest written before manifests had locales) there is nothing to compare, and nothing is detected for the affected keys. Changing a **folder's UID** does not change its pages' output paths (a page's folder path is fixed when it is placed or moved), so it adds no redirects; moving the folder does.

Candidates are persisted with `source_run_id` in the run's REPORT transaction, written before the publish flip, so a publish that fails rolls them back with the run; a failed or cancelled run adds none. A candidate replaces an existing `AUTO` entry with the same source path (re-pointed), never a `MANUAL` one. `planSummary.redirectsAdded` counts added and re-pointed entries. The dry run returns the candidates it *would* add (`redirectCandidates: [{channel, locale, fromPath, toAssetUuid, toPageNumber, toPath}]` with the planned `toPath`, and `redirectsAdded`), persisting nothing; it can't know `redirectsActive`.

**States.** Each build resolves the registry plus its new candidates against its own final outputs:

| State | Meaning | Written? |
|---|---|---|
| `ACTIVE` | the source path is free and the target resolves | yes |
| `SHADOWED` | a page or media file of this build lives at the source path (e.g. a new page published at the old URL) | no — kept, active again once nothing lives there |
| `DANGLING` | the target page has no output in that channel and language (unpublished, deleted, other channel) | no — kept; the UI shows it so someone retargets or deletes it |
| `LOOP` | the redirect leads back to its own source path, directly or through a cycle of fixed-path redirects | no |

A deleted page's `AUTO` entries stay and go `DANGLING` ("nothing by default"). Site files never shadow a redirect in the registry's view: the published build's sitemap, robots, search index, redirect files and stubs are not live paths — otherwise a stub would shadow its own redirect in the next build. Within a build, redirects are never written over the build's own site files: a redirect whose source is `sitemap.xml`, `robots.txt`, `search-index.json`, or a redirect file the target writes, is left out as shadowed. Of two redirects with one source path in different channels, the first in channel and language order is written. `GET /redirects` computes each row's state against the **default target's** current build (`basisRunId`), with `resolvedTarget` — where it leads there; both are `null` while that target has no build.

**Manual redirects** (`/projects/{p}/redirects`, §20.2): read VIEWER, write DEVELOPER (like URL registry overrides — output paths are the templates' business), `If-Match: "v{version}"` on `PUT` (`409 SF-API-0409` stale, `412` missing) and optionally on `DELETE`. A duplicate source per channel and language is `409 SF-DOM-0191`; a redirect whose target is its own source, or that closes a cycle of fixed-path redirects, `422 SF-DOM-0192`; an invalid channel, locale, source or target `422 SF-DOM-0193`; an unknown id `404 SF-DOM-0190`. `PUT` of an `AUTO` entry makes it `MANUAL` (someone owns it now; detection never overwrites it). Deleting an `AUTO` entry is allowed; it comes back only if the path changes again. Manual changes are audited `REDIRECT_CREATED`, `REDIRECT_UPDATED`, `REDIRECT_DELETED` (target `redirect:<channel>/<locale>/<fromPath>`); `AUTO` entries aren't — their `source_run_id` says where they came from. Archived projects refuse writes (`409 SF-DOM-0141`).

**Redirect old URL to… (`for-asset`).** `POST /redirects/for-asset {assetUuid, toAssetUuid | toPath}` writes one `MANUAL` redirect per current page output of the asset in the **default target's current build** — every channel, language and page number, each to page 1 of `toAssetUuid` or to `toPath` — replacing existing redirects of those source paths (`AUTO` or `MANUAL`: it's the explicit intent). It is open to whoever holds `RELEASE` (M28: editors under a policy that grants it; developers and admins always). `422 SF-DOM-0194` when the asset has no page output there. The unpublish and delete dialogs call it after the unpublish or deletion succeeded; until a build no longer contains the page, the new entries show as `SHADOWED`.

**Output formats** (target `config.redirectFormats`, §18.4; default `["HTML_STUB"]`). Every format is written from the build's `ACTIVE` redirects, each leading to the target's output path in the same channel and language (a fixed `to_path` as stored). Redirect files are `SITE` outputs in the manifest, written after the sitemap and the search index, which therefore never list them.

- **`HTML_STUB`** — a page at each source path. It works on every static host, from `file://` and from an unpacked ZIP, which is why it is the default. Moving `products/hammer.html` to `tools/hammer.html` with `baseUrl` `https://example.com` writes at `products/hammer.html`:

  ```html
  <!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=../tools/hammer.html"><link rel="canonical" href="https://example.com/tools/hammer.html"><script>location.replace("../tools/hammer.html" + location.hash)</script><title>Moved</title></head><body><a href="../tools/hammer.html">https://example.com/tools/hammer.html</a></body></html>
  ```

  The link is relative to the stub's own path (like every generated link); the canonical is absolute under `baseUrl`, relative without one; the script keeps the visitor's `#fragment` unless the target has its own. Paths are percent-encoded per segment, attributes HTML-escaped, the script string JSON-escaped. With pretty URLs and a trailing slash, links name the directory (`tools/hammer/`). A stub is never written over a real output (that redirect is `SHADOWED`), so redirects never cause `SF-GEN-0110`.
- **`HTACCESS`** (Apache only) — a marked block in the site-root `.htaccess`, one anchored `RedirectMatch` per source URL path, sorted (decision amended by the user on 2026-09-27: `Redirect` matches by *prefix*, so a directory source `/about/` would also redirect a live `/about/team/`):

  ```apache
  # BEGIN StaticForge redirects
  RedirectMatch 301 "^/about/(?:index\.html)?$" "/company/"
  RedirectMatch 301 "^/products/hammer\.html$" "/tools/hammer.html"
  # END StaticForge redirects
  ```

  URL paths are what visitors request: `/` + the link path, below the path of `baseUrl` when it has one (`https://example.com/docs` → `^/docs/…$`), a directory for an index file with pretty URLs and a trailing slash — and a directory source also matches its index file (`(?:index\.html)?`), since the old site served the page under both URLs. The source is the *decoded* path (mod_alias matches the %-decoded request path) with the regex metacharacters `\ . + * ? ^ $ | ( ) [ ] { }` escaped; the target is percent-encoded (an absolute URL as it is) with `$`, `&` and `\` escaped, so no backreference substitution happens; both are double-quoted with `"` as `\"`. When the build has a `.htaccess` of its own (a page whose template writes one), the block is appended to it; a block a previous build appended is replaced, never duplicated. The file is written whenever the format is configured, with an empty block when nothing redirects. Apache needs `AllowOverride FileInfo` for the directory; nginx ignores `.htaccess` (use HTML stubs there).
- **`JSON`** — `redirects.json` at the site root: `[{from, to, channel, locale, status: 301}]`, `from`/`to` as output paths (`to` possibly with query and fragment, or an absolute URL), `locale` `""` without languages; written, possibly `[]`, whenever the format is configured. (Before M30 the file was specified but never written.)

`SF-CHK-0109` (§18.8) reports links that reach only a redirect source of the build, so templates and content can link the page's current URL.

**The URL registry and redirects.** Since M32 the URL registry decides where every output is written (§18.3), so a page that moves keeps its file and its links at its registered URL until the row is reset or overridden. Then the next build — incremental too (`URL_CHANGED`) — writes the file at the new URL, re-renders every page linking it, and detection adds the `AUTO` redirect from the old path.

**Export and import.** A full-project archive (protocol 10, §26.5) carries the registry as `redirects.json` — `AUTO` and `MANUAL` entries, page targets as asset uuids (they survive import). Selective exports carry none. Importing adds each redirect whose source path is free; one whose channel, language and source path already redirect is skipped with the warning `REDIRECT_SOURCE_EXISTS`, one that doesn't fit the project (unknown channel or language, a malformed path) with `REDIRECT_INVALID`; neither blocks the import. An archive of protocol ≤ 9 imports without redirects.

---

## 19. Preview

### 19.1 Modes

| Mode | Description | Path |
|---|---|---|
| **Page preview** | Renders the page's current stored revision; used in the split-view editor, refreshed after each autosave | `GET /projects/{p}/preview/pages/{uuid}` |
| **Revision preview** | Renders any past revision | `GET …?revision=1841` |
| **Section preview** | Renders one section instance in isolation with sample surroundings | `POST /projects/{p}/preview/section` |
| **Channel preview** | Any of the above in a non-default channel; non-HTML channels render as syntax-highlighted text | `?channel=markdown` |
| **Paginated page** | Page *n* of a paginated page (M21), clamped to `1..total`; `X-SF-Total-Pages`/`X-SF-Page` response headers; also on the share route, as a plain parameter outside the token | `?page=2` |
| **Draft / published view** (M27) | `draft` (default) renders the page's draft and the drafts of everything it reads; `published` renders what the next build publishes — the release state at the preview revision, navigation included. `X-SF-View` names the view; a draft preview carries the page's status in the language in `X-SF-Release-Status`. A page not released in the language is `404 SF-DOM-0155` in the published view; `400` for any other value. Section preview is draft only | `?view=published` |

### 19.2 Mechanics

- Preview uses the **same** render engine and the same compiled templates as generation. There is no second code path — a preview that renders is a build that renders.
- Preview output is served from a dedicated, sandboxed route: `Content-Security-Policy: sandbox allow-scripts allow-same-origin`, `X-Frame-Options` allowing only the app origin, and a per-request nonce.
- `$CMS_REF` targets are rewritten to preview URLs (`/api/v1/projects/{p}/preview/pages/{uuid}`) so navigation inside the preview iframe stays inside the CMS. A "preview link rewriting" toggle lets developers inspect raw output paths. A folder link (`$CMS_REF(folder:…)`, M31) opens the folder's index page (§10.2, resolved in the preview's view with the channel's `indexUid`); a folder without an index page renders an empty href — a preview has no directory to show (before M31 it issued a page share token for the folder's uuid, which led nowhere).
- **URLs (M32).** With link rewriting off, page, media, folder and navigation links resolve through the URL registry's `PREVIEW` area in the preview's language — the stored URL, or the one computed from the drafts, which is stored (a URL another output holds is used but not stored). The previewed page registers its own URL too (current draft only). `PREVIEW` and `GENERATED` rows are independent.
- Media references resolve to the live media endpoint, so unpublished images appear immediately. The link is a signed share URL pinned to the preview's revision; a processed text media file (§16.12) is served **rendered** at that revision, with its own media links rewritten the same way and `Cache-Control: no-store`. If it doesn't compile or render, its source is served with the diagnostic in `X-SF-Render-Error`, so one broken stylesheet doesn't break the preview.
- The editor's preview frame loads the server-rendered document as `srcdoc` in a sandbox **without** `allow-same-origin` (M18): stylesheets and scripts of the page run, but in an opaque origin that can't reach the application.
- The client never sends rendered data (content, bodies, or meta) to preview a page — only the page's `uuid` and, optionally, a `revision` to pin to. The server resolves everything else from the database, the same way it would for generation, so there is exactly one source of truth for what a page currently contains. In the split-view editor this means the preview pane reflects the page's state as of its last autosave, not literally-unsaved keystrokes; it is debounced (400 ms) and refetches whenever autosave completes.

### 19.3 In-app affordances

- Split view: editor left, preview right; the divider is draggable and the ratio persists per user.
- Viewport switcher: mobile 375, tablet 768, desktop 1280, full width.
- **Section highlighting:** rendered sections carry `data-sf-instance="{instanceId}"`; clicking a section in the preview focuses its editor form, and focusing a form field scrolls/outlines the section. Implemented with a tiny injected script that is present only in preview output.
- Preview share links: a signed, expiring URL (`?t=<jwt>`, 7 days, read-only) for stakeholders without accounts. Scope: one page, one revision, one language, one view (M27: the share dialog chooses "Draft (latest saved)" or "Published", the token binds it, and every link inside the shared preview keeps it; a token without a view — every pre-M27 token — shows the draft).
- **Draft | Published toggle (M27).** The preview toolbar switches the view (remembered per browser, default Draft). Draft mode shows "Draft — {status}" under the toolbar and refreshes after each autosave; the published view refreshes only on release actions, language or page changes. A page not published in the language shows an empty state "Not published in {language}" instead of an error.

### 19.4 Draft checks (M30)

`POST /projects/{p}/preview/pages/{uuid}/checks?channel=&locale=&page=&revision=` (VIEWER; read-only, so allowed on archived projects) runs the quality checks (§18.8) on the page's **draft** while it is being edited — no build involved, nothing stored. `channel` defaults to `html`, `locale` to the project's default language, `page` to the first page (a paginated page's number, clamped to its page count); `revision` checks the drafts at a past revision (time travel). It renders the page as a build of the drafts would write it (`SnapshotView.DRAFT`: the page's draft and the drafts of everything it reads, like the default preview), without preview link rewriting, so hrefs are the real output paths, relative to the page's own; runs the project's enabled page rules on the document and the link rules against an index of the draft's planned output paths (every page output the planner computes over the draft, in every channel and language, every media file and variant, and the site files of the project's default target — other pages are not rendered), and answers:

```json
{ "completeness": [ {"path": "content.title", "code": "required", "severity": "ERROR", "message": "…", "kind": "COMPLETENESS"} ],
  "findings": [ {"code": "SF-CHK-0301", "name": "Image without alt attribute", "category": "ACCESSIBILITY", "severity": "WARNING",
                 "fixHint": "CONTENT_OR_TEMPLATE", "message": "…", "selector": "section:nth-of-type(2) > img",
                 "sectionInstanceId": "c3d4…", "editorPath": "bodies.main[1].content.image"} ],
  "checkedChannel": "html", "checkedLocale": "de", "checkedPage": 1,
  "skippedRules": ["SF-CHK-0103", "SF-CHK-0107", "SF-CHK-0109", "SF-CHK-0205", "SF-CHK-0206", "SF-CHK-0210"] }
```

`completeness` is the rule engine's `edit`-scope outcome for the stored draft — the page's `issues` (§10.5), findings of every level with their `rule`, `scopes`, `locale` — always returned. `findings` lists the page rules' findings first, then the link rules'; each carries its rule's `name` and `fixHint` (§18.8), so a client needs no catalogue. `checkedLocale` is `null` in a project without languages; `checkedPage` is the page number after clamping. Errors: `404` for a page that doesn't exist (or is deleted) at the revision, `400` for a channel or language the project doesn't have, `422` with the template's code when the page's templates don't compile or its render hits a limit (as its preview does).

The enabled rules that need the whole build are not run and are listed in `skippedRules`: held-back targets (`SF-CHK-0103`), redirects (`0109`), duplicates (`0205`, `0206`) and alternates (`0210`); `0107` runs in part — only fragments on the page itself — and is listed too. A rule switched `OFF` is not listed. Drafts are the view, so a link to a page that is drafted but not released is **not** `SF-CHK-0104` here, while a build reports it. A non-HTML channel, or a page whose template writes nothing in the channel, returns `findings: []` with every enabled rule in `skippedRules`.

**Section markers.** Only this check render wraps each rendered section instance in `<!--sf:section {instanceId}-->…<!--/sf:section-->`, and only where a comment is harmless: in body text — never inside a tag or attribute, a comment, `<head>` or a raw-text element (`script`, `style`, `title`, `textarea`, …); a section rendered there is left unmarked, its markup exactly as generation writes it. Preview and generation output never contain markers. A finding on an element inside marked sections carries the innermost instance's `sectionInstanceId`. `editorPath` names the field of the page's content to fix: for a link finding from a reference event (`0101`, `0104`, `0105`), the field that holds the reference; for `SF-CHK-0301`/`0302` on an image whose `src` is a media file of the draft that a field of the page references, that field (`bodies.main[1].content.image`); otherwise `null`. A finding at a field of a body section without a section of its own gets that section's instance id.

**Rate limit.** Each user may run at most `sf.preview.rate-limit.checks-per-minute` (default 60) draft checks in any sliding minute (per node, in memory); one more is refused with `429 SF-API-0429` and a retry-after hint. The plain preview (`GET …/preview/pages/{uuid}`) is not limited. The page editor calls the endpoint once per completed autosave (debounced), not per keystroke (§24.5).

### 19.5 Rule evaluation (M33)

`POST /projects/{p}/rules/evaluate` (VIEWER; stores nothing, so allowed on archived projects) runs the `edit` scope of the editor rules (§10.5, §14.8) on an unsaved value, reading **drafts** (`ref`, `global:`). Body:

```json
{ "kind": "PAGE", "assetUuid": "018f6b31-…", "templateUid": null, "datasetUid": null, "globalSetUid": null,
  "content": { "title": "Spring sale", "slug": "" }, "bodies": { "main": [ … ] }, "locale": "de", "changedPaths": ["title"] }
```

`kind` is `PAGE`, `SECTION`, `RECORD` or `GLOBAL_SET` (missing or other: `400`). The definition comes from `templateUid` / `datasetUid` / `globalSetUid`, else from the stored asset `assetUuid` (its template, dataset or own CDL); an unknown definition is `404`. `PAGE` evaluates `content` and `bodies`, section instances' rules included; `SECTION` evaluates a section template on its own (no `section.page`). `locale` limits the evaluation to that language plus the default one (an undeclared language is `400`); without it every project language is evaluated. `changedPaths` is accepted; the whole value is evaluated. Answer:

```json
{ "findings":    [ {"path": "title", "code": "rule", "rule": "title-length", "severity": "WARNING", "message": "Keep titles under 70 characters (82)",
                    "kind": "COMPLETENESS", "scopes": ["EDIT", "SAVE"], "messages": {"en": "…", "de": "…"}, "locale": "de", "onGeneration": "HOLD_BACK"} ],
  "fills":       [ {"path": "slug", "locale": null, "value": "spring-sale", "mode": "EMPTY"} ],
  "fieldStates": [ {"path": "teaser", "locale": null, "required": true, "readOnly": false, "computed": false} ] }
```

`fills` are the `edit` fills' values (the client decides where to apply them, §23.5); `fieldStates` carry `requiredWhen` / `readOnlyWhen` results, `computed` meaning read-only because of a `mode always` fill. Messages are resolved in the `Accept-Language` UI language. The endpoint shares the draft-check budget (`sf.preview.rate-limit.checks-per-minute`, default 60, per user): `429 SF-API-0429` beyond it.

---

## 20. REST API specification

### 20.1 Conventions

- Base path `/api/v1`. Versioned by path; breaking changes bump to `/api/v2`.
- JSON only (`application/json;charset=UTF-8`), except media upload (`multipart/form-data`) and media download.
- **Errors:** RFC 9457 `application/problem+json`.
- **Pagination:** `?page=0&size=50&sort=displayName,asc`; envelope `{ "content": [...], "page": {...} }`.
- **Filtering:** explicit query parameters (`?type=PAGE&folder=/products/&q=hammer&updatedSince=…`). No generic query language in v1.
- **Concurrency:** `ETag` = `"rev-{validFromRevision}"`; mutations require `If-Match`.
- **Idempotency:** `Idempotency-Key` header honoured on `POST` create endpoints for 24 h.
- **Partial responses:** `?fields=uuid,uid,displayName` on list endpoints.
- Times are ISO-8601 UTC with offset.

### 20.2 Endpoint catalogue

**Auth** — see §9.4.

**Projects**

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/projects` | authenticated | Only projects the user is a member of, archived ones left out; every project for instance admins |
| `POST` | `/projects` | INSTANCE_ADMIN | Creates revision 1 |
| `GET` | `/projects/{key}` | VIEWER | With `publishPolicy {editor}` and `permissions` — the caller's effective publish permissions (M28) |
| `PUT` | `/projects/{key}` | PROJECT_ADMIN | |
| `PUT` | `/projects/{key}/code-highlighting` | PROJECT_ADMIN | Body `{extensions: {ext: format}, mimeTypes: {mime: format}}` replaces the code highlighting overrides (M33 follow-up, §24.5) → the project detail (`codeHighlighting`); `400 SF-API-0400` with `errors` (malformed extension or MIME type, unknown format); an identical body records nothing, otherwise one `UPDATE` revision (`PROJECT`, field `codeHighlighting`) |
| `POST` | `/projects/{key}/archive` | INSTANCE_ADMIN | Read-only and hidden from members (§8.1); `204` |
| `POST` | `/projects/{key}/unarchive` | INSTANCE_ADMIN | Reverses archive; `204` |
| `GET` | `/projects/{key}/members` | VIEWER | `{userId, username, displayName, email, status, role, grantedAt, grantedBy}`; `email` only for PROJECT_ADMIN and instance admins |
| `PUT` | `/projects/{key}/members/{userId}` | PROJECT_ADMIN | Add or set role `{role}`; a disabled or deleted account is `409` |
| `DELETE` | `/projects/{key}/members/{userId}` | PROJECT_ADMIN | |
| `GET` | `/projects/{key}/audit` | PROJECT_ADMIN | The project's audit entries, newest first |
| `GET` | `/projects/{key}/publish-policy` | VIEWER | `{editor: [...]}`, in declaration order (M28, §8.3) |
| `PUT` | `/projects/{key}/publish-policy` | PROJECT_ADMIN | Body `{editor}`; `400 SF-API-0400` with `errors` (unknown name, broken implication); an identical policy is `200` with no revision and no audit; otherwise one revision + `PUBLISH_POLICY_SET` |
| `POST` | `/projects/{key}/publish-policy/impact` | PROJECT_ADMIN | Body = a proposed policy → `{failingSchedules: [{id, type, runAt, ownerUserId, ownerName, missingPermission}]}`: the pending schedules whose owner satisfies them now but wouldn't under the proposal (`runAt` = next run); read-only, allowed on archived projects |
| `GET` | `/projects/{key}/compaction` | PROJECT_ADMIN | Revision compaction (M29, §7.7): `{enabled, olderThanDays, enabledAt, enabledBy, compactedThrough, lastRun}`; `lastRun` = this project's entry of the newest `revision-compaction` run that reported on it, or `null` |
| `PUT` | `/projects/{key}/compaction?confirm=<key>` | PROJECT_ADMIN | Body `{enabled, olderThanDays?}`; enabling or lowering needs `confirm` = the project key (`422 SF-DOM-0182`), `olderThanDays` < 30 is `422 SF-DOM-0183`; audited `COMPACTION_POLICY_SET`, no revision |
| `GET` | `/projects/{key}/compaction/estimate?olderThanDays=N` | PROJECT_ADMIN | Dry run → `{olderThanDays, cutoff, versionsInWindow, versionsRemoved, assetsTouched, referencesRewritten, revisionsMarked, bytesFreed}`; allowed on archived projects |
| `GET` | `/projects/{key}/quality-rules` | VIEWER | Every quality rule (§18.8), in code order: `{rules: [{code, name, category, kind, description, fixHint, defaultSeverity, severity, maxSeverity, params: [{name, type, value, defaultValue, min, max, description}], channels}]}` (M30) |
| `PUT` | `/projects/{key}/quality-rules` | DEVELOPER | Body `{rules: {code: {severity?, params?}}}` replaces the whole configuration (a rule left out is at its default) → the `GET` shape; `400 SF-API-0400` with `errors` (one message per problem); a change is one revision + `QUALITY_RULES_UPDATED`, an unchanged body records nothing (M30) |

**Users and administration (M26)** — `/admin/**` is instance admin only (`403` otherwise).

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/users/lookup?projectKey=&q=` | PROJECT_ADMIN of `projectKey` | At most 20 `ACTIVE`/`LOCKED` accounts `{id, username, displayName, member}`, never emails |
| `GET` | `/admin/users?q=&status=&systemRole=&includeDeleted=&page=&size=&sort=` | INSTANCE_ADMIN | Paged (`size` ≤ 200, default sort `username`); `q` matches username, email, display name; row `{id, username, displayName, email, status, systemRole, mustChangePassword, lastLoginAt, projectCount}` |
| `GET` | `/admin/users/{id}` | INSTANCE_ADMIN | Row plus `createdAt, failedLogins, lockedUntil, memberships[{projectKey, projectName, archived, role, grantedAt, grantedBy}]` |
| `POST` | `/admin/users` | INSTANCE_ADMIN | `{username, email, displayName?, systemRole, password? \| generatePassword: true, mustChangePassword = true, memberships?: [{projectKey, role}]}` → `201` detail; `generatedPassword` only in this response |
| `PATCH` | `/admin/users/{id}` | INSTANCE_ADMIN | `{username?, email?, displayName?}`; duplicates `409` with `field` |
| `POST` | `/admin/users/{id}/disable` · `/enable` · `/unlock` | INSTANCE_ADMIN | → detail; disable revokes every session |
| `POST` | `/admin/users/{id}/password` | INSTANCE_ADMIN | `{password? \| generatePassword, mustChangePassword = true}` → detail (+ `generatedPassword`); revokes every session |
| `POST` | `/admin/users/{id}/revoke-sessions` | INSTANCE_ADMIN | `204` |
| `PUT` | `/admin/users/{id}/system-role` | INSTANCE_ADMIN | `{systemRole}`; revokes every session |
| `DELETE` | `/admin/users/{id}?confirm=<username>` | INSTANCE_ADMIN | Anonymizing delete (§8.2); `400` when `confirm` doesn't match |
| `GET` | `/admin/projects?q=&includeArchived=true` | INSTANCE_ADMIN | Every project by key: `{key, name, description, archived, createdAt, memberCount, headRevision, lastChangeAt}` |
| `GET` | `/admin/audit?action=&userId=&project=&from=&to=&page=&size=` | INSTANCE_ADMIN | Every audit entry, newest first; `action` repeatable, `project` a key or `_instance`, `from` inclusive / `to` exclusive ISO instants; row `{id, timestamp, action, actor{id, username}, projectKey, target, detail}` (`Deleted user` for a deleted actor) |
| `GET` | `/admin/audit/actions` | INSTANCE_ADMIN | Distinct action names |
| `GET` | `/admin/jobs` | INSTANCE_ADMIN | System jobs (M29, §26.6), a plain array by key: `{key, name, description, enabled, cron, zone, settings, defaults, nextRunAt, running, startedAt, currentRunId, progress, supportsDryRun, orphaned, version, updatedAt, lastRun {id, outcome, trigger, dryRun, startedAt, finishedAt, durationMs, itemsExamined, itemsAffected, bytesFreed, message}}`; `defaults` = what *Reset* restores `{enabled, cron, zone, settings}` |
| `GET` | `/admin/jobs/{key}` | INSTANCE_ADMIN | One job, `ETag: "v{version}"`; unknown key `404 SF-DOM-0184` |
| `GET` | `/admin/jobs/{key}/runs?page=&size=` | INSTANCE_ADMIN | Run history, newest first (`size` ≤ 200, default 20), `{content, page}`; run `{id, jobKey, trigger (SCHEDULE\|MANUAL\|STARTUP), dryRun, startedAt, finishedAt, durationMs, outcome (SUCCEEDED\|FAILED\|PARTIAL\|SKIPPED), itemsExamined, itemsAffected, bytesFreed, message, startedBy {id, username}, sample, sampleTotal}` |
| `GET` | `/admin/jobs/{key}/runs/{runId}` | INSTANCE_ADMIN | One run with its full `report` |
| `PATCH` | `/admin/jobs/{key}` | INSTANCE_ADMIN | `{enabled?, cron?, zone?, settings?}` (settings merged), `If-Match: "v{n}"` (`412 SF-API-0412` missing, `409 SF-API-0409` stale); invalid cron, zone or settings `422 SF-DOM-0180` with `errors`; recomputes `nextRunAt`; audited `JOB_SETTINGS_SET` unless nothing changed |
| `POST` | `/admin/jobs/{key}/reset` | INSTANCE_ADMIN | Back to the `sf.housekeeping.*` defaults; audited `JOB_SETTINGS_SET` |
| `POST` | `/admin/jobs/{key}/run?dryRun=` | INSTANCE_ADMIN | `202` with the run and its `Location`; poll until `finishedAt` is set. `409 SF-DOM-0181` while running on any node, `422 SF-DOM-0180` for a dry run of a job without one; audited `JOB_RUN` |

Guard rails on disable, delete and system role: `409 SF-DOM-0131` (last active instance admin), `409 SF-DOM-0132` (yourself); any action on a deleted account is `409`.

**Assets (generic)**

| Method | Path | Notes |
|---|---|---|
| `GET` | `/projects/{p}/assets` | Cross-type list/search, `?type=`, `?q=`, `?folder=` |
| `GET` | `/projects/{p}/assets/{uuid}` | Type-polymorphic representation |
| `GET` | `/projects/{p}/assets/{uuid}/usages` | Inbound references: open edges, or edges valid at `?revision=R` (§5.4) |
| `GET` | `/projects/{p}/assets/{uuid}/history` | Revision list for this asset |
| `GET` | `/projects/{p}/assets/{uuid}/versions/{revision}` | State at revision |
| `POST` | `/projects/{p}/assets/{uuid}/restore` | `{fromRevision}` |
| `PATCH` | `/projects/{p}/assets/{uuid}/uid` | Change UID (DEVELOPER) |
| `POST` | `/projects/{p}/assets/{uuid}/move` | `{folderUuid}` |
| `DELETE` | `/projects/{p}/assets/{uuid}` | Soft delete, `?force=true` to bypass usage warning |

**Pages**

| Method | Path | Notes |
|---|---|---|
| `GET` | `/projects/{p}/pages` | `?folder=`, `?templateUuid=`, `?q=` |
| `POST` | `/projects/{p}/pages` | `{displayName, folderUuid, templateUuid}` |
| `GET` | `/projects/{p}/pages/{uuid}` | Full payload + resolved template definition |
| `PUT` | `/projects/{p}/pages/{uuid}` | Full payload replace (`If-Match`); also autosave. Runs read-only enforcement, save fills and save rules (§10.5); a save-scope `error` is `422 SF-API-0422` with `issues` |
| `PATCH` | `/projects/{p}/pages/{uuid}/content` | JSON-Merge-Patch on `content`/`bodies` |
| `POST` | `/projects/{p}/pages/{uuid}/bodies/{body}/sections` | Add section instance `{templateUuid, position}` |
| `PUT` | `/projects/{p}/pages/{uuid}/bodies/{body}/order` | `{instanceIds:[…]}` |
| `DELETE` | `/projects/{p}/pages/{uuid}/bodies/{body}/sections/{instanceId}` | |
| `POST` | `/projects/{p}/pages/{uuid}/duplicate` | New UUID + UID, same content |

**Folders**

| Method | Path |
|---|---|
| `GET` | `/projects/{p}/folders` (tree, `?depth=`) |
| `POST` | `/projects/{p}/folders` |
| `PUT` | `/projects/{p}/folders/{uuid}` |
| `POST` | `/projects/{p}/folders/{uuid}/move` |
| `DELETE` | `/projects/{p}/folders/{uuid}` (blocked while non-empty unless `?cascade=true`) |

**Media**

| Method | Path | Notes |
|---|---|---|
| `GET` | `/projects/{p}/media` | `?mimeType=image/*`, `?folder=`, `?q=` |
| `POST` | `/projects/{p}/media` | multipart upload |
| `POST` | `/projects/{p}/media/bulk` | multi-file |
| `PUT` | `/projects/{p}/media/{uuid}` | metadata (alt, caption, focal point) |
| `POST` | `/projects/{p}/media/{uuid}/replace` | new binary, same asset identity |
| `GET` | `/projects/{p}/media/{uuid}` | one media view with `localeFiles` (M27); `?revision=` for time travel |
| `GET` | `/projects/{p}/media/{uuid}/binary` | original; `?variant=w800`; `?locale=` the file a language renders (M27) |
| `GET` | `/projects/{p}/media/{uuid}/thumbnail` | 320 px, cached, `Cache-Control: private, max-age=86400`; `?locale=` (M27) |
| `PUT` | `/projects/{p}/media/{uuid}/localized` | `{localized, confirmDiscard?}`, `If-Match`; `409 SF-MEDIA-0505` lists the files un-localizing would discard (§11.6, M27). EDITOR |
| `POST`/`DELETE` | `/projects/{p}/media/{uuid}/files/{locale}` | upload or replace / remove one language's own file (§11.6, M27). EDITOR |

**Templates**

| Method | Path | Notes |
|---|---|---|
| `GET`/`POST` | `/projects/{p}/section-templates` | |
| `GET`/`PUT`/`DELETE` | `/projects/{p}/section-templates/{uuid}` | |
| `GET`/`POST` | `/projects/{p}/page-templates` | |
| `GET`/`PUT`/`DELETE` | `/projects/{p}/page-templates/{uuid}` | |
| `PUT` | `/projects/{p}/{templateKind}/{uuid}/channels/{channelKey}` | Set one OCTL source (the UI saves every channel with the template instead, §14.9) |
| `DELETE` | `/projects/{p}/{templateKind}/{uuid}/channels/{channelKey}` | |
| `POST` | `/projects/{p}/cdl/validate` | `{contentCdl, bodiesCdl?, rulesCdl?}` → diagnostics, each with its section in `field` (§14.9) |
| `POST` | `/projects/{p}/octl/validate` | `{source, channelKey, templateUuid, contentCdl?, bodiesCdl?, rulesCdl?}` → diagnostics |

**Datasets, record sets and records** (M19, M25) — full request/response shapes in `docs/api.md` §6.2–§6.3

| Method | Path | Notes |
|---|---|---|
| `GET`/`POST` | `/projects/{p}/datasets` | Dataset schemas (DEVELOPER writes); `channelTemplates` = per-channel record templates |
| `GET`/`PUT`/`DELETE` | `/projects/{p}/datasets/{uuid}` | `PUT` returns `brokenRecordSets` (sets whose query no longer validates) and `recordTemplateDiagnostics`; `DELETE` is `409 SF-DOM-0121` while records or sets are live |
| `GET` | `/projects/{p}/datasets/{uuid}/records` | Every record of the dataset across its sets (set queries not applied); `q`, `folder`, `where`, `sort`, paging |
| `POST` | `/projects/{p}/datasets/{uuid}/records` | `{recordSetUuid, content}` (EDITOR); the set must be a live set of this dataset (`422 SF-DOM-0104`); without `recordSetUuid` `400` |
| `GET`/`PUT` | `/projects/{p}/records/{uuid}` | A record, with `recordSet {uuid, uid, displayName}` |
| `GET`/`POST` | `/projects/{p}/record-sets` | Sets (`?dataset=`); create `{folderUuid?, datasetUuid, uid?, displayName, query?}` (EDITOR); an invalid query is `422 SF-API-0422` with `diagnostics` |
| `GET`/`PUT`/`DELETE` | `/projects/{p}/record-sets/{uuid}` | `?revision=`; `PUT {displayName?, query?}` (the dataset never changes); `DELETE` is `409 SF-DOM-0110` with records unless `?cascade=true` |
| `GET` | `/projects/{p}/record-sets/{uuid}/records` | The set's grid; `applySetQuery=true` applies the stored query first and the request narrows it |
| `POST` | `/projects/{p}/record-sets/{uuid}/preview-query` | Checks a draft query without saving: `{valid, diagnostics, matchCount, selectedCount}` (EDITOR) |

Move, rename, uid change, history, usages, generic delete and restore of datasets, sets and records use `/assets/{uuid}`, with the containment rules of §5.1.

**Channels** — see §15.3. **Structures** — same shape as templates under `/structures`.

**Generation**

| Method | Path | Notes |
|---|---|---|
| `GET` | `/projects/{p}/generations` | Run history |
| `POST` | `/projects/{p}/generations` | Start run (§18.1): EDITOR at the annotation, then the body decides — `INCREMENTAL_BUILD`, `FULL_BUILD` or `DEVELOPER` (M28) |
| `GET` | `/projects/{p}/generations/{id}` | Status + diagnostics |
| `GET` | `/projects/{p}/generations/{id}/events` | SSE progress |
| `POST` | `/projects/{p}/generations/{id}/cancel` | DEVELOPER any run; an EDITOR holding `INCREMENTAL_BUILD` a run they started (M28). The run stops before its next page or stage and never publishes (M29, §18.5) |
| `POST` | `/projects/{p}/generations/{id}/promote` | Rollback to a previous build (DEVELOPER); a run that isn't `SUCCESS`/`PARTIAL`, has no target or whose build is gone is `409 SF-GEN-0505` (M29) |
| `POST` | `/projects/{p}/generations/plan` | Dry run: the plan and reasons a run started now would have (M22); authorized exactly like a start (M28) |
| `GET` | `/projects/{p}/generations/{id}/plan` | A run's stored plan and reasons (M22) |
| `GET` | `/projects/{p}/generations/{id}/findings` | A run's quality findings (M30, §18.5), sorted by output path, then code: `page`, `size` ≤ 200 (default 50), filters `severity` (`WARNING`\|`ERROR`), `category` (`LINKS`\|`SEO`\|`ACCESSIBILITY`), `code` (repeatable), `assetUuid`, `channel`, `locale`, `pathPrefix` → `{content: [{id, code, category, severity, message, selector, sectionInstanceId, carried, outputPath, channel, locale, pageNumber, page: {uuid, uid, displayName}}], page}`; an invalid filter `400`, a run of another project `404` |
| `GET` | `/projects/{p}/assets/{uuid}/impact` | What would rebuild if the asset changed (M22) |
| `GET`/`POST`/`PUT`/`DELETE` | `/projects/{p}/targets[/{id}]` | Target CRUD: read VIEWER, create DEVELOPER, update and delete PROJECT_ADMIN; `config.redirectFormats` (M30, §18.4) validated on create and update, the view carries the effective `redirectFormats` |

History, status, events, stored plans and findings are VIEWER. Run views carry `comment` and `startedBy` (§18.5), and since M30 `findingCounts` and, in `planSummary`, `redirectsAdded`/`redirectsActive`; the dry run adds `redirectCandidates` (§18.9). Every `403` of these endpoints, the release and schedule endpoints and the publish-policy endpoints carries `permission` (Appendix B).

**Search** (M23) — editorial full-text search over a project's *current* assets, from an embedded per-project index
kept after commit (§21.4). Time travel doesn't change what it returns.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/projects/{p}/search` | `?q=` (required, 1–200 chars), `type` (repeatable), `folder` (path prefix), `page`, `size` (≤ 100), `sort=relevance` only. `{content: [{uuid, type, uid, displayName, folderPath, templateUuid, score, matchedIn, snippet, highlights: [{start, end}]}], page: {…, totalIsLowerBound}, facets: {types}, indexedRevision, latestRevision}`. Facet counts ignore the `type` filter. Snippets are plain text; highlights are offsets into them. VIEWER |
| `GET` | `/projects/{p}/search/status` | `{indexedRevision, latestRevision, lag, state: READY\|CATCHING_UP\|REBUILDING\|UNAVAILABLE, lastRebuildAt}`. VIEWER |
| `POST` | `/projects/{p}/search/reindex` | Full rebuild without query downtime; `202` with the status, `409` while one runs. PROJECT_ADMIN |

**Releases and changes** (M27, §5.5, §10.4; `RELEASE` in the role column is the publish permission, §8.3 — developers always, editors per the policy, M28) — body of the release calls: `{items: [{assetUuid, locale?}], includeDependencies?: [{assetUuid, locale?}], comment?, acceptWarnings?}` (`acceptWarnings` only for `POST /releases`); an item without `locale` means every language of the asset.

| Method | Path | Role | Notes |
|---|---|---|---|
| `POST` | `/projects/{p}/releases/plan` | VIEWER | Dry run: `{items, dependencies: [{target, reason, via, includedByDefault}], incomplete: [{uuid, locale, issues}], warnings, warningFindings, infoFindings, fills: [{uuid, locale, path, value}]}` — `incomplete`/`warningFindings`/`infoFindings` are the rule errors, warnings and infos (M33, §5.5), `warnings` the pinned-version notes; allowed on archived projects |
| `POST` | `/projects/{p}/releases` | `RELEASE` | Releases `items` + the kept `includeDependencies` in one revision → `{revision, applied, skipped, sharedFieldsKept}` (`revision: null` when nothing changed) and, since M33, `warnings` (the accepted rule warnings); body field `acceptWarnings` (default `false`); `release` fills are written in the release revision (§5.5); `422 SF-DOM-0150` rule errors, `0156` rule warnings without `acceptWarnings`, `0151` unknown asset/locale or a live type, `0153` empty selection, `0154` foreign pinned version |
| `POST` | `/projects/{p}/releases/unpublish` | `RELEASE` | Takes the items offline; drafts stay |
| `POST` | `/projects/{p}/releases/discard` | `RELEASE` | Writes the released versions back as drafts; `422 SF-DOM-0152` for items never released |
| `GET` | `/projects/{p}/changes` | VIEWER | Every (asset, locale) not `PUBLISHED`: `type`, `status`, `locale` (repeatable), `changedBy`, `folderUuid` (subtree), `q`, `sort=changedAt\|displayName[,asc\|desc]`, `page`, `size` ≤ 200 → `{rows: [{uuid, type, uid, displayName, folderPath, locale, status, changedBy, changedAt, releasedRevision, releasedBy, releasedAt, scheduled}], page, size, totalElements, totalPages}` |
| `GET` | `/projects/{p}/changes/count` | VIEWER | `{NEW, CHANGED, UNPUBLISHED, DELETION_PENDING, total}` |
| `GET` | `/projects/{p}/changes/{uuid}/diff` | VIEWER | `?locale=` → `{uuid, locale, status, changes: [FieldChange]}`: released → draft, per locale projection |

**Schedules** (M27, §18.7) — every endpoint is VIEWER; changes check the action's requirements for the caller (M28: `SCHEDULE_RELEASE`, plus the build permission of a "then generate", for `RELEASE`/`UNPUBLISH`; `DEVELOPER` for `GENERATION`/`RECURRING_GENERATION`; `DEVELOPER` on top to change, run now, re-pin or cancel someone else's; take-over only the requirements), `403 SF-API-0403` with `permission` otherwise. Responses carry `ETag: "v{version}"`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/projects/{p}/schedules` | `type`, `status` (repeatable), `owner`, `assetUuid`, `from`/`to` (on `nextRunAt`), `page`, `size` ≤ 200; next due first; rows without `items` |
| `POST` | `/projects/{p}/schedules` | `{type, runAt? \| cron + zoneId, pinPolicy?, missedPolicy?, maxLateness?, thenGenerate?, params}`; `422 SF-DOM-0160`–`0166` and the release codes |
| `GET`/`PUT` | `/projects/{p}/schedules/{id}` | detail with `items` (drift per item) / edit a `PENDING` schedule (`If-Match: "v{n}"`, `409 SF-API-0409` stale, `412` missing; omitted `params` keep the stored ones) |
| `POST` | `/projects/{p}/schedules/{id}/cancel` \| `/take-over` \| `/run-now` \| `/repin` | lifecycle actions (§18.7); `409 SF-DOM-0167` while executing, `422 0168` re-pin of anything but a pinned release |
| `GET` | `/projects/{p}/schedules/{id}/executions` | newest first: `{scheduledFor, startedAt, finishedAt, outcome, lateByMs, message, detail, revisionId, generationRunId, executedAsUserId}` |
| `POST` | `/projects/{p}/schedules/preview-times` | `{cron, zoneId, count?}` → `{cron (normalized), zoneId, times}`; validated like a create; allowed on archived projects |

Every releasable asset view (pages, records, record sets, global sets, media, page references, editorial folders, their list rows and tree nodes, `GET /assets/{uuid}`) carries `release` and `scheduled` (§5.5). `GET /search` takes `releaseStatus` (repeatable) as a filter. Project import takes `releaseMode=KEEP|DRAFT` and `importSchedules` (M27.8), the selection export `includeSchedules` (§26.5).

**Redirects** (M30, §18.9) — writes are refused on archived projects (`409 SF-DOM-0141`)

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/projects/{p}/redirects` | VIEWER | Filters `channel`, `locale`, `kind` (`AUTO`\|`MANUAL`), `state` (`ACTIVE`\|`SHADOWED`\|`DANGLING`\|`LOOP`; nothing matches while the default target has no build), `q` (part of the source or fixed target path), `page`, `size` ≤ 200 (default 50); sorted by channel, locale, source path → `{rows: [RedirectView], page, size, totalElements, totalPages, basisRunId}` |
| `GET` | `/projects/{p}/redirects/{id}` | VIEWER | One redirect, `ETag: "v{version}"`; `404 SF-DOM-0190` unknown |
| `POST` | `/projects/{p}/redirects` | DEVELOPER | Manual redirect `{channel, locale, fromPath, toAssetUuid + toPageNumber? \| toPath}`; `409 SF-DOM-0191` duplicate source, `422 SF-DOM-0192` loop, `422 SF-DOM-0193` invalid; audited `REDIRECT_CREATED` |
| `PUT` | `/projects/{p}/redirects/{id}` | DEVELOPER | Same body, `If-Match: "v{version}"` (`412` missing, `409 SF-API-0409` stale); an `AUTO` entry becomes `MANUAL`; audited `REDIRECT_UPDATED` |
| `DELETE` | `/projects/{p}/redirects/{id}` | DEVELOPER | `AUTO` entries too; `If-Match` optional, checked when sent; `204`; audited `REDIRECT_DELETED` |
| `POST` | `/projects/{p}/redirects/for-asset` | `RELEASE` | `{assetUuid, toAssetUuid \| toPath}` → the `MANUAL` redirects written, one per current page output of the asset in the default target's build; `422 SF-DOM-0194` without one |
| `GET` | `/projects/{p}/url-registry` | VIEWER | URL registry rows (M32.7), filters `channelKey`, `area`, `targetType` (`PAGE`, `MEDIA`, `FOLDER`), `locale` (`""` = without a language), `targetUuid`, `q` (URL, or the target's display name or uid), paged, sorted by URL; each row joins the target's `targetLabel`, `targetUid`, `targetPath`, `targetDeleted` |
| `GET` | `/projects/{p}/url-registry/assets/{uuid}` | VIEWER | One asset's rows (both areas) and, for a pages folder, `indexPages` per channel (the page whose URL it uses) |
| `PUT` | `/projects/{p}/url-registry` | DEVELOPER | Manual URL for a target `{targetType, targetUuid, variant?, pageNumber?, channelKey, area, locale?, url}`, with or without a row; `409 SF-DOM-0200` taken, `422 SF-DOM-0201` invalid |
| `PATCH` | `/projects/{p}/url-registry/{id}` | DEVELOPER | Manual URL for an existing row `{url}`; same errors |
| `POST` | `/projects/{p}/url-registry/reset` | PROJECT_ADMIN | Deletes rows: `{entryId}`, `{targetUuid, area?}` (every row of one asset), `{channelKey}`, `{area}`, or `{}` (the project); the next build or preview reassigns them |

`RedirectView`: `{id, channel, locale, fromPath, toAssetUuid, toPageNumber, toAssetName, toPath, kind, state, resolvedTarget, createdAt, createdBy, sourceRunId, updatedAt, updatedBy, version}` — `state` and `resolvedTarget` against the default target's current build (`null` without one), `locale` `""` without languages, `createdBy` `null` for `AUTO`.

**Revisions**

| Method | Path |
|---|---|
| `GET` | `/projects/{p}/revisions` (`?since=`, `?userId=`, `?assetUuid=`) |
| `GET` | `/projects/{p}/revisions/{r}` |
| `GET` | `/projects/{p}/revisions/{r}/diff` |
| `POST` | `/projects/{p}/restore` (`{toRevision}`, PROJECT_ADMIN) |

Revision views carry `compacted`, diffs `compacted` and `message` (per asset `compacted`), point-in-time asset reads and asset restores `compacted`; typed time-travel reads, the draft preview at a revision and project restore send `X-SF-Compacted: true` instead (M29, §7.7).

**Editor rules** (M33) — `POST /projects/{p}/rules/evaluate`, VIEWER, allowed on archived projects, rate limited per user on the draft-check budget (`429 SF-API-0429`): `{kind, assetUuid?, templateUid?, datasetUid?, globalSetUid?, content, bodies?, locale?, changedPaths?}` → `{findings, fills: [{path, locale, value, mode}], fieldStates: [{path, locale, required, readOnly, computed}]}` (§19.5). Saves of pages, records and property sets return `422 SF-API-0422` with `issues` when a save-scope rule `error` fails (§10.5); `PageView`, `RecordDetailView` and `GlobalSetDetailView` carry `issues`.

**Preview** — see §19.1. Draft checks (M30): `POST /projects/{p}/preview/pages/{uuid}/checks?channel=&locale=&page=&revision=`, VIEWER, allowed on archived projects, rate limited per user (`429 SF-API-0429`, §19.4).

### 20.3 Representative payloads

`POST /api/v1/projects/acme_site/pages`

```json
{
  "displayName": "Autumn collection",
  "folderUuid": "018f6a10-…",
  "templateUuid": "018f6a20-…"
}
```

`201 Created`, `Location: /api/v1/projects/acme_site/pages/018f6b31-…`, `ETag: "rev-1842"`

```json
{
  "uuid": "018f6b31-…",
  "uid": "autumn_collection",
  "displayName": "Autumn collection",
  "assetType": "PAGE",
  "folder": { "uuid": "018f6a10-…", "path": "/campaigns/" },
  "revision": 1842,
  "createdAt": "2026-08-19T09:14:22Z",
  "createdBy": { "id": 12, "displayName": "Elena Farkas" },
  "template": { "uuid": "018f6a20-…", "uid": "standard_page", "displayName": "Standard page" },
  "content": {},
  "bodies": { "main": [], "sidebar": [] },
  "nav": { "visible": true, "position": 0 },
  "_links": {
    "self":    { "href": "/api/v1/projects/acme_site/pages/018f6b31-…" },
    "preview": { "href": "/api/v1/projects/acme_site/preview/pages/018f6b31-…" },
    "history": { "href": "/api/v1/projects/acme_site/assets/018f6b31-…/history" }
  }
}
```

Error example — `409 Conflict`:

```json
{
  "type": "https://cms.example.com/problems/revision-conflict",
  "title": "The asset changed since you loaded it",
  "status": 409,
  "detail": "Expected revision 1841, current revision is 1844.",
  "instance": "/api/v1/projects/acme_site/pages/018f6b31-…",
  "code": "SF-API-0409",
  "expectedRevision": 1841,
  "currentRevision": 1844,
  "changedBy": { "id": 7, "displayName": "Paul Ricci" },
  "changedAt": "2026-08-19T09:12:05Z"
}
```

---

## 21. Backend implementation

### 21.1 Package structure (`sf-domain`, `sf-api`)

```
com.acme.staticforge
├── common/            SfException hierarchy, Problem factory, Slugifier, JsonUtil
├── project/           Project, OutputChannel, ProjectMember, ProjectService, ProjectAuthorizationService
├── user/              AppUser, UserService, PasswordService
├── security/          JwtService, RefreshTokenService, SfJwtAuthenticationConverter, filters
├── revision/          Revision, RevisionCounterRepository, RevisionService, DiffService
├── asset/             Asset, AssetVersion, AssetType, UidGenerator, AssetService, AssetReferenceService
│   ├── page/          PageService, PagePayload, BodyService
│   ├── media/         MediaService, BlobStore, VariantService, MetadataExtractor
│   ├── folder/        FolderService, PathService
│   ├── template/      TemplateService, CdlCompiler, ContentDefinition, ContentValidator
│   └── structure/     StructureService, NavigationBuilder
├── release/           AssetRelease, ReleaseService, ReleaseStatusService, LocaleProjection, ChangesService (M27)
├── scheduler/         ScheduledAction, SchedulerEngine, LeaseClaimer, ScheduleService, actions/ (M27)
├── render/            OctlLexer, OctlParser, CompiledTemplate, RenderContext, Renderer, filters/
├── generate/          GenerationService, BuildPlanner, RenderTask, targets/, postprocessors/
├── preview/           PreviewService, PreviewLinkRewriter, PreviewTokenService
└── api/               controllers/, dto/, mapper/, ProblemExceptionHandler
```

### 21.2 Layering rules

- Controllers hold **no** business logic: validate DTO → call service → map to DTO.
- Services own transactions (`@Transactional` at the service method). Repositories are never transactional entry points.
- Every mutating service method takes an explicit `RevisionContext` (project, user, comment) and calls `revisionService.allocate(...)` **first**, so no write path can bypass revisioning. This is enforced by an ArchUnit rule: no `@Repository` save/delete may be called outside a class annotated `@RevisionAware`.
- DTOs and entities never mix: MapStruct mappers in `api/mapper`.

### 21.3 Key service contracts

```java
public interface AssetService {
    AssetVersionView create(CreateAssetCommand cmd, RevisionContext ctx);
    AssetVersionView update(UUID uuid, UpdateAssetCommand cmd, long expectedRevision, RevisionContext ctx);
    void softDelete(UUID uuid, boolean force, RevisionContext ctx);
    AssetVersionView restore(UUID uuid, long fromRevision, RevisionContext ctx);
    Optional<AssetVersionView> findAt(UUID uuid, long revision);
    Page<AssetSummary> search(AssetQuery query, Pageable pageable);
    List<UsageView> usages(UUID uuid);
}

public interface RevisionService {
    long allocate(long projectId, ChangeType type, String comment, Long userId);
    void appendSummary(long projectId, long revision, AssetChange change);
    RevisionDiff diff(long projectId, long revision);
}

public interface Renderer {
    RenderResult render(CompiledTemplate template, RenderContext context);
}
```

`RenderResult` carries the output, the set of asset UUIDs actually touched (generation uses it to select the media files to copy) and render warnings. It does not feed `asset_reference`: edges are written on save (§5.4), and incremental builds read them from there.

### 21.4 Transactions & consistency

- One HTTP mutation = one transaction = one revision. No cross-request "sessions".
- Reference materialization (`ReferenceMaterializer`, §5.4) runs inside that transaction with the revision just allocated; a rolled-back write leaves no edge rows behind.
- Isolation `READ_COMMITTED`; the revision counter row lock provides the serialization that matters.
- Media bytes are written to the blob store **before** the transaction commits, and orphaned blobs (commit failed) are collected by the nightly `blob-sweep` job (§11.2) — never the reverse order, so a committed asset version always has its bytes.
- Generation runs outside the request transaction: the snapshot is loaded read-only at a pinned revision, so a long build never holds locks.

### 21.5 Caching

Template compilation is cached in two tiers by `CompiledTemplateCache` (`sf-domain`, Caffeine). Only compilation is cached, never rendered output. Template save compiles uncached, since it is authoring-time validation.

| Tier | Used by | Key | Eviction |
|---|---|---|---|
| Per-build memo (`TemplateCompileMemo`), OCTL | generation: VALIDATE, the content rule check and RENDER | `(templateUuid, channel)` | released with the build's snapshot object |
| Per-build memo, CDL | same | `templateUuid` | same |
| Cross-request, OCTL | preview | `(projectId, templateUuid, validFromRevision, channel)` | `sf.cache.compiled-templates.max-size` (2,000), `sf.cache.compiled-templates.idle` (30 min) |
| Cross-request, CDL | preview | `(projectId, templateUuid, validFromRevision)` | same |

- **Per build.** One memo per generation snapshot (held in a weak-keyed cache), shared by every stage and render thread of the run, so each (template, channel) compiles at most once per build. The key needs no revision because the snapshot pins every template source and every `assetType:uid → UUID` mapping for the build.
- **Across requests.** The template version (its own revision: `original_valid_from` when compaction moved it, else `validFromRevision`, M29) and the compiled sources in the key mean a template edit, a time-travel preview or a compacted history never hits another version's entry. OCTL resolution also depends on *other* assets, so each entry records every `assetType:uid` lookup the compile made, including failed ones. On a hit those lookups are re-resolved against the current project resolver; if any answer differs (a renamed, deleted or newly created target), the entry is recompiled and replaced. A stale mapping is never served. Two concurrent misses may both compile; the last write wins.
- Every real compile increments the Micrometer counter `sf.template.compiles{kind=cdl|octl}`.
- Save-time content validation (§10.5) compiles CDL uncached per validation.

Specified but not implemented: `projectAuth` `(userId, projectKey)`, `navigationTrees` and `mediaThumbnails` caches.

### 21.6 Configuration (`application.yml`, excerpt)

```yaml
sf:
  security:
    jwt:
      issuer: https://cms.example.com
      algorithm: RS256
      key-store: file:/etc/staticforge/jwt.p12
      access-token-ttl: 15m
      refresh-token-ttl: 8h
      refresh-token-absolute-ttl: 30d
  media:
    store: filesystem
    root: /var/lib/staticforge/media
    max-upload-size: 100MB
    strip-exif: true
    allowed-mime: ["image/*", "video/mp4", "application/pdf", "text/css", "application/javascript", "font/*"]
  generate:
    parallelism: 16
    output-root: /var/lib/staticforge/out
    keep-builds: 5
    max-file-size: 32MB
    render-timeout: 5s
  quality:                    # M30, §18.5: storage caps of a run's findings (counts stay complete)
    max-findings-per-output: 50    # per rule and output
    max-findings-per-run: 100000
  scheduler:                  # M27, §18.7
    enabled: true             # this node polls for due actions (any polling node is enough)
    poll-interval: 15s
    batch-size: 20
    lease: 2m                 # also the fail-over delay after a node dies
    # node-id: cms-1          # default sf.node-id; must differ between nodes
  node-id: cms-1               # M29: this node's name on generation runs and leases; default <hostname>-<pid>
  housekeeping:                # M29, §26.6: seeds the system jobs' rows; the Jobs page settings win afterwards
    enabled: true              # scheduled and startup runs on this node (false in the test profile)
    zone: UTC
    history-per-job: 200
    blob-sweep: { enabled: true, cron: "30 3 * * *", grace-hours: 24, batch-size: 1000 }
    # … one block per job: sf.housekeeping.<job-key>.enabled / .cron / its settings

spring:
  datasource:
    url: jdbc:postgresql://db:5432/staticforge
    username: ${DB_USER}
    password: ${DB_PASSWORD}
    hikari: { maximum-pool-size: 20 }
  jpa:
    hibernate.ddl-auto: validate        # never create/update — Liquibase owns the schema
    open-in-view: false
    properties.hibernate.jdbc.batch_size: 50
  liquibase:
    change-log: classpath:db/changelog/db.changelog-master.xml
  threads.virtual.enabled: true
```

`ddl-auto: validate` is mandatory in every profile — it turns any drift between Hibernate mappings and the Liquibase schema into a startup failure.

---

## 22. Database, Hibernate & Liquibase

### 22.1 Schema overview

```
app_user ──< project_member >── project ──< output_channel
                                   │
                                   ├──< revision >── (project_id, revision_id)
                                   ├──< project_revision_counter (1:1)
                                   ├──< generation_target ──< generation_run
                                   ├──< scheduled_action ──< scheduled_action_execution   (M27)
                                   │          └──< scheduled_action_asset
                                   └──< asset ──< asset_version
                                         │           │
                                         │           └──< asset_reference
                                         └──< asset_release ──> asset_version   (M27)
blob ──< (asset_version.payload.blobSha256)
refresh_token ──> app_user
asset_uid_history ──> asset
```

### 22.2 Core DDL (logical)

```sql
CREATE TABLE project (
  id                  BIGSERIAL PRIMARY KEY,
  key                 VARCHAR(40)  NOT NULL UNIQUE,
  name                VARCHAR(200) NOT NULL,
  description         TEXT,
  index_uid           VARCHAR(100) NOT NULL DEFAULT 'index',
  settings            JSONB        NOT NULL DEFAULT '{}',
  archived            BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ  NOT NULL,
  created_by          BIGINT       NOT NULL REFERENCES app_user(id)
);

CREATE TABLE asset (
  id            BIGSERIAL PRIMARY KEY,
  uuid          UUID        NOT NULL UNIQUE,
  project_id    BIGINT      NOT NULL REFERENCES project(id),
  asset_type    VARCHAR(30) NOT NULL,
  uid           VARCHAR(120) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  created_by    BIGINT      NOT NULL REFERENCES app_user(id),
  CONSTRAINT uq_asset_project_type_uid UNIQUE (project_id, asset_type, uid)
);
CREATE INDEX idx_asset_project_type ON asset (project_id, asset_type);

CREATE TABLE asset_version (
  id                   BIGSERIAL PRIMARY KEY,
  asset_id             BIGINT       NOT NULL REFERENCES asset(id),
  valid_from_revision  BIGINT       NOT NULL,
  valid_to_revision    BIGINT,
  deleted              BOOLEAN      NOT NULL DEFAULT FALSE,
  display_name         VARCHAR(200) NOT NULL,
  folder_id            BIGINT       REFERENCES asset(id),
  folder_path          VARCHAR(1024) NOT NULL DEFAULT '/',
  template_asset_id    BIGINT       REFERENCES asset(id),
  mime_type            VARCHAR(150),
  size_bytes           BIGINT,
  payload              JSONB        NOT NULL,
  changed_by           BIGINT       NOT NULL REFERENCES app_user(id),
  changed_at           TIMESTAMPTZ  NOT NULL
);
CREATE INDEX idx_av_lookup      ON asset_version (asset_id, valid_from_revision DESC);
CREATE INDEX idx_av_current     ON asset_version (asset_id) WHERE valid_to_revision IS NULL;
CREATE INDEX idx_av_folder_path ON asset_version (folder_path varchar_pattern_ops)
                                   WHERE valid_to_revision IS NULL;
CREATE INDEX idx_av_display     ON asset_version (lower(display_name))
                                   WHERE valid_to_revision IS NULL;

CREATE TABLE asset_reference (
  id                   BIGSERIAL PRIMARY KEY,
  from_asset_id        BIGINT      NOT NULL REFERENCES asset(id),
  valid_from_revision  BIGINT      NOT NULL,
  valid_to_revision    BIGINT,
  to_asset_id          BIGINT      NOT NULL REFERENCES asset(id),
  kind                 VARCHAR(30) NOT NULL,
  source_path          VARCHAR(500)
);
CREATE INDEX idx_ref_to   ON asset_reference (to_asset_id) WHERE valid_to_revision IS NULL;
CREATE INDEX idx_ref_from ON asset_reference (from_asset_id) WHERE valid_to_revision IS NULL;
CREATE INDEX idx_ref_to_valid_to ON asset_reference (to_asset_id, valid_to_revision);
```

Partial indexes (`WHERE valid_to_revision IS NULL`) keep "current state" queries fast regardless of history depth.

### 22.3 Portability: PostgreSQL ↔ H2

| Concern | PostgreSQL | H2 (test) | Handling |
|---|---|---|---|
| JSON column | `jsonb` | `clob` | Liquibase `dbms`-scoped column type; Hibernate `@JdbcTypeCode(SqlTypes.JSON)` |
| Partial index | supported | supported (2.x) | same changeset |
| `varchar_pattern_ops` | supported | n/a | changeset with `dbms="postgresql"`; H2 gets a plain index |
| `UPDATE … RETURNING` | supported | no | two repository impls behind one interface |
| Timestamps | `timestamptz` | `timestamp with time zone` | Liquibase `TIMESTAMP WITH TIME ZONE` |
| Case-insensitive search | `lower()` index | `lower()` | identical |
| JSON queries | avoided in hot paths | n/a | projections used instead |

H2 runs in PostgreSQL compatibility mode:

```
jdbc:h2:mem:sf;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH
```

A nightly CI job runs the **same** test suite against a real PostgreSQL via Testcontainers, so H2 speed does not hide dialect divergence.

### 22.4 Liquibase organization

```
src/main/resources/db/changelog/
├── db.changelog-master.xml
├── v1.0/
│   ├── 001-users-and-projects.xml
│   ├── 002-revisions.xml
│   ├── 003-assets.xml
│   ├── 004-asset-references.xml
│   ├── 005-media-blobs.xml
│   ├── 006-channels-and-generation.xml
│   ├── 007-indexes.xml
│   └── 008-seed-system-data.xml
├── v1.1/
│   └── 101-add-structure-kind.xml
└── data/
    ├── demo-project.xml           (context: demo)
    └── test-fixtures.xml          (context: test)
```

`db.changelog-master.xml`:

```xml
<databaseChangeLog xmlns="http://www.liquibase.org/xml/ns/dbchangelog" …>
  <includeAll path="db/changelog/v1.0/" relativeToChangelogFile="false"/>
  <includeAll path="db/changelog/v1.1/" relativeToChangelogFile="false"/>
  <include file="db/changelog/data/demo-project.xml" context="demo"/>
  <include file="db/changelog/data/test-fixtures.xml" context="test"/>
</databaseChangeLog>
```

Dialect-scoped column example:

```xml
<changeSet id="003-assets-version-payload-pg" author="sf" dbms="postgresql">
  <addColumn tableName="asset_version">
    <column name="payload" type="JSONB" defaultValue="{}">
      <constraints nullable="false"/>
    </column>
  </addColumn>
</changeSet>

<changeSet id="003-assets-version-payload-other" author="sf" dbms="!postgresql">
  <addColumn tableName="asset_version">
    <column name="payload" type="CLOB" defaultValue="{}">
      <constraints nullable="false"/>
    </column>
  </addColumn>
</changeSet>
```

**Rules**

1. Changesets are **immutable** once merged to `main`. Fixes come as new changesets. `validCheckSum` is forbidden in review.
2. Every changeset declares an explicit `id`, `author` and, where automatic rollback is impossible, a `<rollback>` block.
3. `preConditions` guard destructive operations (`onFail="MARK_RAN"` for idempotent adds).
4. No application deploy runs DDL: `spring.jpa.hibernate.ddl-auto=validate`.
5. Contexts: `prod` (default, no data), `demo`, `test`.
6. CI runs `liquibase updateSQL` + `liquibase status` on a schema restored from a production dump, and fails on unexpected drift.
7. Long-running index creation on PostgreSQL uses `CREATE INDEX CONCURRENTLY` in a changeset with `runInTransaction="false"`, guarded by `dbms="postgresql"`.

### 22.5 Hibernate mapping notes

```java
@Entity
@Table(name = "asset_version")
public class AssetVersion {

  @Id @GeneratedValue(strategy = IDENTITY)
  private Long id;

  @ManyToOne(fetch = LAZY, optional = false)
  @JoinColumn(name = "asset_id")
  private Asset asset;

  @Column(name = "valid_from_revision", nullable = false, updatable = false)
  private long validFromRevision;

  @Column(name = "valid_to_revision")
  private Long validToRevision;

  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "payload", nullable = false)
  private JsonNode payload;
  …
}
```

- All associations `LAZY`; `open-in-view: false`; DTO projection queries for list endpoints (no entity graphs over collections).
- Batch inserts for bulk operations (`hibernate.jdbc.batch_size=50`, `order_inserts=true`).
- No `@Version` optimistic lock column — the revision interval *is* the concurrency token (§7.5).
- Second-level cache disabled; caching happens at the domain/render layer where keys carry revisions.

---

## 23. Frontend implementation (Angular)

### 23.1 Stack

| Concern | Choice |
|---|---|
| Framework | Angular 18+, standalone components, **zoneless** change detection |
| State | Signals + a small `signalStore` per feature (NgRx Signals); no global God-store |
| HTTP | `HttpClient` + typed generated client from OpenAPI |
| Forms | Custom dynamic form engine driven by CDL (§23.5), built on typed reactive forms |
| Routing | Standalone routes, lazy `loadComponent`, resolvers for project context |
| Styling | SCSS + CSS custom properties design tokens; no UI kit dependency for core surfaces |
| Components | Angular CDK (overlay, drag-drop, a11y, virtual scroll) — behaviour without visual opinions |
| Rich text | TipTap with a schema derived from the editor's `features` list |
| Code editing | CodeMirror 6 with CDL/OCTL/expression stream languages (tokenizer, completion, diagnostics; M33, §24.5 item 21) |
| i18n | Angular i18n, en + de at launch |
| Testing | Vitest + Testing Library, Playwright for E2E |

### 23.2 Application structure

```
ui/src/app/
├── core/
│   ├── auth/           auth.store.ts, session.service.ts, jwt/refresh/password-required interceptors, guards
│   ├── api/            generated/, api-error.interceptor.ts, etag.interceptor.ts
│   ├── project/        project-context.store.ts, project-access.store.ts, project.resolver.ts
│   └── ui/             toast.service.ts, dialog.service.ts, shortcut.service.ts
├── shared/
│   ├── components/     sf-button, sf-field, sf-table, sf-tree, sf-empty-state, sf-diff
│   ├── directives/     sfAutofocus, sfTooltip, sfDropTarget
│   └── pipes/          sfRelativeTime, sfFileSize
├── features/
│   ├── auth/           login
│   ├── account/        user menu, My account, set new password (forced change)
│   ├── dashboard/      project picker, recent activity
│   ├── pages/          page-list (tree), page-editor (split view), body-editor
│   ├── media/          library grid, uploader, detail drawer
│   ├── templates/      template-list, cdl-editor, octl-editor (channel tabs)
│   ├── structures/     navigation editor + renderer editor
│   ├── channels/       channel CRUD
│   ├── revisions/      timeline, diff viewer, restore
│   ├── generation/     run dialog, live log (SSE), run history
│   ├── release/        status badge, release bar, release/unpublish/discard dialog, dependency plan (M27)
│   ├── changes/        Changes view (M27)
│   ├── schedules/      Schedules page, schedule dialog, execution history, zoned-time and cron utils (M27)
│   ├── settings/       project settings tabs, incl. Members
│   └── admin/          users, projects, audit (lazy-loaded, instance admins only)
└── design/             tokens.scss, typography.scss, themes/
```

### 23.3 Auth handling

- `authStore` holds the access token in a signal — **never** in `localStorage`.
- `jwtInterceptor` attaches `Authorization: Bearer …` — never to login and refresh (§9.2).
- `refreshInterceptor` catches `401`, pauses concurrent requests in a single-flight refresh, retries once, and routes to `/login` on failure while preserving `returnUrl`.
- A silent refresh timer fires at 80% of token lifetime.
- Route guards: `authGuard`, `projectMemberGuard(minRole)`, `instanceAdminGuard` (`/admin`) and `passwordChangeGuard`. Guards read roles from the decoded token, so navigation never waits on a network call.
- **Effective role (M26).** `authStore.roleFor(projectKey)` is what every role-gated control reads: an instance admin acts as `PROJECT_ADMIN` everywhere, and in an archived project everyone acts as `VIEWER`. `projectAccessStore.readOnly` (time travel or archived) gates the editors that aren't role-gated; an archived project shows a banner (with *Unarchive* for instance admins).
- **Publish permissions (M28).** `ProjectPermissionsStore` (`core/project/`) is the one permission helper: signals such as `canEditContent`, `canEditTemplates`, `canManageMembers`, `canManageTargets`, `canRelease`, `canScheduleRelease`, `canIncrementalBuild`, `canFullBuild`, `canCancelRun(run)`, `canPromote`, `canScheduleGeneration`, `canAdminProject`, built from the effective role, `ProjectDetail.permissions` and `projectAccessStore.readOnly` (every write capability is off while read-only). Publish permissions are read from the server, never derived from the role. A `403` carrying `permission` re-reads the project detail and shows "You no longer have permission to …"; the detail is also re-read on every navigation inside the project (a burst of navigations shares one read; one that happens during a read gets another read after it) and when the tab becomes visible again (at most once a minute), so a policy change shows without a reload.
- **Forced password change (M26).** While `/auth/me` reports `mustChangePassword` — or any call answers `428` — every route leads to `/account/set-password`, which offers only the password form and *Sign out*, then continues to the URL the user was heading for. The own password change signs in again with the new password, since the server revokes every session.
- `canDeactivate` guard on editors warns on unsaved changes (with "Save and leave" / "Discard" / "Stay").

### 23.4 Project context

`projectContextStore` holds the active project, its channels, folder tree and template catalogue, loaded once per project entry and refreshed on revision change. It exposes `currentRevision()` so any view can show "you are looking at revision 1842".

### 23.5 Dynamic form engine

The heart of the editor UI: CDL definition → rendered form.

```
ContentDefinition (JSON from API)
        │
        ▼
FormBuilderService.build(definition, value)
        │  builds a typed FormGroup mirroring the editor tree
        ▼
<sf-content-form [definition]="def()" [formGroup]="fg" />
        │  iterates editors, resolves each to a control component
        ▼
EDITOR_REGISTRY: Map<EditorType, Type<EditorComponent>>
   text → SfTextEditor        media → SfMediaEditor
   richtext → SfRichTextEditor list → SfListEditor (CDK drag-drop)
   …                          group → SfGroupEditor (recursive)
```

- Every editor component implements `EditorComponent { definition: EditorDef; control: FormControl; }` and is registered by type — adding an editor type is one component + one registry entry.
- `visibleWhen` expressions are evaluated by a shared `ExpressionEvaluator` whose test fixtures are the *same JSON file* used by the backend evaluator tests, guaranteeing identical semantics.
- `visibleWhen` is the only expression evaluated in the browser. Everything else about rules is decided on the server (M33).
- **Rules (M33).** A `RuleBinding` per form (the page's own fields, a record, a property set) calls `POST …/rules/evaluate` (§19.5) on load and about 400 ms after the last change; answers older than the latest request are dropped by sequence number. It applies the answer:
  - **Fills.** A `mode empty` fill writes a field that is empty or still holds the previous live fill, so a slug follows the title until the user types their own; a `mode always` fill overwrites. Fills are applied without marking the form changed — the next save carries them (and the server's save fills apply anyway).
  - **Field states.** Required, read-only and computed markers on top-level editors; a field read-only by rule has its control disabled, and a rule never re-enables a field the definition makes read-only.
  - **Findings.** Shown at their field, styled by level — error, warning, info, and hint muted (hints only at the field) — filtered to the language being edited, the message in the UI language. Client-side validators remain only for instant format feedback (the definition's `validate … message`, else i18n defaults); server findings are authoritative.
  - **Rejected saves.** A save or autosave refused by the rule gate (`422 SF-API-0422` with `issues`) keeps the local edits, shows the findings and sets the status to "Not saved — fix N errors"; the next change saves again.
  - **Nested forms.** The page's body sections and every catalog card — in a page, a section, a record or a property set — take their fills and field states from the same evaluation by their path prefix (`bodies.main[1].content`, `content.teasers.cards[0].content`), blank their own last live fills before the next request, and pass a filled value up without counting it as an edit.
- **Autosave**: dirty state is debounced 1.5 s and flushed on blur, section switch, and `Ctrl/Cmd+S`. Each flush is one revision with an automatic comment ("Edited *Headline* in *Teaser*"). A `Saved 12:04` indicator with a revision link sits in the editor header.

### 23.6 Page editor layout

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Breadcrumb  /campaigns/Autumn collection      rev 1842 · Saved 12:04      │
│                                            [Preview] [Generate] [History] │
├──────────────┬──────────────────────────────────┬─────────────────────────┤
│ Page tree    │ Page fields (template editors)   │ Preview                 │
│ (virtual     │ ─────────────────────────────────│ ┌─────────────────────┐ │
│  scroll,     │ Body: main            [+ Section]│ │                     │ │
│  drag-move)  │  ▸ Teaser · Autumn parka    ⋮ ⇅ │ │  live render        │ │
│              │  ▾ Text block               ⋮ ⇅ │ │  (iframe, sandboxed)│ │
│              │     ├ Headline […]               │ │                     │ │
│              │     └ Body [rich text]           │ └─────────────────────┘ │
│              │ Body: sidebar                    │ [mobile|tablet|desktop] │
└──────────────┴──────────────────────────────────┴─────────────────────────┘
```

- Sections are collapsible cards; collapsed state persists per user per template.
- Reordering: CDK drag-drop with keyboard alternative (`Alt+↑/↓` on a focused section header) — drag is never the only way.
- The "+ Section" picker is a filtered command palette showing only templates allowed by the body's `allow` list, with thumbnails and category grouping.

### 23.7 Template IDE

- CodeMirror 6 with a custom OCTL language (M33): tokenizer for `$CMS_…$`, bracket matching, folding of block instructions, and completion on Ctrl+Space fed by the template's own CDL (instructions after `$`, the declared and inherited editor names inside an instruction).
- Diagnostics: `POST /octl/validate` on a 500 ms debounce → markers with codes and quick links to the reference documentation.
- Split view (M34): the CDL on the left, one tab per section (`Content | Bodies | Rules`; section templates have no Bodies tab), the channel templates on the right, one tab per channel (`html | md | + Add channel`); the two stack when the pane is too narrow. Every tab shows its error count and an unsaved dot; each keeps its own editor (and undo history) while another shows. Sample-content preview below is not built yet.
- One *Save template* (and `Cmd/Ctrl+S`) writes the metadata, the CDL and every channel in one request — one revision (§14.9). Adding or removing a channel is staged until then (a removed channel can be restored before saving). A rejected save keeps every edit and opens the first failing CDL tab and channel tab. Datasets (Content | Rules beside their record templates) and property sets (Values | Schema, the schema as Content | Rules) work the same way.
- "Where used" panel: pages and templates referencing this template, sourced from `asset_reference`.

### 23.8 Performance practices

- `OnPush` everywhere (implied by zoneless + signals), `trackBy` on every list.
- Virtual scrolling for the page tree, media grid and revision timeline.
- Route-level code splitting; Monaco and TipTap lazy-loaded only in the routes that need them.
- Budget: initial JS ≤ 350 kB gzip; LCP ≤ 1.8 s on a mid-range laptop; interaction ≤ 100 ms.
- Optimistic UI for reorder/rename with rollback on error.
---

## 24. UI/UX specification

### 24.1 Design position

StaticForge is a **workbench**, not a website. Editors spend hours in it; developers read code in it; both need to trust that nothing they do is unrecoverable. The interface is therefore built around one idea:

> **Every change is on the record, and the record is always visible.**

The product's differentiator — project-scoped revision safety — is not buried in a "History" tab. It is the spine of the interface.

### 24.2 Signature element: the revision spine

A 44 px vertical rail is fixed to the left edge of every project workspace.

```
┌──┬──────────────────────────────────────────────┐
│1842│  ← current revision, monospace, top of rail │
│ ┃ │                                              │
│ ●─│  1842  you · Edited "Headline" · 12:04       │  ← hover reveals the label
│ ┃ │                                              │
│ ○ │  1841  Paul · Added section · 11:58          │
│ ┃ │                                              │
│ ○ │  1840  Elena · Uploaded 3 files · 11:31      │
│ ┃ │                                              │
│ ⋮ │  older →                                     │
└──┴──────────────────────────────────────────────┘
```

- Ticks are the last ~40 revisions of the project, densest at the top.
- Your own changes are filled; others' are hollow. A revision by another user arriving while you edit pulses the rail once (no toast, no modal — the interface does not interrupt to say "someone else exists").
- Click a tick → the workspace enters **time-travel mode**: a thin amber frame surrounds the content area, all inputs go read-only, and the header reads `Viewing revision 1840 · Back to now`. This is the single, consistent mechanism for history, diff and restore; there is no second history UI to learn.
- The rail collapses to a 6 px strip on viewports below 1100 px and becomes a header control.
- **Compacted history (M29, §7.7).** The spine and the revision list mark compacted revisions with an icon and the tooltip "Exact changes compacted — end-of-day state kept". When a time-travel read carries `compacted`, the banner adds "Compacted history: you see the state at the end of that day"; the diff shows the per-asset compacted message instead of an empty diff; restoring from a compacted revision says in its confirmation that the end-of-day state will be restored.

Everything else in the interface stays quiet so this one element carries the weight.

### 24.3 Design tokens

```scss
// design/tokens.scss
:root {
  /* Palette — cool graphite base, one saturated action colour,
     one reserved state colour that means exactly one thing. */
  --sf-paper:      #F6F7F8;  // app canvas (light)
  --sf-surface:    #FFFFFF;  // cards, panels
  --sf-ink:        #101418;  // primary text; canvas in dark theme
  --sf-slate:      #5A6472;  // secondary text, icons
  --sf-line:       #DFE3E8;  // hairlines, dividers
  --sf-signal:     #2B44E8;  // primary action, focus, selection — nothing else
  --sf-amber:      #C77A0A;  // unsaved / time-travel / revision drift — nothing else
  --sf-jade:       #0E7A5F;  // published, success
  --sf-rust:       #B3261E;  // destructive, error

  /* Type */
  --sf-font-ui:      "Geist Sans", system-ui, sans-serif;
  --sf-font-display: "Space Grotesk", "Geist Sans", sans-serif;  // login, empty states, project picker
  --sf-font-mono:    "JetBrains Mono", ui-monospace, monospace;  // UIDs, revision ids, all template code

  /* Scale — 1.200 minor third, dense-tool sizing */
  --sf-text-xs:  0.75rem;   --sf-lh-xs:  1.1rem;
  --sf-text-sm:  0.8125rem; --sf-lh-sm:  1.25rem;
  --sf-text-md:  0.875rem;  --sf-lh-md:  1.375rem;  // interface default
  --sf-text-lg:  1.0625rem; --sf-lh-lg:  1.5rem;
  --sf-text-xl:  1.375rem;  --sf-lh-xl:  1.75rem;
  --sf-text-2xl: 1.875rem;  --sf-lh-2xl: 2.25rem;

  /* Space — 4 px base */
  --sf-1: 4px;  --sf-2: 8px;  --sf-3: 12px; --sf-4: 16px;
  --sf-5: 24px; --sf-6: 32px; --sf-7: 48px; --sf-8: 64px;

  /* Radius, elevation, motion */
  --sf-radius-sm: 4px; --sf-radius-md: 6px; --sf-radius-lg: 10px;
  --sf-shadow-1: 0 1px 2px rgb(16 20 24 / 0.06);
  --sf-shadow-2: 0 4px 16px rgb(16 20 24 / 0.10);
  --sf-motion-fast: 120ms; --sf-motion-base: 180ms;
  --sf-ease: cubic-bezier(0.2, 0, 0, 1);
}

[data-theme="dark"] {
  --sf-paper: #0C0F12; --sf-surface: #161A1F; --sf-ink: #E8EBEE;
  --sf-slate: #97A1AE; --sf-line: #262C33; --sf-signal: #6E82FF;
  --sf-amber: #E0A040; --sf-jade: #35A585; --sf-rust: #E5675E;
}

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

**Colour discipline.** `--sf-signal` marks the one thing you can do next; `--sf-amber` means "not yet on the record". If a screen shows amber in more than one place, the screen is wrong. Everything else is graphite, and hierarchy comes from spacing and weight rather than hue.

**Type discipline.** Monospace is not decoration: it marks machine-readable identity (UID, revision, UUID, output paths, template code). Anything shown in mono can be copied and pasted somewhere the machine will accept it.

### 24.4 Layout system

| Region | Behaviour |
|---|---|
| Revision spine | 44 px, fixed left, always visible ≥ 1100 px |
| Nav rail | 64 px icons / 220 px expanded, per-user persisted, project switcher at top |
| Content | fluid, max 1600 px for list views, full-width for split editors |
| Inspector | 320–480 px right drawer, resizable, per-route persisted |
| Command bar | `Cmd/Ctrl+K` overlay, centred, 640 px |

Breakpoints: 1600 / 1280 / 1100 / 840 / 600. Below 840 px the app is **review-oriented**: browse, preview, comment on revisions, approve — full editing on a phone is explicitly not a goal, and the UI says so in an honest empty state rather than degrading badly.

### 24.5 Core screens

1. **Login.** Display face, single card, project-agnostic. No marketing copy.
2. **Project picker.** Cards with name, last revision, last activity, your role. Search-first if > 12 projects.
3. **Pages.** Left: folder tree (virtual scroll, drag-move, keyboard move). Centre: table (display name, UID, template, updated, updated by, status per channel). Multi-select for bulk move/delete.
4. **Page editor.** Split view (§23.6).
5. **Media library.** Grid with focal-point-aware thumbnails; drop anywhere to upload; drawer with metadata, variants, usages and replace-binary.
6. **Templates.** List by category; the IDE (§23.7).
7. **Structures.** Source definition, per-channel renderer, live tree preview with a page selector to test `active`/`trail`.
8. **Channels.** Small table + form. Deleting shows the exact list of templates that will lose a channel body.
9. **Revisions.** Full-page timeline (the spine, expanded) with filters by user, asset and type; side-by-side diff; restore.
10. **Generate.** Dialog (mode, channels, target, scope, comment) → live log with per-stage progress, error/warning grouping by code, and a file-count summary. Errors link straight to the offending template line. **M28:** *New generation* only with `INCREMENTAL_BUILD`; without `FULL_BUILD` the dialog fixes mode *Incremental* and the default target (shown, not selectable). The **Scope** fieldset — *Limit to folder* (a pages folder) and *Only these pages* — sends `folderPath`/`assetUuids`, and the plan preview reflects it. *Cancel* shows on an editor's own runs (developers: every run), *Promote* for developers only; runs show *Started by* and their comment. A user who can't build sees "Builds are started by developers in this project." instead of a dead button.
11. **Admin** (`/admin`, instance admins). *Users*: server-paged list with search and status/role filters; create (generated password shown once, or typed with the policy as live checks; "must change password"; first project memberships); a user page with profile, account state, actions (disable/enable, unlock, reset password, sign out everywhere, grant/revoke instance admin, delete by typing the username) whose guard rails show as disabled buttons with the reason, and memberships. *Projects*: every project with members and last change; archive and unarchive. *Audit*: every entry, filterable by action, user, project (or instance only) and day range, the filters kept in the URL. *Jobs* (M29, `/admin/jobs`, §26.6): every system job with schedule, next and last run and a running indicator; a job page with schedule and settings, *Reset to defaults*, *Run now* / *Dry run* with the finished report, and the run history.
12. **Account.** A user menu in the dashboard header and at the foot of the project rail (initials only when collapsed): *My account*, *Administration* for instance admins, *Sign out*. *My account* holds the profile (username and email ask for the current password), the password with live policy checks, the user's projects, and *Sign out everywhere*.
13. **Members** (project settings tab). Everyone in the project sees the members; project admins add existing accounts through a lookup, change roles and remove members (removing yourself warns and leaves the project). Disabled members show greyed; emails only for project admins.
14. **Release bar and badges (M27).** Every releasable editor (page, record, record set, global set, media drawer, navigation folder and reference, editorial folders) opens with a bar: the status in the editing language, a compact per-language list, the pending schedules ("Release scheduled for Tue 29 Sep, 09:00 by Ana", linking to the schedule) and — not in time travel or archived — *Release…*, *Unpublish…*, *Discard changes…* for users holding `RELEASE` and *Schedule…* for `SCHEDULE_RELEASE` (M28; before M28 `DEVELOPER`+). After a successful release (here or in Changes) a toast offers **Build now** — an incremental run to the default target — to users holding `INCREMENTAL_BUILD`, then *Show progress*; it is a separate, explicit action. Trees, lists and cards show a status badge per row: icon and text (icon only in trees, text for screen readers and in the tooltip, which lists every language), a clock when a schedule touches it. Deleting a published item says it stays online until the deletion is released.
15. **Changes (M27).** Every unreleased (asset, language), server-paged; filters (type, status, language, changed by, folder, text) and sort in the URL, shown as removable chips; the selected row's released → draft diff with *Open in editor*; multi-select on the page with *Release…*, *Discard changes…* (`RELEASE`) and *Schedule release…* (`SCHEDULE_RELEASE`); ↑/↓ move, Space selects, Enter opens the diff. The nav rail shows the count of new, changed and deletion-pending pairs.
16. **Schedules (M27).** Every schedule, next due first, filtered by type, status and owner; times in the viewer's zone (plus the schedule's zone where it differs); drift warning with *Re-pin*; *Edit*, *Run now*, *Take over*, *Cancel*; an execution history drawer with lateness, outcome, per-item results and links to the revision and the generation run. The schedule dialog (from the release bar, Changes and this page) takes the date and time in the viewer's zone, recurring schedules as presets (hourly, daily, weekdays, weekly) or a cron with the next five runs, the pin, then-generate and missed-run options, and the release plan. **M28:** "then generate" is offered with `INCREMENTAL_BUILD`, a target other than the default only with `FULL_BUILD`; generation schedules only for developers; *Edit*, *Run now*, *Re-pin* and *Cancel* follow the server rules (own schedule with its permissions, or a developer).
17. **Publishing by editors (M28).** A card at the top of *Settings → Generation* with four switches — "Release, discard and unpublish content", "Schedule releases and unpublishing", "Start incremental builds to the default target", "Start full builds and builds to any target" — and the line "Developers and project admins can always do all of this. Promote/rollback, targets and generation schedules stay with developers." A dependent switch is disabled ("Needs …") while its prerequisite is off, and switching the prerequisite off switches it off too. Project admins edit it (*Save* only when changed); everyone else sees it read-only with "Only project admins can change this.", as does everyone in time travel and archived projects. Before saving, the impact check runs; when pending schedules would fail, a confirmation lists them (type, time in the viewer's zone, owner, missing permission) with *Save anyway* / *Cancel*.
18. **Quality and redirects (M30).** Settings tabs in the order General · Members · Generation · Quality · Redirects · Revisions · URLs ("Navigation URLs" before M32) · Import / Export.
    - **Quality** (`settings/quality`, every member; editable for developers, read-only otherwise — "Only developers can change the quality rules." — and in time travel or archived projects): the header explains *Warning* and *Error* and notes "HTML channels only: other channels (Markdown, …) are not checked."; the rules follow in three groups (Links, SEO, Accessibility), each with name, code, fix hint ("Fix in content", "Fix in the template", "Content or template") and description, a segmented control *Off · Warning · Error* showing the effective setting from the server with the default marked "(default)", its parameters (numbers within their bounds, with range and default; `required` as a checkbox) and *Reset to default* while it differs from the default. One *Save* for the form, enabled only when something changed and every value is valid, beside *Discard*; server errors show on their rules, and after a save that changed something the hint "The next incremental build runs as a full build because the rules changed." Rules capped at warning (`maxSeverity`: `SF-CHK-0001`, `0103`, `0210`) show *Error* disabled with the note that they never hold a page back; a stored *Error* on such a rule shows as *Warning*, noted "Configured as Error, applied as Warning".
    - **Redirects** (`settings/redirects`, every member; editable for developers): a server-paged table — source path, channel, language, target (page display name and current path, or the URL), kind *Automatic*/*Manual*, state *Active*/*Shadowed*/*Dangling*/*Loop* with an explanation tooltip ("Not built" while the default target has no build), created when and by whom or "from run #n" linking to the run — with filters (channel, language, kind, state, text) in the URL and shown as chips; *Add redirect* (source path as the user knows it, `/old/page.html` or `/old/page/`, normalized and shown before saving; target a page from the page picker or a path/URL), *Edit* (with `If-Match`; a `409` offers to reload) and *Delete* with confirmation.
    - **Targets** (Generation tab): the target form's fieldset *Redirect output* with the checkboxes *HTML redirect pages* (checked for a new target and for one without `redirectFormats`), *Apache .htaccess* ("Apache only: …") and *redirects.json*, each with a one-line hint, saved with the target as `config.redirectFormats`; none checked saves `[]`, no redirect output.
    - **Unpublish and delete.** The unpublish dialog (release bar), the page tree's delete dialog and a Changes-view release that publishes a page's deletion offer, for a page that has published output, **Redirect old URL to…** ("Redirect the old URLs to…" for several) with the page picker, preselected with the nearest online page that indexes an ancestor folder (the page carrying a channel's `indexUid` in the folder, else the page beside the folder named like it). Shown to whoever may unpublish (`RELEASE`) or is a developer. After the unpublish or deletion succeeded it calls `POST /redirects/for-asset`; a toast says the redirect shows as *Shadowed* until a build no longer contains the page, with *Open Redirects*; if the redirect call fails, a warning with the same link — the unpublish is not rolled back.
19. **Issues and findings (M30).**
    - **Page editor → Issues.** A collapsible panel at the foot of the editor column in every scope (below the page fields and their impact panel, or below the bodies), with a count badge (marked when it includes errors) and a status "Checking…", "checked at hh:mm" or "Checks unavailable". Two groups, errors first: *Content* (the page's completeness `issues` — path, severity, message; they also show on their fields, like the record editor) and *Output* (the draft check findings of the `html` channel, §19.4 — rule name, severity, "Fix in content" / "Fix in template" / "Fix in content or template", message; expanding one shows code, field and selector), followed by the skipped rules ("Not fully checked on a draft, a build checks them: …"). It checks 400 ms after each completed autosave, on a language switch and on time travel; a newer request cancels the one in flight, and the page editor takes the fresh completeness from the result. A failed check shows "Checks unavailable — … Editing is not affected." with *Check again*. Clicking an issue expands it and goes where it points: a page field opens the page's fields and focuses it (`editorPath`), a section field opens that section's form and focuses the field, a finding with only `sectionInstanceId` opens the section; the preview outlines the section, or the element by `selector` when the page doesn't mark sections. In the *Published* preview view it notes "The preview shows the published page; these checks cover the draft." Read-only states (time travel, archived, viewer) still list everything.
    - **Generate → runs.** The run list has a *Findings* column, apart from the diagnostics counts: an error chip ("3 errors", only when there are errors) and a warning chip ("41 warnings"), each opening the run's findings of that severity, "No findings" when the checks found nothing and "—" for a run without check results. The run details have the tabs *Summary · Rebuilt pages · Findings*. *Summary* adds the lines *Redirects* ("2 redirects added · 14 redirects active") and *Findings* (opens the tab), and each `SF-GEN-0125` diagnostic gets *Show findings* (from the run's `heldBack`), which opens the findings of that page, channel and language. *Findings*: severity and category chips with counts as toggle filters, a rule filter, channel (with more than one) and language filters and an output path prefix; the chosen filters as removable chips with *Clear filters*; every filter and the page kept in the URL (`fSeverity`, `fCategory`, `fCode`, `fAsset`, `fChannel`, `fLocale`, `fPath`, `fPage`), so a filtered list can be shared; a paged table (output path with a *carried* marker, the page linking to its editor in the finding's language with page number, channel and language, rule name and code, severity, message with the selector as a tooltip) and a notice when findings were truncated. The live log shows the `CHECK` stage's messages ("Checking output", "Checked N outputs: …"); the plan dialog explains the fallback causes `BASE_BUILD_WITHOUT_QUALITY_FACTS` ("the previous build of {target} has no quality check results") and `QUALITY_RULES_CHANGED` ("the quality rules changed since the previous build").
    - **Page properties.** The popover opened from the page title has *Navigation and search*: "Show in navigation" (`nav.visible`) and "Hide from search engines" (`nav.noIndex`, §10.3), with the hint that the page leaves the sitemap and the template adds a robots "noindex" tag.
20. **Navigation root (M31).** *All navigation* selects the Navigation root and opens its folder drawer — also from its context menu's *Folder settings…* — so its *Entry page* (`startNode`) can be set (a bug before M31: the root wasn't selectable). It can't be renamed, moved or deleted.
21. **Editor rules (M33).**
    - **Forms** (page fields, record, property set): findings at their fields with level styling (error, warning, info; hints muted and only at the field), in the language being edited; required, read-only and computed markers from the rules; live fills (§23.5). A save refused by a rule shows "Not saved — fix N errors" and keeps the edits.
    - **Issues panel** (page editor): findings ordered by level, errors first; hints hidden; infos listed but not counted in the badge. Scope chips **Edit · Save · Release · Generation** (all on by default, at least one stays on, remembered per browser) filter the findings: a finding shows when one of its scopes is on; the draft's output (quality) findings count as *Generation*.
    - **Release dialog**: errors block the release; warnings are listed and need the checkbox **Release with warnings** (sends `acceptWarnings`); infos sit in a collapsed *Notes* list; planned fills are listed under "Filled in on release". The schedule dialog lists warnings without a checkbox ("recorded when the release runs").
    - **Generate → runs**: `SF-GEN-0121` and `SF-GEN-0122` show among the run diagnostics like `SF-GEN-0120`, naming rule, page and language; the build insight labels the `RULE_REFERENCE` edge "has editor rules reading".
    - **Code editors** (CodeMirror 6, loaded as its own chunk on first use): CDL (template, dataset, property set), OCTL (channel and record templates, processed text media), a record set's `where` and JSON editor values. Highlighting — in CDL also inside expression strings (`assert`, `when`, `value` in a fill, `visibleWhen`, `requiredWhen`, `readOnlyWhen`); completion on **Ctrl+Space** only (CDL keywords, types, attributes, levels, scopes and modes by position, the declared and inherited editor paths, expression functions with signatures and context names; OCTL instructions after `$`, the template's editors or the dataset's fields inside an instruction; a `where` offers the dataset's fields); diagnostics underlined in place with the message on hover, next to the list below the editor; line numbers, bracket matching and auto-closing, folding (CDL blocks, OCTL block instructions), search (**Ctrl+F**), history. **Tab** indents (a text file's source indents with tab characters); **Esc** then **Tab** moves focus on. The CDL is validated live, 500 ms after the last keystroke; *Validate* still reports with a message.
    - **Formats around OCTL** (M33 follow-up): an OCTL editor highlights the text between the instructions as its format — HTML (with CSS in `<style>` and JavaScript in `<script>`), Markdown, JSON, XML (SVG, RSS, Atom), CSS, JavaScript, YAML — parsing only that text, so `<a href="$CMS_REF(page:home)$">` is an attribute with an OCTL value. The format has a palette of its own (`--sf-code-fmt-*` tokens: cooler blues, teals and olives), so the instructions keep the CDL/OCTL colors and stand out from the markup. The format of a channel or record template is the channel's *Highlight as* when it isn't *Auto*; otherwise, and for a processed text file, the project's code highlighting overrides (General settings; an extension entry wins over a MIME type entry), then the MIME type, then the file extension, else plain text. Completion on **Ctrl+Space** adds the format's own where it helps: HTML tags and attributes, CSS properties and values, JavaScript names, XML closing tags, SVG elements and attributes for SVG (none for JSON, Markdown, YAML); OCTL completion stays inside instructions and after `$`. Each format's grammar loads as its own chunk when first needed.

### 24.6 Interaction rules

- **Keyboard complete.** Every action reachable without a pointer. `Cmd/Ctrl+K` command palette, `g p` pages, `g m` media, `g t` templates, `g r` revisions, `Cmd/Ctrl+S` save, `Cmd/Ctrl+Enter` preview refresh, `Alt+↑/↓` move section, `?` shortcut sheet.
- **Optimistic, reversible.** Reorders and renames apply instantly and roll back on error with an inline explanation. Destructive actions are never optimistic.
- **No blocking spinners on saves.** Saving is ambient (the `Saved 12:04` indicator); only navigation-scale loads show skeletons.
- **Confirmation is proportional.** Delete one page → undo toast (10 s). Delete a folder with 200 descendants → typed confirmation naming the count.
- **Conflicts are a conversation.** On `409`, a drawer shows both versions field by field with per-field "keep mine / take theirs" and who changed what when. No "your changes were lost".
- **Errors carry the fix.** `SF-TPL-0103 Unknown editor "headlne" — did you mean "headline"?` with a click-to-insert.

### 24.7 Accessibility (WCAG 2.2 AA baseline, AAA where feasible)

- Contrast: body text ≥ 7:1 against its surface (AAA), UI components and large text ≥ 4.5:1. The token pairs above are verified in CI with an automated contrast matrix test.
- Visible focus everywhere: 2 px `--sf-signal` ring, 2 px offset, never removed. `:focus-visible` only for pointer users.
- Full keyboard operation including drag-and-drop alternatives (§23.6) and resizable panels (`Arrow` keys on the splitter).
- Semantic structure: landmarks, one `h1` per view, correct heading order, `aria-current="page"` on the active nav item.
- Live regions: save state, generation progress and validation summaries announce politely; errors assertively.
- Motion: all animation ≤ 200 ms and suppressed under `prefers-reduced-motion`.
- Zoom to 200% without loss of function; text-spacing overrides supported.
- Rich text editor exposes toolbar as a proper toolbar widget with `Alt+F10` entry.
- Media requires alt text before a page referencing it can be published (a validation, not a nag).
- Automated axe-core checks in Playwright per screen, plus a manual screen-reader pass (NVDA + VoiceOver) per release.

### 24.8 Interface copy rules

- Name things the way editors name them: **Pages**, **Media**, **Templates**, **Revisions** — not *Entities*, *Blobs*, *Renderers*.
- Buttons say what happens and keep their verb: `Publish` → toast `Published`. Never `Submit`, never `OK`.
- Errors state what happened and the next move, in the interface's voice: `Two pages would be written to /products/hammer.html. Change the UID or the output path of one of them.`
- Empty states invite one action: `No sections yet. Add the first one to start building this page.` with the primary button beside it.
- Sentence case throughout, no exclamation marks, no apologies, no "Oops".
- Technical identifiers appear verbatim in mono, never paraphrased: the UID shown in the UI is exactly the string the template needs.

---

## 25. Testing strategy

### 25.1 Test pyramid

| Level | Scope | Tooling | Target |
|---|---|---|---|
| Unit (backend) | Slugifier, UID probe, CDL parser, OCTL lexer/parser/renderer, expression evaluator, path resolver, diff | JUnit 5, AssertJ, jqwik (property-based) | ~2,000 tests, < 60 s |
| Slice | Repositories, revision intervals, JSON mapping | `@DataJpaTest` + **H2** + Liquibase | < 90 s |
| API | Controllers, security, problem responses, ETag/If-Match | `@SpringBootTest(webEnvironment=RANDOM_PORT)` + H2 + RestAssured | < 4 min |
| Contract | OpenAPI schema vs. generated TS client | openapi-diff in CI | per build |
| Dialect | Full slice+API suite against real PostgreSQL | Testcontainers, nightly | < 15 min |
| Unit (frontend) | Stores, form engine, expression evaluator, interceptors | Vitest + Testing Library | < 90 s |
| E2E | 12 critical journeys | Playwright (Chromium, Firefox, WebKit) | < 12 min |
| A11y | Every route | axe-core in Playwright | per build |
| Performance | Generation of a 5,000-page fixture project | JMH + Gatling | nightly |

### 25.2 H2 configuration for tests

`src/test/resources/application-test.yml`:

```yaml
spring:
  datasource:
    url: jdbc:h2:mem:sf_${random.uuid};MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1
    driver-class-name: org.h2.Driver
    username: sa
    password: ""
  jpa:
    hibernate.ddl-auto: validate
    properties.hibernate.dialect: org.hibernate.dialect.H2Dialect
  liquibase:
    change-log: classpath:db/changelog/db.changelog-master.xml
    contexts: test
sf:
  media:
    store: filesystem
    root: ${java.io.tmpdir}/sf-test-media
  security:
    jwt:
      algorithm: HS256
      secret: test-secret-please-do-not-use-in-production-0123456789
```

Key points:

- **Liquibase runs in tests**, exactly as in production. The schema is never created by Hibernate — this is what makes H2 a meaningful check of the changelogs.
- Each test class gets a fresh in-memory database (`${random.uuid}` in the URL) so tests are order-independent and parallelizable.
- `ddl-auto: validate` means a mapping/changelog mismatch fails the test run immediately.
- The `test` Liquibase context loads reference fixtures (one project, one user per role, a page template, two section templates, three media files).

### 25.3 Test data builders

```java
var project  = fixtures.project("acme_site");
var template = fixtures.sectionTemplate(project)
                       .cdl("""
                            content { editor text headline { required } }
                            """)
                       .channel("html", "<h2>$CMS_VALUE(headline)$</h2>")
                       .build();
var page = fixtures.page(project).template(pageTemplate)
                   .section("main", template, Map.of("headline", "Hello"))
                   .build();
```

Builders allocate revisions through the real services, so fixtures exercise the revision machinery rather than bypassing it.

### 25.4 Golden-file rendering tests

Each OCTL feature has a triple: *template + content + expected output*, stored under `src/test/resources/render/`. The suite walks the directory, renders, and compares normalized output. Adding a language feature means adding a directory — no test code.

```
render/
├── value-basic/{template.octl, content.json, expected.html}
├── value-filters/…
├── if-elseif-else/…
├── for-list-nested/…
├── ref-page-relative/…
├── ref-media-variant/…
├── body-multiple/…
├── nav-recursive/…
└── escaping-xss/…
```

`escaping-xss` contains the injection corpus (`<script>`, `" onload=`, `javascript:`, unicode escapes, nested entities); every value path must escape by default and the test asserts the *absence* of executable output.

### 25.5 Revision invariants (property-based)

For any random sequence of create/update/delete/restore operations on a project:

1. Revision ids are consecutive with no gaps and no duplicates.
2. For every asset and every revision `R`, exactly zero or one version row is valid.
3. Reading at `R` after further changes yields byte-identical payloads to reading at `R` immediately after it was written.
4. Restoring revision `R` then reading current yields the payload of `R`.
5. Concurrent writers on the same project produce a total order with no lost updates (each write either commits with a fresh revision or fails with `409`).

Implemented with jqwik generators + a concurrency harness using 16 virtual threads.

### 25.6 Critical E2E journeys

1. Log in → pick project → open page → change headline → autosave fires → preview updates to match → revision appears in the spine.
2. Create a page from a template, add two sections, reorder, publish, verify output file content.
3. Upload an image, set alt text and focal point, reference it in a section, generate, verify `srcset` and variant files.
4. Create a `markdown` channel, copy the HTML template, adjust, generate both channels, verify two files.
5. Rename an asset's UID → warning lists affected templates → fix template → build succeeds.
6. Two browsers edit the same page → second save shows the conflict drawer → per-field merge → save succeeds.
7. Time-travel to revision N-5, preview, restore one asset, verify a new revision was created and history is intact.
8. Delete a media file used by 3 pages → usage warning → force delete → build reports warnings, not a crash.
9. Add a required editor to a template → existing pages show a validation error at publish, not at save.
10. Non-member user cannot see the project (404) and cannot call its API.
11. Editor role cannot open the template IDE (route hidden, API 403).
12. Full keyboard journey: create and publish a page without touching the mouse.
13. Find and fix (M23): a word only a page's rich text holds → Ctrl+K finds the page → Enter opens it → replace the word
    and save → the old word no longer finds it, the new one does → the search page filters by type and keeps the facet
    counts of the other types. A media file found by its alt text opens its drawer through the `?asset=` deep link.
14. Release and schedule (M27): new pages release with their media (dependency proposed) and go online with the next build → an English edit shows `Changed` in English only, Draft and Published previews differ, a build leaves the site as it was → release from the Changes view → per-language structural release (uid change) → localized media per language → a scheduled pinned release with then-generate publishes the pinned version, not a later edit → recurring generation → deletion pending until released → export/import keeps the statuses → an `EDITOR` sees statuses but no actions.

### 25.7 Quality gates (CI)

- Backend line coverage ≥ 80%, branch ≥ 70%; `render` and `revision` packages ≥ 90%.
- Frontend statements ≥ 75%; form engine and stores ≥ 90%.
- Zero `axe` violations of impact *serious* or *critical*.
- OWASP dependency-check: no `HIGH`/`CRITICAL` without a documented, time-boxed exception.
- Liquibase `status` clean against a restored production dump.
- Bundle budget enforced; build fails on regression > 5%.

---

## 26. Non-functional requirements

### 26.1 Performance

| Operation | p50 | p95 |
|---|---|---|
| Page load (editor, 20 sections) | 300 ms | 800 ms |
| Content save (one revision) | 40 ms | 120 ms |
| Page preview render | 120 ms | 400 ms |
| Asset list (50 rows) | 60 ms | 180 ms |
| Media upload (5 MB, excl. transfer) | 300 ms | 900 ms |
| Full generation | see §18.6 | |

### 26.2 Scalability

- 200 projects, 50,000 assets per project, 500 concurrent editors per instance.
- Backend is stateless apart from the blob store → horizontal scaling behind a load balancer; sticky sessions unnecessary (JWT), SSE endpoints need connection affinity or a shared broker (Redis pub/sub in the multi-node profile).
- Generation start is single-node: a JVM lock serializes starts, a second active run of a project is refused (`409 SF-GEN-0500`), and idempotency keys live in memory. Several application nodes would need a shared claim for runs as well — not in scope.
- **System jobs are multi-node safe (M29).** They share the scheduler's poll and lease (§26.6): a job never runs twice at the same time on any node. Interrupted-run recovery works across nodes through the run heartbeat (§18.5); generation itself stays single-node.
- **The scheduler is multi-node safe (M27).** Every node may poll; the conditional-update lease of §18.7 makes each due action execute once, and a crashed node's action is resumed by another after its lease expired. A scheduled build still goes through the single-node generation start above.
- PostgreSQL: expected 30–80 GB at the top of the range; partitioning of `asset_version` by `project_id` is the documented escape hatch (not needed at v1 scale).
- **Search is the exception to statelessness (M23).** Each project's search index is an embedded Lucene directory on the
  application node's disk (`SF_SEARCH_INDEX_ROOT`), and Lucene allows one writer per directory. v1 runs a single
  application instance; a second instance on the same index volume can't open the indexes and reports search as
  unavailable (`503 SF-SEARCH-0503`) while the rest of the CMS keeps working. Multiple instances would need per-node
  indexes, each catching up from the revision log with its own stamp, or a shared index service — both out of scope.
  The index is derived data: deleting it is always safe, the next start rebuilds it (5,000 pages: see
  `infra/scripts/README-benchmark.md`).

### 26.3 Security

| Area | Control |
|---|---|
| Transport | TLS 1.3 only, HSTS, secure cookies |
| Auth | §9; BCrypt cost 12; password policy and server-enforced forced change (§8.2); lockout (15 failures → 30 min); refresh rotation with reuse detection; immediate revocation by token epoch (§9.2) |
| AuthZ | Per-project role check on every endpoint; publishing operations checked against the project's publish policy, read per request (§8.4, M28); deny-by-default; project existence not leaked |
| Injection | Parameterized JPQL/SQL only; no string-built queries; OCTL cannot reach Java |
| XSS | Channel-default escaping in OCTL; TipTap schema-constrained input; Angular sanitization; strict CSP on preview |
| Upload | Tika type sniffing, allow-list, size cap, SVG sanitization, EXIF strip, non-executable storage path |
| SSRF | No server-side fetch of user-supplied URLs in v1. Unchanged by M30: the quality checks (§18.8) resolve links against the build's own outputs and skip every external URL — there is no link checking over the network, and redirect targets (§18.9) are only validated and written, never fetched |
| Path traversal | Output paths normalized and asserted to stay under the target root; `..` rejected at validation |
| Secrets | Env/secret-manager only; never in the DB or logs |
| Audit | Revisions cover content; a separate `audit_log` covers auth (`AUTH_LOGIN`, `AUTH_LOGIN_FAILED`), accounts (`USER_CREATED`, `USER_UPDATED`, `USER_RENAMED`, `USER_DISABLED`, `USER_ENABLED`, `USER_UNLOCKED`, `USER_PASSWORD_RESET`, `USER_PASSWORD_CHANGED`, `USER_SYSTEM_ROLE_SET`, `USER_SESSIONS_REVOKED`, `USER_DELETED` — instance-level, no project), membership (`MEMBER_ROLE_SET`, `MEMBER_REMOVED`), `PROJECT_ARCHIVED`/`PROJECT_UNARCHIVED`, channel and target changes, schedules (`SCHEDULE_CREATED`, `_UPDATED`, `_CANCELLED`, `_TAKEN_OVER`, `_RUN_NOW`, `_IMPORTED` (M27.8), and per execution `SCHEDULE_EXECUTED`/`_FAILED`/`_SKIPPED`, M27), the publish policy (`PUBLISH_POLICY_SET`, target `project:<key>`, detail `{before, after}`, M28) and generation runs (M28: `GENERATION_STARTED`, target `generation:<runId>`, detail `{runId, targetId, mode, channels, scoped, revision, scheduledActionId?}` — as the schedule's owner for a scheduled start; `GENERATION_CANCELLED` and `GENERATION_PROMOTED`, detail `{runId, targetId}`). Release actions are revisions, not audit entries. System jobs (M29): `JOB_SETTINGS_SET` (a changed schedule or settings, or a reset; target `job:<key>`, detail before/after) and `JOB_RUN` (a manual *Run now*, detail `dryRun`) are instance-level; scheduled runs are recorded only in the job's run history. Revision compaction: `COMPACTION_POLICY_SET` (target `project:<key>`, detail before/after) and `REVISIONS_COMPACTED` (actor: system, detail the counts, `cutoff`, `jobRunId`). Quality and redirects (M30): `QUALITY_RULES_UPDATED` (detail: the changed codes) and manual redirect changes `REDIRECT_CREATED`, `REDIRECT_UPDATED`, `REDIRECT_DELETED` (target `redirect:<channel>/<locale>/<fromPath>`, also for `for-asset`); automatic redirects are not audited. Instance admins read all of it (`/admin/audit`), project admins their project's. **Retention is enforced (M29):** the `audit-purge` job deletes entries older than `retentionDays` (default 365, minimum 30), instance and project entries alike; lowering it is itself audited as `JOB_SETTINGS_SET` |
| Rate limits | Login, preview render, generation start |
| Headers | CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` |

### 26.4 Observability

- Structured JSON logs with `traceId`, `projectKey`, `revision`, `userId`.
- Micrometer metrics: `sf.search.index.lag{project}`, `sf.search.index.duration`, `sf.search.index.failures`, `sf.search.index.events` (M23), `sf.revision.allocate`, `sf.render.duration{template,channel}`, `sf.generation.duration{mode}`, `sf.generation.files`, `sf.media.upload.bytes`, `sf.scheduler.claims`, `sf.scheduler.lag` (how late actions started), `sf.scheduler.executions{type,outcome}` (M27), cache hit ratios, HTTP histograms.
- OpenTelemetry tracing across request → service → render.
- System jobs (M29): `sf.job.duration{job,outcome}` (every run, dry runs included), `sf.job.items{job,kind=examined|affected}` and `sf.job.bytes.freed{job}` (real runs only), and the gauge `sf.job.last.success.age{job}`: seconds since the job's newest successful non-dry run, `NaN` before the first.
- Health: `/actuator/health` with DB, blob store and Liquibase checks (the blob store details carry `lastSweep {outcome, finishedAt, dryRun}`, M29); `/actuator/info` exposes schema version.
- Alerts: generation failure rate, p95 save latency, refresh-token reuse detections, disk headroom on the blob store, and **housekeeping stale** (M29): `sf.job.last.success.age{job}` above twice the job's schedule interval (e.g. more than 2 days for a daily job, more than 10 minutes for `generation-run-recovery`) for an enabled job.

### 26.5 Backup & recovery

- PostgreSQL: nightly base backup + WAL archiving; PITR target RPO 5 min, RTO 1 h.
- Blob store: replicated/versioned bucket or nightly rsync snapshot; blobs are immutable and content-addressed, so incremental backup is cheap.
- Consistency: because blobs are written before commit, a DB restore to an earlier point never references a missing blob — unless the `blob-sweep` job (§11.2) deleted it since. A blob that was unreferenced (or only referenced by versions compaction removed) after the backup was taken can be swept once its grace period has passed, while the older database backup still references it. Keep blob-store snapshots from at least *grace period + backup interval* before the database backup you may restore, or run restore drills with `blob-sweep` disabled, and never let the sweep run against a restored database until the blob store is confirmed complete. The operator procedure is in `infra/docs/backup-recovery-runbook.md`.
- Revision compaction (§7.7) and the other destructive jobs delete data for good: a database backup older than a compaction run is the only way back to the removed versions. The export archive doesn't carry the compaction policy.
- Quarterly restore drill, documented in the runbook.
- Project export/import (`ZIP`: assets JSON + blobs + manifest) as a portability and migration path.
- **Export protocol 7 (M25).** Archives carry record sets; a record's archive parent is its set. Exporting a record pulls in its set and dataset implicitly, and a picked set brings its records. Import creates datasets, then sets, then records. Older archives (protocol ≤ 6) are still read, but a record whose parent is a Content folder or the store root is reported as the conflict `RECORD_OUTSIDE_RECORD_SET` and **not imported** — records are never grouped into sets automatically — while every other asset imports. `RECORD_SET_MISSING`, `RECORD_SET_DATASET_MISMATCH` and `RECORD_SET_DATASET_MISSING` block the import; a set query that doesn't validate against the target schema imports flagged (`RECORD_SET_QUERY_INVALID`, warning).
- **Export protocol 8 (M27).** Each releasable asset carries its release state: per locale key `DRAFT_EQUALS` (the released version is the draft), `PAYLOAD` (the released version's payload, display name, folder, template and — media — MIME type and size, with `uid` when it was released under another uid) or `UNPUBLISHED` (released once, not now); deletion-pending assets are exported with their tombstone draft, and media carries its per-language files. Import offers `releaseMode`: `KEEP` (default) restores the archive's release state — a released version that differs from the draft becomes an extra version opened and closed in the import revision, read only by its pointer — and `DRAFT` imports everything as draft (`NEW`), leaving the target's release state and deletion-pending assets out. A `""` pointer releases the target languages the archive also has; an archive without languages counts as the target's default language; any other missing language is the warning `RELEASE_LOCALE_MISSING`. `KEEP` over an existing asset replaces its release state (the import wins). An import restores state: there is no rule gate (imports run neither save nor release rules). Protocol ≤ 7 archives import as drafts (analysis `INFO` `ARCHIVE_WITHOUT_RELEASE_STATE`).
- **Export protocol 9 (M27.8).** An archive carries the project's **open schedules** (`PENDING` — an executing one is exported as pending — and paused recurring ones; no executions, nothing finished) as `schedules/<uuid>.json`, with no database ids: assets by uuid, a `PINNED` release's pinned version as `DRAFT_EQUALS` (the exported draft) or `PAYLOAD` (its content), generation targets by `uuid` (and name), owner and creator by username. Generation targets carry their `uuid` in `settings.json` (a column since `v1.0/024`, unique per project). A selection export carries schedules with `includeSchedules`: a release or unpublish only when every asset it works on is in the archive, a generation always; the full export carries all. Import (`importSchedules`, default `true`) brings them in after assets, release state and settings, in the same transaction: a `PAYLOAD` pin becomes a version opened and closed in the import revision (shared with an identical released version), a pin on an asset the import reused from the target pins its draft there. A target is resolved by uuid — the settings import keeps an archived target's uuid, and one it skips for a name clash resolves to the target's same-named target. The owner is kept when that user exists and may own the schedule; otherwise the importing user owns it. Warnings (none blocks): `SCHEDULE_OVERDUE` (a one-off whose time has passed — not imported), `SCHEDULE_TARGET_MISSING` (not imported), `SCHEDULE_INVALID` (fails a create's checks, e.g. a missing asset or language, an incomplete pinned version, a deletion imported as draft — not imported, with the `SF-DOM` code), `DUPLICATE_SCHEDULE` (replaces the open schedule with that uuid; an executing or finished one is left alone and the archive's is not imported), `SCHEDULE_OWNER_REPLACED`. The analysis counts the archive's schedules (`scheduleCount`); the import result counts `importedScheduleCount`/`updatedScheduleCount` and lists the commit-time `scheduleWarnings`. Protocol ≤ 8 archives carry no schedules.
- **Export protocol 11 (M32).** An archive carries the URL registry's `GENERATED` rows (`url-registry.json`: target type and uuid, channel, language, variant, page number, URL, `overridden`) — all of them in a full export, the rows of the exported assets in a selective one; `PREVIEW` rows never. The import applies them after the assets by `urlRegistryMode`: `ARCHIVE_WINS` (default — the archive's rows replace computed ones; the target's manual overrides are kept, warning `URL_OVERRIDE_KEPT`), `TARGET_WINS` (the archive only fills gaps) or `REPLACE_ALL`. A row whose URL another output holds is skipped (`URL_TAKEN`), one whose channel, language or asset isn't there (`URL_INVALID`); none blocks. Imported changes are recorded, so the next incremental build moves the outputs. The analysis counts `urlCount`, the result `importedUrlCount` and `urlWarnings`. Protocol ≤ 10 archives carry no URLs.
- **Export protocol 12 (M33 follow-up).** The settings carry the project's code highlighting overrides (`codeHighlighting`), adopted only when the target project has none of its own (entries this server can't read are dropped); a channel's `settings.highlightAs` travels with its settings. Protocol ≤ 11 archives import without overrides, and their channels highlight as `AUTO`.
- **Export protocol 10 (M30).** A full-project archive carries the project's quality rule configuration with the project settings — imported only when the target project has none of its own (settings import never overwrites, like the language settings); unknown rule codes are dropped with the warning `UNKNOWN_QUALITY_RULE` — and the redirect registry (`redirects.json`, §18.9; conflicts `REDIRECT_SOURCE_EXISTS`, `REDIRECT_INVALID`, both non-blocking; the analysis counts `redirectCount`, the result `importedRedirectCount` and `redirectWarnings`). Selective exports carry no redirects. Archives of protocol ≤ 9 import without either.
- The search index (M23) is not backed up: it is rebuilt from the database on start, and a restored database with a
  leftover index is detected (the index records the project it was built for) and rebuilt.

### 26.6 Operations

- Deployment: two containers (backend, static UI behind Nginx) + external PostgreSQL container.
- Startup order: Liquibase migration runs on the backend before the app is `READY`; a failed migration keeps the container unhealthy rather than starting a degraded app.
- Zero-downtime deploys require backward-compatible changesets (expand → migrate → contract over two releases for destructive changes).
- Configuration via environment variables; profiles `dev`, `test`, `demo`, `prod`.
- **System jobs (M29).** Instance-level background work runs as *system jobs* on the scheduler's poll (§18.7) with the same lease: `system_job` holds each job's `enabled`, `cron`, `zone_id`, `settings`, `next_run_at` and lease, `system_job_run` its history (`trigger` `SCHEDULE`/`MANUAL`/`STARTUP`, `dry_run`, `outcome` `SUCCEEDED`/`FAILED`/`PARTIAL`/`SKIPPED`, counts, bytes freed, message, a report with a sample of at most 50 items, `started_by`), capped at `sf.housekeeping.history-per-job` (200) runs per job. The first start seeds each row from `sf.housekeeping.<job-key>.*`; afterwards the persisted row wins, and *Reset to defaults* copies the properties again. A missed slot runs once; manual and startup runs keep the schedule. A failing job is recorded `FAILED` and never stops the poll. `sf.housekeeping.enabled=false` stops scheduled and startup runs on a node (the API still works). A row whose job no longer exists is listed as *orphaned* and never runs.
  - Jobs and defaults (cron in `sf.housekeeping.zone`, default UTC; all enabled): `generation-run-recovery` (startup + `*/5 * * * *`, §18.5), `build-output-cleanup` (`10 3 * * *`, §18.4), `blob-sweep` (`30 3 * * *`, §11.2), `audit-purge` (`0 4 * * *`, §26.3), `refresh-token-cleanup` (`15 * * * *`: whole families past their absolute expiry, or whose every token is revoked or expired for longer than `reuseWindow`, default 7 days; revoked tokens of live families stay, reuse detection needs them), `memory-eviction` (`*/10 * * * *`: idle login-limiter buckets, expired idempotency keys), `generation-run-retention` (`15 4 * * *`, §18.5), `media-variant-backfill` (`0 2 * * *`, §11.4), `search-maintenance` (`0 5 * * *`: per non-archived project, sync, compare the document count with the indexable current versions and rebuild on a mismatch, and merge away deleted documents above `mergeDeletesPct`, 20 %; a project with a rebuild running is skipped, an unavailable index makes the run `PARTIAL`) and `revision-compaction` (`0 3 * * 0`, §7.7, acts only on projects that opted in).
  - Dry run (report only, nothing deleted) for `blob-sweep`, `audit-purge`, `build-output-cleanup`, `generation-run-retention` and `revision-compaction`. There is no "dry run first" gate.
  - The **Jobs** page (Administration → Jobs, `/admin/jobs`, instance admins) lists every job with its schedule in words and zone, next run, last run (outcome, time, duration, affected, bytes freed) and a running indicator, with an enabled switch per row. A job's page edits enabled, cron, zone and the job's settings (validated by the server, `SF-DOM-0180`), resets to defaults, starts *Run now* or *Dry run* and shows the report when the run finishes, and pages the run history (trigger, dry run, started by, report per row).

---

## 27. Delivery roadmap

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 — Skeleton** (2 w) | Gradle multi-module, Spring Boot app, Liquibase baseline, H2 test harness, Angular shell, CI | `docker compose up` yields a running, empty app; pipeline green |
| **M1 — Identity & revisions** (3 w) | Projects, users, JWT auth, asset identity, UID generator, revision counter, version intervals, generic asset API | Property-based revision invariants pass; login → create project → create folder works |
| **M2 — Templates & rendering** (4 w) | CDL compiler, OCTL lexer/parser/renderer, filters, `VALUE`/`REF`/`IF`/`FOR`, section + page templates, HTML channel | Golden-file suite green; a page renders end-to-end via API |
| **M3 — Editing UI** (4 w) | Page tree, dynamic form engine, body/section editing, autosave, media library + upload/variants, preview | Journey 1–3 pass in Playwright |
| **M4 — Generation** (3 w) | Build planner, incremental builds, targets, atomic publish, run history, SSE progress, sitemap/postprocessors | 5,000-page fixture builds within target; rollback works |
| **M5 — Channels & navigation** (3 w) | Channel CRUD, markdown channel, structure assets, navigation renderers, breadcrumbs | Journey 4 passes; two channels generated from one content set |
| **M6 — Revision UX & collaboration** (3 w) | Revision spine, time travel, diff viewer, restore, conflict drawer, usages panel | Journeys 5–8 pass |
| **M7 — Hardening** (3 w) | A11y sweep, performance tuning, security review, docs, export/import, runbooks | Quality gates §25.7 met; pen-test findings closed |

Total ≈ 25 weeks with a team of 2 backend, 2 frontend, 1 designer, 0.5 QA.

**Post-v1 candidates:** editorial approval workflow (release state and scheduled publishing shipped in M27, §5.5, §18.7; editors publishing per project policy in M28, §8.3), multi-language content dimension (shipped in M24), per-asset permissions, template packages shareable across projects, webhooks, headless JSON channel with an incremental delivery API, visual template scaffolding.

---

## Appendix A — Worked example

### A.1 The section template `teaser`

**Content definition**

```
content {
  editor text headline { label "Headline" required maxLength 80 }
  editor richtext body { label "Text" features [bold, italic, link, list] }
  editor media image  { label "Image" mimeTypes ["image/*"] }
  editor link cta     { label "Button target" }
  editor text ctaLabel { label "Button text" visibleWhen "cta != null" }
}
```

**HTML channel template**

```html
<section class="teaser">
  <h2>$CMS_VALUE(headline)$</h2>
  $CMS_IF(image)$<img src="$CMS_REF(image, variant="w800")$" alt="$CMS_VALUE(image.altText | attr)$">$CMS_END_IF$
  <div>$CMS_VALUE(body | raw)$</div>
  $CMS_IF(cta)$<a class="button" href="$CMS_REF(cta)$">$CMS_VALUE(ctaLabel | default("Read more"))$</a>$CMS_END_IF$
</section>
```

**Markdown channel template**

```
## $CMS_VALUE(headline)$

$CMS_IF(image)$![$CMS_VALUE(image.altText)$]($CMS_REF(image)$)

$CMS_END_IF$$CMS_VALUE(body | plain)$
$CMS_IF(cta)$
[$CMS_VALUE(ctaLabel | default("Read more"))$]($CMS_REF(cta)$)
$CMS_END_IF$
```

### A.2 Stored page content (revision 1842)

```json
{
  "templateRef": "018f6a20-0000-7000-8000-000000000001",
  "content": { "title": "Autumn collection", "metaDescription": "Warm things for cold days." },
  "bodies": {
    "main": [
      {
        "instanceId": "0190a1b2-…",
        "templateRef": "018f6a30-…-teaser",
        "content": {
          "headline": "The parka, reworked",
          "body": { "format": "html", "value": "<p>Now with a <strong>recycled</strong> shell.</p>" },
          "image": { "type": "MEDIA_REF", "uuid": "018f6c10-…" },
          "cta": { "kind": "INTERNAL", "uuid": "018f6b40-…" },
          "ctaLabel": "See the parka"
        }
      }
    ]
  },
  "nav": { "visible": true, "position": 10 }
}
```

### A.3 Generated output

`out/current/campaigns/autumn_collection.html` (abridged)

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Autumn collection — Acme</title>
  <meta name="description" content="Warm things for cold days.">
  <link rel="stylesheet" href="../assets/main.css">
</head>
<body class="page page--autumn_collection">
  <header class="site-header">
    <nav class="nav" aria-label="Main">
      <ul class="nav__list nav__list--level-0">
        <li class="nav__item"><a class="nav__link" href="../index.html">Home</a></li>
        <li class="nav__item is-active"><a class="nav__link" href="autumn_collection.html" aria-current="page">Autumn</a></li>
      </ul>
    </nav>
  </header>
  <main id="main">
    <section class="teaser">
      <h2>The parka, reworked</h2>
      <img src="../media/018f6c10_w800.webp" alt="Model wearing the autumn parka">
      <div><p>Now with a <strong>recycled</strong> shell.</p></div>
      <a class="button" href="../products/parka.html">See the parka</a>
    </section>
  </main>
</body>
</html>
```

`out/current/campaigns/autumn_collection.md`

```
## The parka, reworked

![Model wearing the autumn parka](../media/018f6c10.jpg)

Now with a recycled shell.

[See the parka](../products/parka.md)
```

Same content. Two channels. No duplication.

---

## Appendix B — Error catalogue

| Code | HTTP | Meaning |
|---|---|---|
| `SF-API-0400` | 400 | Malformed request body; invalid channel output settings (`fieldErrors` attached, §15.2) |
| `SF-API-0401` | 401 | Missing or expired access token |
| `SF-API-0403` | 403 | Role insufficient for this project action. For publishing operations (M28: release, schedules, generation, targets, publish policy) the problem carries `permission`: the missing publish permission (`RELEASE`, `SCHEDULE_RELEASE`, `INCREMENTAL_BUILD`, `FULL_BUILD`) or `ROLE:<role>` for a role-only rule (§8.4) |
| `SF-API-0404` | 404 | Asset, project or revision not found (or not visible) |
| `SF-API-0409` | 409 | Revision conflict (`If-Match` mismatch); also a stale schedule version (`If-Match: "v{n}"`) or an edit that raced a scheduler claim (M27) |
| `SF-API-0412` | 412 | `If-Match` header missing on a mutating request |
| `SF-API-0413` | 413 | Upload exceeds the configured limit |
| `SF-API-0415` | 415 | MIME type not allowed |
| `SF-API-0422` | 422 | Content fails CDL validation (field-level details attached; structural content findings, and since M33 a save-scope rule `error`, with every finding in `issues`, §10.5) |
| `SF-API-0423` | 423 | Account temporarily locked after repeated failed sign-ins (§8.2) |
| `SF-API-0428` | 428 | Password change required: every call but the forced-change allowlist while `mustChangePassword` is set (§8.2) |
| `SF-API-0429` | 429 | Rate limit exceeded |
| `SF-CHK-0001` | — | Output could not be checked: an output couldn't be parsed or a rule failed on it; a finding capped at `WARNING`, never a failed run (M30, §18.8) |
| `SF-CHK-0101`–`0109` | — | Link findings (M30, §18.8 catalogue): missing page or file, missing media, held-back target (capped at `WARNING`), unreleased and deleted targets, another channel, missing anchor, empty link, link to a redirect source |
| `SF-CHK-0201`–`0212` | — | SEO findings (M30, §18.8): title and meta description (missing, length, duplicates), `h1`, `lang`, `hreflang` alternates (capped at `WARNING`), canonical, `noIndex` without robots meta |
| `SF-CHK-0301`–`0308` | — | Accessibility findings (M30, §18.8): `alt`, link and button names, heading levels, duplicate ids, form labels, `iframe` titles, `<html lang>` |
| `SF-DOM-0101` | 422 | UID already taken (after probe exhaustion) |
| `SF-DOM-0102` | 422 | Reserved UID |
| `SF-DOM-0105` | 422 | A record's UID and display name are derived; a rename or UID change of a record is refused |
| `SF-DOM-0110` | 409 | Folder not empty |
| `SF-DOM-0120` | 409 | Asset still referenced (delete without `force`); for a page template that others extend, the detail and `children` name them |
| `SF-DOM-0122` | 422 | Page template still used by pages can't become abstract (`pageCount`, `pageUids`, `pageUuids`, §13.3) |
| `SF-DOM-0123` | 422 | A page can't use an abstract page template |
| `SF-DOM-0124` | 422 | A page template save would break templates that extend it (`descendants[]`, §13.3) |
| `SF-DOM-0130` | 422 | Page reference folder target has no page in its subtree (a section template outside the body's `allow` list is `SF-API-0422` with an `allow` issue, §10.5) |
| `SF-DOM-0131` | 409 | The last active instance admin can't be disabled, deleted or demoted (§8.2) |
| `SF-DOM-0132` | 409 | An admin can't disable, delete or demote their own account (§8.2) |
| `SF-DOM-0141` | 409 | Project is archived: every write to an archived project is refused (M26); only `unarchive` and read-only requests (dry runs, validations, previews, exports) pass |
| `SF-DOM-0150` | 422 | Content incomplete: a release (or a pinned scheduled release) of content with `release`-scope `error` findings (built-ins and editor rules); `assets[{uuid, locale, issues}]` lists them (M27, M33) |
| `SF-DOM-0151` | 422 | Release item can't be resolved: unknown asset, a language the asset doesn't have, or a live (non-releasable) type (M27) |
| `SF-DOM-0152` | 422 | Discard of an item that was never released — delete a new asset instead; `assets[]` lists them (M27) |
| `SF-DOM-0153` | 422 | Empty release selection (M27) |
| `SF-DOM-0154` | 422 | A pinned version that isn't a version of the asset, or is a deletion (scheduled release) (M27) |
| `SF-DOM-0155` | 404 | Published preview of a page that isn't released in the language (M27) |
| `SF-DOM-0156` | 422 | The release has editor-rule `warning` findings and the request doesn't carry `acceptWarnings: true`; `assets[{uuid, locale, issues}]` (M33, §5.5) |
| `SF-DOM-0160` | 422 | Unknown schedule type; also an execution's failure code (paused) (M27) |
| `SF-DOM-0161` | 422 | Schedule params don't fit the type (`field` names the offender): unknown mode, target, channel or scope, `pinPolicy`/`thenGenerate` on a generation; also an execution failure when a channel was disabled since (M27) |
| `SF-DOM-0162` | — | Execution failure: the generation target is gone; a recurring schedule pauses (M27) |
| `SF-DOM-0163` | — | Execution failure: the owner is no longer permitted (removed, demoted, disabled, deleted, or — M28 — an editor whose permission the publish policy no longer grants; the message names it); a recurring schedule pauses until taken over (M27) |
| `SF-DOM-0164` | 422 | Schedule time lies in the past (M27) |
| `SF-DOM-0165` | 422 | Invalid cron expression or unknown/missing time zone (M27) |
| `SF-DOM-0166` | 422 | Timing doesn't fit the type: a cron on a one-off type, a run time on a recurring one, or neither (M27) |
| `SF-DOM-0167` | 409 | The schedule is executing (or its execution waits for a busy project) and can't be changed now (M27) |
| `SF-DOM-0168` | 422 | Re-pin of anything but a pending pinned release (M27) |
| `SF-DOM-0180` | 422 | Invalid system-job cron, zone or settings, or a dry run of a job without one; `errors` lists every problem (M29) |
| `SF-DOM-0181` | 409 | The system job is already running, on any node (M29) |
| `SF-DOM-0182` | 422 | Enabling revision compaction, or lowering `olderThanDays`, without `confirm` equal to the project key (M29, §7.7) |
| `SF-DOM-0183` | 422 | Compaction `olderThanDays` below 30 (M29, §7.7) |
| `SF-DOM-0184` | 404 | Unknown system job; for edits and runs also a job whose code is gone (orphaned) (M29) |
| `SF-DOM-0190` | 404 | Redirect not found (M30, §18.9) |
| `SF-DOM-0191` | 409 | The channel and language already redirect this source path (M30) |
| `SF-DOM-0192` | 422 | Redirect loop: the target is the source path itself, the redirect closes a cycle of fixed-path redirects, or (`for-asset`) a page is redirected to itself (M30) |
| `SF-DOM-0193` | 422 | Invalid redirect: unknown channel or language, a source or target path with `..`, outside the site, with a scheme other than `http(s)`, backslashes or control characters, a query or fragment on the source, both or neither target given, a target page that doesn't exist or is deleted; `field` names it (M30) |
| `SF-DOM-0194` | 422 | `for-asset`: the asset has no page output in the default target's current build (M30) |
| `SF-DOM-0200` | 409 | URL registry override: another output already has this URL in the channel, area and language; `holderType`, `holderUuid` name it (M32) |
| `SF-DOM-0201` | 422 | URL registry override: not a valid URL for the target (empty, outside the site, a scheme, query or fragment, not a `.{ext}` file or directory for a page, a directory for a media file), or the target has no URL of its own (a page reference, a folder with an index page) (M32) |
| `SF-MEDIA-0505` | 409 | Un-localizing would discard other languages' files; `files[]` lists them; repeat with `confirmDiscard` (M27) |
| `SF-MEDIA-0506` | 422 | Per-language file operation on media that isn't localized (M27) |
| `SF-MEDIA-0507` | 422 | A language the project doesn't declare (M27) |
| `SF-MEDIA-0508` | 422 | Localizing media in a project without languages (M27) |
| `SF-MEDIA-0509` | 422 | Removing the default language's file, which every other language falls back to (M27) |
| `SF-TPL-01xx` | 422 | CDL/OCTL compile errors (§16.11) |
| `SF-TPL-0111` | — | Cross-asset value without an editor path (compile warning) |
| `SF-TPL-0112` | — | Cross-asset value target missing or soft-deleted (render warning) |
| `SF-CDL-0113`–`0119` | 422 | CDL `rules {}` and built-in modifier errors (M33, §14.7): invalid entry or wrong whole-definition keyword (`0113`), missing `level`/`scope`/`assert`/`message` (`0114`), unknown target or identifier path (`0115`, a warning in a page template's live check without its chain), expression error (`0116`), duplicate rule name, fill path or fill cycle (`0117`), `off` of an unknown inherited rule (`0118`), invalid built-in modifier (`0119`) |
| `SF-TPL-0150`–`0162`, `SF-CDL-0109` | 422 | Template inheritance compile errors (§16.11); `SF-TPL-0157` is a warning |
| `SF-TPL-0130`–`0133`, `SF-TPL-0135` | 422 (preview) | Render limit exceeded: depth, loop iterations, output size, time budget, include cycle (§16.10); fails only that page in generation (run `PARTIAL`) |
| `SF-GEN-0110` | — | Output path collision (build error) |
| `SF-GEN-0120` | — | Content incomplete: a built-in or an editor rule `error` with `onGeneration holdBack`; the page language is held back, run `PARTIAL` (§10.5, §18.2) |
| `SF-GEN-0121` | — | An editor rule with `onGeneration fail` doesn't hold: one per page, language and rule; every page is validated first, then the run ends `FAILED` and nothing is rendered or published (M33, §18.2) |
| `SF-GEN-0122` | — | An editor rule's `warning` or `info` in the `generation` scope (run diagnostic of that severity, naming rule, page and language); a warning counts in `warning_count` and makes the run `PARTIAL`, an info doesn't (M33) |
| `SF-GEN-0125` | — | Quality check failed: a rule configured `ERROR` found something on the page; page held back (all its outputs in that channel and language), run `PARTIAL`; the message lists the codes (M30, §18.8) |
| `SF-GEN-0210` | — | No channel template for an enabled channel (warning) |
| `SF-GEN-0220` | — | Reference to a deleted asset: `$CMS_REF`, `$CMS_INCLUDE` or a body section target is soft-deleted; renders empty (warning, §16.4). Cross-asset values use `SF-TPL-0112` |
| `SF-GEN-0221` | — | Reference to an unreleased asset: a link (`$CMS_REF`, `media`/`link` value) to an asset not released in the render language renders empty (warning, §16.4, M27); a cross-asset value of it is `SF-TPL-0112` |
| `SF-GEN-0301` | — | `raw` filter on a plain-text editor (warning) |
| `SF-GEN-0410` | — | Navigation cycle truncated (warning) |
| `SF-GEN-0500` | 409 | A generation run is already active for this project |
| `SF-GEN-0501` | — | Unexpected failure of a run (run diagnostic, run `FAILED`) |
| `SF-GEN-0502` | 422 | Generation target not found, or no target configured |
| `SF-GEN-0503` | 500 | A stored run's channels can't be decoded |
| `SF-GEN-0504` | — | Run interrupted (node restart or lost heartbeat): recovery failed a run nothing executes any more (run diagnostic, §18.5, M29) |
| `SF-GEN-0505` | 409 | Promote of a run that isn't `SUCCESS`/`PARTIAL`, has no target, or whose build is no longer on disk; `current` is unchanged (M29, §18.4) |
| `SF-SEARCH-0400` | 400 | Invalid search parameters: `q` missing, blank or over 200 characters, unknown `type`, `size` outside 1–100, `sort` other than `relevance`, page beyond 10,000 hits (M23) |
| `SF-SEARCH-0409` | 409 | A search index rebuild is already running for this project (M23) |
| `SF-SEARCH-0503` | 503 | The project's search index can't be opened by this instance, e.g. another instance holds its write lock (M23) |

---

## Appendix C — Open questions

| # | Question | Owner | Needed by | Status | Decision (v1) |
|---|---|---|---|---|---|
| Q1 | Should section instances be reusable across pages (shared sections) or always page-owned? Affects the content model and the reference table. | Product | M2 | **Resolved** | Page-owned. Section instances live inside a page's `bodies` (`SectionInstance` model, `BodyService`/`AddSectionRequest`); the `asset_reference` `OCTL_INCLUDE` edge covers *template* reuse, not instance sharing. |
| Q2 | Multi-language: separate projects, folder convention, or a first-class content dimension in v2? | Product | v2 planning | **Deferred to v2** | Explicit v2 (spec §2.2: no multi-language dimension in v1). |
| Q3 | Do we need a JSON/headless channel at v1 for a client-side search index, or is a post-processor sufficient? | Tech lead | M5 | **Resolved** | Post-processor sufficient. `SearchIndexPostProcessor` emits the search-index JSON from generation; the `structure` `list` kind covers listings. No first-class JSON channel in v1. |
| Q4 | Retention policy for revisions on large projects — is unlimited history acceptable at 50,000 assets? | Ops | M7 | **Resolved (M29)** | Unlimited by default; a project opts in to revision compaction (§7.7), which collapses history older than N ≥ 30 days to the last version of each UTC day and keeps released, retained-build and pinned versions. |
| Q5 | Should `PROJECT_ADMIN` be able to add members who are not yet instance users (invite flow with email)? | Product | M6 | **Resolved** | No invite flow in v1. Membership is restricted to existing instance users: `PUT/DELETE /projects/{key}/members/{userId}` operate by `userId`, not email. |
| Q6 | Preferred publish target for the pilot customer: filesystem+Nginx, or S3+CDN? Affects M4 priorities. | Ops | M4 | **Resolved** | Filesystem + Nginx first. `FilesystemBlobStore` is the default backend, `FilesystemTargetWriter` the default target, and `infra/nginx/default.conf` + `infra/docker/docker-compose.yml` deliver the site. S3 (`S3BlobStore`, `S3TargetWriter`) ships as an optional backend for later. |
| Q7 | Does any pilot template need loops over *pages* (a listing section) beyond what `structure` provides? If yes, `$CMS_FOR(page : query(...))$` needs a scoped query grammar. | Tech lead | M5 | **Resolved in M19** | For pages, no: the `structure` asset's `list`/`navigation`/`breadcrumb` kinds (§17.3) cover v1 listing needs. Lists of structured entries that are not pages are **datasets** (M19): `$CMS_FOR(x : dataset:uid, where=…, sort=…, limit=…, offset=…, folder=…)$` with the scoped query grammar (the OCTL expression grammar plus sort/paging/folder arguments), shared by templates and the REST record listing. A page-query loop remains a post-v1 candidate. Listing slices over many output files are **pagination** (M21): a `pagination` editor picks a Navigation folder or a dataset, and `CMS_PAGINATION` exposes the current page; the scoped query grammar stays M19's. |

### Resolutions (notes)

- **Q1** — Section instances are always page-owned; a `section` has its own `instanceId` (a UUID stable across edits) inside a page `body`. Reasons: shared/mutable sections would break the "one mutation → one revision → one parent asset" model and complicate the `asset_reference` materialization (a shared section's change would fan out to every referencing page). Template *reuse* (the desired behaviour) is already provided by `$CMS_INCLUDE` and the section-template registry.
- **Q5** — Membership is `(project, user)` only; there is no email-invite/guest-user concept. A member must already be an `app_user`. Instance admin creates users (or an invite-with-account-creation flow) out of band; the members API then binds them by `userId`. This matches the implemented `ProjectMemberRepository`/`ProjectController` members endpoints.
- **Q6** — Filesystem + Nginx is the v1 pilot target (matches the committed `infra/` stack). S3 is implemented but de-prioritized: it is not the default and has no dedicated ops runbook at v1. M4 priorities were set accordingly (filesystem atomic staged publish + `current` symlink first).
- **Q3/Q4/Q7** — Decisions recorded above are consistent with what the code implements; Q2 remains explicitly v2. No v1-affecting question is left open.
- **Post-v1 "scheduled publishing" (§27)** — delivered in M27 together with a release state: drafts vs released versions per language (§5.5), release/unpublish/discard with dependency proposals and a completeness gate (§10.4), and a multi-node-safe scheduler for releases, unpublishing and one-off or recurring builds (§18.7). An approval (four-eyes) workflow remains out of scope (§2.2). Opening release, scheduling and builds to editors by a per-project publish policy was delivered in M28 (§8.3, §8.4, §18.1).
