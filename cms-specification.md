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

### 2.2 Non-goals (v1)

- No per-asset ACLs — permissions are per project only.
- No editorial workflow engine (draft → review → approve). Revisions exist; approval gates do not.
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
| **Asset** | Anything managed by the CMS with an identity: page, media, section template, page template, structure, folder. |
| **Asset type** | Discriminator: `PAGE`, `MEDIA`, `SECTION_TEMPLATE`, `PAGE_TEMPLATE`, `STRUCTURE`, `FOLDER`. |
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
| Editor component | Monaco Editor | CDL/OCTL syntax highlighting, diagnostics |
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
| `TEMPLATE` | page → page template; page → section template of a body section | `templateRef`, `bodies.<name>[i].templateRef` |
| `MEDIA_REF` | page → media (`media` editor values, media links) | editor path, e.g. `content.heroImage`, `bodies.main[0].content.image` |
| `CONTENT_REF` | page → asset of a `reference` value or internal link; page → section template of a catalog card | editor path; `….templateRef` for a card |
| `OCTL_VALUE` | template → asset read by `$CMS_VALUE`, or by an asset accessor in `$CMS_IF`/`$CMS_SET`/`$CMS_FOR` (not `nav:`) | `channelTemplates.<channel>` |
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
7. **Reserved words** — if the result is in the reserved set (`new`, `edit`, `index`, `api`, `preview`, `_generated`), append `_1`.
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
  change_type     varchar   CREATE | UPDATE | DELETE | RESTORE | MOVE | RENAME | UID_CHANGE | BULK | IMPORT | PUBLISH
  comment         varchar(500) nullable
  summary         json      denormalized list of touched assets
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

Deletion is a version row with `deleted = true` — nothing is physically removed, so restore is a normal write.

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

### 7.7 Retention

Full history is retained by default. An optional per-project **compaction policy** may collapse versions older than *N* days that are not referenced by any published generation run, keeping the first version of each day. Compaction is off in v1 and specified here only to reserve the design space; the `revision.compacted` flag exists from day one.

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
```

Projects are hard isolation boundaries. Every asset query is filtered by `project_id` at the repository level via a mandatory parameter — there is no repository method that can read across projects except instance-admin reports.

### 8.2 Users

```
app_user
  id            bigserial PK
  username      varchar(100) UNIQUE
  email         varchar(255) UNIQUE
  display_name  varchar(200)
  password_hash varchar(255)          -- BCrypt cost 12 (Argon2id configurable)
  status        ACTIVE | DISABLED | LOCKED
  system_role   USER | INSTANCE_ADMIN
  failed_logins, locked_until, last_login_at, created_at
```

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
| `EDITOR` | ✅ | ✅ | — | preview only | — |
| `DEVELOPER` | ✅ | ✅ | ✅ | ✅ | — |
| `PROJECT_ADMIN` | ✅ | ✅ | ✅ | ✅ | ✅ |

`INSTANCE_ADMIN` (system role) may create/archive projects, manage users, and holds implicit `PROJECT_ADMIN` everywhere. Instance admin actions on project content are recorded with an `onBehalf` marker in the revision summary.

**No per-asset rights in v1.** Authorization is `(user, project) → role`, evaluated once per request and cached in the security context.

### 8.4 Authorization implementation

```java
@PreAuthorize("@projectAuth.has(#projectKey, 'DEVELOPER')")
@PutMapping("/projects/{projectKey}/section-templates/{uuid}")
public TemplateDto update(...) { … }
```

`ProjectAuthorizationService.has(projectKey, minimumRole)` resolves the membership (cached per request in a `ThreadLocal`/request scope), compares against the role ordinal, and throws `ProjectAccessDeniedException` → `403` with a problem document. A missing membership yields `404` rather than `403` when the user has no read access at all, so project existence is not leaked.

---

## 9. Authentication with JWT

### 9.1 Token model

| Token | Lifetime | Storage (browser) | Contents |
|---|---|---|---|
| Access token | 15 min | in-memory only (Angular signal) | `sub`, `uid`, `name`, `sysRole`, `projects: {key: role}`, `jti`, `iat`, `exp` |
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
  "jti": "018f6a3d-…",
  "iat": 1755561600,
  "exp": 1755562500
}
```

Embedding project roles keeps authorization at O(1) without a DB hit. Membership changes therefore take effect at most one access-token lifetime later; a membership change bumps the user's `tokenEpoch`, and the filter rejects tokens whose `iat` predates it — so revocation is immediate for removals.

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
| `GET` | `/api/v1/auth/me` | current principal, memberships, capabilities |
| `POST` | `/api/v1/auth/password` | change own password |

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

- Each project has exactly one implicit root folder (`uid = root`, `path = /`).
- A folder's `path` is materialized (`/products/tools/`) and denormalized onto every descendant version row for fast subtree queries and prefix indexing.
- Moving a folder rewrites the `path` of the subtree in a single revision; the number of touched assets is reported to the user before confirmation when it exceeds 100.
- Depth limit 12, 1,000 children per folder (soft warnings in UI at 80%).

**Folder path ≠ output path.** The output path is derived by the page's `outputPath` rule (§18.3): default `{folderPath}{uid}.{channelExtension}`, overridable per page (`payload.output.pathOverride`) and per channel.

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

### 10.4 Page lifecycle

| Action | Effect |
|---|---|
| Create | Choose page template + display name + folder → UID derived → revision |
| Edit content | Field-level save (debounced batch, one revision per save action) |
| Reorder sections | Body array reorder → revision |
| Move | Change folder → revision, path rewrite |
| Delete | `deleted = true` version; usage check warns about inbound references |
| Restore | New version from a chosen revision |

### 10.5 Validation rules

- `templateRef` must resolve to an existing, non-deleted `PAGE_TEMPLATE` in the same project.
- Required editors must be non-empty **for publish**, not for save. Save always succeeds if structurally valid; publish holds back pages with `ERROR`-severity completeness findings and lists them.
- Section instance `templateRef` must be an allowed section template for that body (`allow` list in CDL, §14.6).

Content findings (`ContentIssue`: `path`, `code`, `severity`, `message`, `kind`) are produced by `ContentValidator` and `PageContentValidator` against the compiled CDL of the page template and of each section and catalog card template. `visibleWhen`-hidden editors are skipped. Paths are full, e.g. `content.title`, `bodies.main[2].content.cards.cards[0].content.headline`. Every finding has one of two kinds:

| Kind | Codes | On save | On publish |
|---|---|---|---|
| **Structural** — the value has the wrong shape | `type` (wrong JSON type; malformed `media`/`reference`/`link`/`richtext`/catalog value; a list item that is not an object), `option` (value outside `options`), `allow` (section or catalog card template not allowed there), `template` (catalog card template not found) | rejected: `422` `SF-API-0422` with the structural findings in an `issues` array | does not block |
| **Completeness** — well-formed but unfinished | `required`, `min`, `max`, `maxLength`, `maxChars`, `pattern`, `mimeType`, `visibleWhen` | accepted | `ERROR` findings hold the page back with `SF-GEN-0120` |

- **Save scope.** `PUT` of a page validates the whole page. `PATCH …/content` validates `content` if patched and every section of each patched body. Adding a section and moving a section (within a page or to another page) validate only that section, including the target body's `allow` list. Reordering and deleting sections change no content and are not validated. Legacy findings outside the validated subtree therefore never block an unrelated save.
- **Untouched editors.** The form engine's placeholder values (`{"type":"MEDIA_REF","uuid":null}`, an `INTERNAL` link without `uuid`, `{"format":"html","value":""}`, `{"type":"CATALOG","cards":[]}`) count as empty: they save, and `required` fires for them at publish.
- **Advisory `issues`.** Every page response (`GET`, create and each mutation) carries `issues`: all findings on the whole page, structural and completeness, each with its `kind`.
- **Publish.** During generation every planned page is checked for completeness, with definitions compiled once per build (§21.5). A page with `ERROR` findings is not rendered and gets one `SF-GEN-0120` "Content incomplete" diagnostic listing `path (message)`; the other pages are written and the run ends `PARTIAL`. Structural findings do not block publish.
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
  ref_count     bigint
  created_at
```

`asset_version.payload.blobSha256` links a media version to its bytes. A blob is deletable only when `ref_count = 0` **and** no retained revision references it; a nightly job performs the sweep.

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
  ]
}
```

### 11.4 Upload flow

1. `POST /projects/{p}/media` — `multipart/form-data`, or `POST …/media/bulk` for multi-file drops.
2. Server streams to a temp file, computes SHA-256, sniffs the MIME type with Apache Tika (**never trusting the client-supplied type**), enforces the allow-list and size limit.
3. Metadata extraction: image dimensions and EXIF orientation (metadata-extractor); EXIF GPS is stripped by default (`sf.media.strip-exif=true`).
4. Variants generated asynchronously per the project's **variant policy** (declarative, per project):

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

### 11.5 Constraints & safety

- Default max upload 100 MB (configurable), default max image dimension 12,000 px.
- Allow-list by MIME family; SVG uploads are sanitized (script/foreignObject/event attributes stripped) or rejected per project setting.
- Uploaded files are served from a **separate origin/path** with `Content-Disposition: attachment` for non-renderable types and a strict `Content-Security-Policy` for previews.
- Media referenced by any non-deleted asset cannot be hard-deleted without confirmation; the UI shows the usage list first.

---

## 12. Asset type: Section template

A section template is the **smallest reusable content block**. It consists of:

1. a **content definition** (CDL) — which editors exist, and
2. one **output channel template** (OCTL) per channel — how the block is rendered.

### 12.1 Payload

```json
{
  "contentDefinition": "…CDL source…",
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

### 13.2 Payload

```json
{
  "contentDefinition": "…CDL…",
  "channelTemplates": {
    "html":     { "source": "…OCTL…" },
    "markdown": { "source": "…OCTL…" }
  },
  "bodies": [
    { "name": "main",    "label": "Main content", "allow": ["*"],                 "min": 0, "max": null },
    { "name": "sidebar", "label": "Sidebar",      "allow": ["teaser","cta_box"],  "min": 0, "max": 4 }
  ],
  "outputPath": { "html": "{folder}{uid}.html", "markdown": "{folder}{uid}.md" },
  "category": "Standard"
}
```

`bodies` is authored explicitly (not only inferred from OCTL) so that allow-lists and cardinality can be declared; the compiler cross-checks it against the `$CMS_BODY` occurrences in every channel template and reports mismatches.

---

## 14. Content definition language (CDL)

### 14.1 Purpose and shape

CDL declares *what an editor can fill in*. It is a small, readable, brace-based DSL. The authoring form is text (Monaco-edited, diffable, copy-pasteable); the persisted form additionally carries a normalized JSON AST for fast server-side validation.

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

- **Validation.** Channel create and update reject malformed values with `400` `SF-API-0400` and a `fieldErrors` array of `{field, message}` (fields `fileExtension`, `settings`, `settings.urlStrategy`, `settings.indexFileName`, `settings.indexUid`, `settings.trailingSlash`): `fileExtension` must match `[a-z0-9]{1,10}`, `urlStrategy` must be `RELATIVE` or `PRETTY`, `indexFileName` must match `[A-Za-z0-9._-]{1,64}`, `indexUid` must be a string and `trailingSlash` a boolean. Blank values fall back to the defaults. Unknown keys are kept. An update without `settings` keeps the stored settings. Channels arriving through project import are parsed leniently: unusable values fall back to defaults.
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
| `$CMS_VALUE(assetType:uid)$` | The whole value object of another asset; stringifies to nothing useful and warns (`SF-TPL-0111`) |
| `$CMS_REF(assetType:uid)$` | Resolved URL/href to another asset in the current channel |
| `$CMS_REF(editorName)$` | Resolved URL for a `link`/`media`/`reference` editor value |
| `$CMS_BODY(name)$` | Renders a page body (page templates only) |
| `$CMS_INCLUDE(section_template:uid)$` | Renders another template inline |
| `$CMS_NAV(structure:uid)$` | Renders a navigation |
| `$CMS_IF(expr)$ … $CMS_ELSEIF(expr)$ … $CMS_ELSE$ … $CMS_END_IF$` | Conditional |
| `$CMS_FOR(item : listEditor)$ … $CMS_END_FOR$` | Iteration over `list` editors and nav nodes |
| `$CMS_SET(name = expr)$` | Local variable in the current scope |
| `$CMS_META(key)$` | Page/system metadata (`uid`, `uuid`, `displayName`, `path`, `revision`, `channel`, `now`, `projectKey`) |
| `$CMS_COMMENT$ … $CMS_END_COMMENT$` | Not emitted |
| `$$` | Literal `$` |

### 16.3 Filters

Piped, left to right, inside the parentheses:

```
$CMS_VALUE(headline | upper | truncate(40) | html)$
```

Built-in filters: `html`, `attr`, `js`, `url`, `raw`, `upper`, `lower`, `capitalize`, `trim`, `truncate(n[,suffix])`, `default("…")`, `date("pattern")`, `number("pattern")`, `stripTags`, `nl2br`, `md` (markdown → HTML), `plain` (HTML → text), `json`, `slug`, `join(", ")`, `size`.

The channel's `default_escaping` is applied automatically as the final step unless the chain already contains an escaping filter or `raw`. `raw` on a richtext editor is the normal case and does not warn; `raw` on a `text` editor produces build warning `SF-GEN-0301`.

### 16.4 Reference syntax `assetType:uid`

`assetType` is one of `page`, `media`, `section_template`, `page_template`, `folder`, `page_reference` (the lowercase asset type), or `nav` (a navigation folder, resolved through its navigation reference UID). `uid` is the asset's UID within the current project. `AssetReferencePrefixes` is the single registry of these prefixes for template save, preview and generation.

At **compile time** the reference is resolved to a UUID; the compiled template stores the UUID. On **template save** every resolved reference of every channel source is recorded in `asset_reference` as an `OCTL_VALUE`, `OCTL_REF` or `OCTL_INCLUDE` edge (§5.4). Consequences:

- Renaming an asset's UID does not break already-compiled templates, but the *source* still shows the old UID — the UID-change API therefore reports affected templates (§6.4).
- An unresolvable UID is a **compile error** (`SF-TPL-0110`), not a silent empty string, so broken references cannot reach production.
- A generation run without an explicit revision is pinned to the project's head revision, so its snapshot is identical to a pinned run's and includes soft-deleted versions. A cross-asset value whose target is soft-deleted renders empty with warning `SF-TPL-0112` (preview and generation alike); `$CMS_REF`, `$CMS_INCLUDE` and body sections pointing at a deleted asset render empty with warning `SF-GEN-0220` in generation.

**Cross-asset values.** `$CMS_VALUE(assetType:uid.path)$`, and an asset accessor in `$CMS_IF`, `$CMS_SET` or a `$CMS_FOR` source (other than `nav:`), read the target's **root value object** and walk `path` over it exactly like a local value: dotted paths, truthiness, loop variables and filters behave identically, and escaping follows the channel default unless `raw` is used. Generation reads the revision-pinned snapshot (`SnapshotAssetValueResolver`); preview reads the version valid at the preview revision, live or time travel (`LiveAssetValueResolver`). Both project through the same function (`AssetValueProjection`), so they cannot disagree:

| Target type | Root value object |
|---|---|
| `page` | The page's editor values (`payload.content`); `bodies`, `nav`, `output` and `meta` are not exposed |
| `media` | `altText`, `caption`, `copyright`, `fileName`, `mimeType`, `sizeBytes`, `focalPoint`, and from the image metadata `width`, `height`, `orientation`, `dominantColor`; blob hashes and variants are not exposed |
| `page_reference` | `label` |
| `section_template`, `page_template`, `folder` | No values |

Every root value object also carries the reserved `_meta` object with `uid` and `displayName` (`$CMS_VALUE(page:about._meta.displayName)$`). A value object is raw stored JSON, never rendered output, so reading one cannot trigger a render; a `catalog` value read this way renders its cards through the current page's block resolver, bounded by the include cycle guard (§16.10). Lookups are scoped to the rendering project, and a target whose type does not match the prefix is treated as missing.

- A missing or soft-deleted target renders empty and emits `SF-TPL-0112` once per reference per render. Preview discards render warnings; in generation the warning is reported in the run's diagnostics and the run ends `PARTIAL`.
- `$CMS_VALUE(assetType:uid)$` without a path is compile warning `SF-TPL-0111`. `$CMS_REF(assetType:uid)$` and conditions such as `$CMS_IF(page:about)$` are path-less by nature and do not warn.
- The page that reads another asset's value has no edge of its own; its template holds the `OCTL_VALUE` edge, and an incremental build reaches the page from the changed target through that template's edges (`OCTL_VALUE`, then `OCTL_INCLUDE`/`TEMPLATE`).

`$CMS_REF` resolves to:

| Target | Result |
|---|---|
| `page` | Output path of that page in the current channel, according to the channel URL strategy |
| `media` | Public path of the media file (optionally `?variant=w800`) |
| `folder` | Path of the folder's index page if one exists, else compile error |

`$CMS_REF(media:logo_svg, variant="w400")$` selects a variant.

### 16.5 Scopes

| Scope | Available identifiers |
|---|---|
| Section channel template | its own editors, `$CMS_META`, `$CMS_PAGE.*` (read-only access to the enclosing page's editors), loop variables |
| Page channel template | its own editors, bodies, `$CMS_META`, loop variables |
| Navigation renderer | nav node fields (`label`, `href`, `active`, `level`, `children`, `page`) |
| List loop | `item.<itemEditorName>`, `item._index`, `item._first`, `item._last`, `item._count` |

`$CMS_PAGE.headline$` inside a section reads the enclosing page's `headline` editor — a controlled, read-only upward reference; sections never write.

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
instruction   = "$CMS_" , ( value | ref | body | include | nav | control | meta | set | comment ) , "$" ;

value         = "VALUE(" , accessor , { "|" , filter } , [ "," , namedArgs ] , ")" ;
ref           = "REF("   , accessor , [ "," , namedArgs ] , ")" ;
body          = "BODY("  , identifier , ")" ;
include       = "INCLUDE(" , assetRef , [ "," , namedArgs ] , ")" ;
nav           = "NAV("   , assetRef , [ "," , namedArgs ] , ")" ;

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
cmpExpr       = unary , [ ( "==" | "!=" | "<" | ">" | "<=" | ">=" | "in" ) , unary ] ;
unary         = [ "!" ] , ( literal | accessorWithFilters | "(" , expr , ")" ) ;
filter        = identifier , [ "(" , argList , ")" ] ;
```

Truthiness: `null`/absent → false; empty string/list/object → false; `0` → false; everything else true.

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

### 16.11 Diagnostics

| Code | Severity | Meaning |
|---|---|---|
| `SF-TPL-0101` | error | Unknown instruction |
| `SF-TPL-0102` | error | Unbalanced block (`$CMS_END_IF$` missing) |
| `SF-TPL-0103` | error | Unknown editor name in this scope |
| `SF-TPL-0104` | error | Unknown filter |
| `SF-TPL-0110` | error | Unresolvable asset reference |
| `SF-TPL-0111` | warning | Cross-asset `$CMS_VALUE(assetType:uid)$` without an editor path |
| `SF-TPL-0112` | warning (render) | Cross-asset value target missing or soft-deleted; renders empty |
| `SF-TPL-0120` | error | `$CMS_BODY` used in a section template |
| `SF-TPL-0130` | error (render) | Nesting depth above 32 below the page template |
| `SF-TPL-0131` | error (render) | Loop iterations above 100,000 in one page render |
| `SF-TPL-0132` | error (render) | Output above 32 MB in one page render |
| `SF-TPL-0133` | error (render) | Page render exceeded the 5 s time budget |
| `SF-TPL-0135` | error (render) | Include cycle (`a → b → a`) |
| `SF-TPL-0201` | warning | Body declared but never rendered |
| `SF-TPL-0301` | warning | `raw` filter on a plain-text editor |
| `SF-TPL-0310` | warning | Editor declared in CDL but never used in any channel template |

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

### 17.3 Other structure uses

The same asset type also backs breadcrumbs, sitemaps and index listings; `navigation`, `breadcrumb`, `list` are the three declarable `kind` values, sharing the source/order/filter grammar.

---

## 18. Generation pipeline

### 18.1 Trigger and scope

| Trigger | Scope | Actor |
|---|---|---|
| `POST /projects/{p}/generations` | full or incremental | DEVELOPER / PROJECT_ADMIN |
| Save (auto) | preview only, in-memory | any editor |
| Scheduled | full, cron per project | system |

Request body:

```json
{
  "mode": "INCREMENTAL",
  "revision": null,
  "channels": ["html", "markdown"],
  "targetId": 3,
  "scope": { "folderPath": "/products/", "assetUuids": [] },
  "comment": "Autumn campaign live"
}
```

`revision: null` means "current". Passing a revision generates the site **as it was**, which is the mechanism behind reproducible republishing and rollback verification.

### 18.2 Stages

```
1  SNAPSHOT    Pin revision R. Load an immutable in-memory index of all assets at R.
2  PLAN        Determine the file set:
               full        → every page × every enabled channel
               incremental → changed assets since last successful run,
                             expanded over asset_reference reverse edges
                             (transitive; navigation-affecting changes expand to
                             all pages that render that structure)
3  VALIDATE    Compile every needed template and resolve refs.
               ERROR-severity findings abort before any file is written.
               Pages with ERROR completeness findings are held back (SF-GEN-0120,
               run PARTIAL; §10.5).
4  RENDER      Parallel over virtual threads (bounded by sf.generate.parallelism).
               Each unit: (page, channel) → rendered bytes. Reference edges come
               from save (§5.4); rendering does not write them.
5  ASSETS      Copy referenced media (and requested variants) to the target.
               Content-addressed: unchanged blobs are skipped.
6  POST        Optional per-channel post-processors: prettify/minify HTML,
               sitemap.xml, robots.txt, redirect map, search index JSON.
7  WRITE       Atomic publish into the target (§18.4).
8  REPORT      Persist GenerationRun with counts, timings, diagnostics.
```

### 18.3 Output paths

Resolution order for a page in channel `c`:

1. `page.payload.output.pathOverride[c]` if set,
2. else the page template's `outputPath[c]` expression,
3. else the project default `{folder}{uid}.{ext}`.

Placeholders: `{folder}`, `{uid}`, `{ext}`, `{displayNameSlug}`, `{year}`, `{month}`, `{day}` (from `nav.date`/`publishedOn`), `{channel}`.

Index handling (per channel, §15.2): for a page whose UID equals the channel's `indexUid` (default `index`), `{uid}` expands to the stem of the channel's `indexFileName` (default `index.{ext}`), so it renders to `{folder}index.{ext}` by default. With `trailingSlash: true` and `urlStrategy: PRETTY`, `/products/hammer.html` becomes `/products/hammer/index.html` and `$CMS_REF` emits a relative href to `/products/hammer/`.

Path collisions between two pages are a **build error** (`SF-GEN-0110`) listing both assets.

### 18.4 Targets and atomic publish

```
generation_target
  id, project_id, name, type (FILESYSTEM | ZIP | S3), config json, is_default
```

Each target owns the directory `{root} = {sf.generate.output-root}/{projectKey}/{path}`, where `path` is `config.path` (relative, `[A-Za-z0-9._-]` segments, no `.`/`..`) or `target-{id}` when unset. Targets of one project may not share or nest directories, and a project has at most one default target. `config.baseUrl` is used for sitemap and absolute links.

Filesystem publish is atomic via staged directories:

```
{root}/builds/{runId}/     ← files written here
{root}/current             ← symlink flipped after a successful run
```

Failed runs leave `current` untouched. The last *N* builds (default 5) are retained for instant rollback (`POST /generations/{runId}/promote`).

S3 publish writes to a key prefix, then updates a CloudFront/Nginx origin path or invalidates the changed keys only (derived from the diff, not a wildcard).

### 18.5 Generation run record

```
generation_run
  id, project_id, revision_id, mode, channels, target_id,
  status (QUEUED|RUNNING|SUCCESS|PARTIAL|FAILED|CANCELLED),
  started_at, finished_at, started_by,
  files_written, files_skipped, bytes_written,
  error_count, warning_count, diagnostics json, log_blob_sha
```

Runs are queued per project (one active run per project; a second request returns `409` with the running run's id). Progress is streamed to the UI via Server-Sent Events on `GET /generations/{id}/events`.

### 18.6 Performance targets

| Project size | Full build | Incremental (1 page) |
|---|---|---|
| 500 pages | < 20 s | < 2 s |
| 5,000 pages | < 5 min | < 10 s |
| 50,000 pages | < 45 min | < 30 s |

Measured with 2 channels, 8 vCPU, media unchanged.

---

## 19. Preview

### 19.1 Modes

| Mode | Description | Path |
|---|---|---|
| **Page preview** | Renders the page's current stored revision; used in the split-view editor, refreshed after each autosave | `GET /projects/{p}/preview/pages/{uuid}` |
| **Revision preview** | Renders any past revision | `GET …?revision=1841` |
| **Section preview** | Renders one section instance in isolation with sample surroundings | `POST /projects/{p}/preview/section` |
| **Channel preview** | Any of the above in a non-default channel; non-HTML channels render as syntax-highlighted text | `?channel=markdown` |

### 19.2 Mechanics

- Preview uses the **same** render engine and the same compiled templates as generation. There is no second code path — a preview that renders is a build that renders.
- Preview output is served from a dedicated, sandboxed route: `Content-Security-Policy: sandbox allow-scripts allow-same-origin`, `X-Frame-Options` allowing only the app origin, and a per-request nonce.
- `$CMS_REF` targets are rewritten to preview URLs (`/api/v1/projects/{p}/preview/pages/{uuid}`) so navigation inside the preview iframe stays inside the CMS. A "preview link rewriting" toggle lets developers inspect raw output paths.
- Media references resolve to the live media endpoint, so unpublished images appear immediately.
- The client never sends rendered data (content, bodies, or meta) to preview a page — only the page's `uuid` and, optionally, a `revision` to pin to. The server resolves everything else from the database, the same way it would for generation, so there is exactly one source of truth for what a page currently contains. In the split-view editor this means the preview pane reflects the page's state as of its last autosave, not literally-unsaved keystrokes; it is debounced (400 ms) and refetches whenever autosave completes.

### 19.3 In-app affordances

- Split view: editor left, preview right; the divider is draggable and the ratio persists per user.
- Viewport switcher: mobile 375, tablet 768, desktop 1280, full width.
- **Section highlighting:** rendered sections carry `data-sf-instance="{instanceId}"`; clicking a section in the preview focuses its editor form, and focusing a form field scrolls/outlines the section. Implemented with a tiny injected script that is present only in preview output.
- Preview share links: a signed, expiring URL (`?t=<jwt>`, 7 days, read-only) for stakeholders without accounts. Scope: one page, one revision.
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
| `GET` | `/projects` | authenticated | Only projects the user is a member of |
| `POST` | `/projects` | INSTANCE_ADMIN | Creates revision 1 |
| `GET` | `/projects/{key}` | VIEWER | |
| `PUT` | `/projects/{key}` | PROJECT_ADMIN | |
| `POST` | `/projects/{key}/archive` | INSTANCE_ADMIN | |
| `GET` | `/projects/{key}/members` | VIEWER | |
| `PUT` | `/projects/{key}/members/{userId}` | PROJECT_ADMIN | Set role |
| `DELETE` | `/projects/{key}/members/{userId}` | PROJECT_ADMIN | |

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
| `PUT` | `/projects/{p}/pages/{uuid}` | Full payload replace (`If-Match`) |
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
| `GET` | `/projects/{p}/media/{uuid}/binary` | original; `?variant=w800` |
| `GET` | `/projects/{p}/media/{uuid}/thumbnail` | 320 px, cached, `Cache-Control: private, max-age=86400` |

**Templates**

| Method | Path | Notes |
|---|---|---|
| `GET`/`POST` | `/projects/{p}/section-templates` | |
| `GET`/`PUT`/`DELETE` | `/projects/{p}/section-templates/{uuid}` | |
| `GET`/`POST` | `/projects/{p}/page-templates` | |
| `GET`/`PUT`/`DELETE` | `/projects/{p}/page-templates/{uuid}` | |
| `PUT` | `/projects/{p}/{templateKind}/{uuid}/channels/{channelKey}` | Set OCTL source |
| `DELETE` | `/projects/{p}/{templateKind}/{uuid}/channels/{channelKey}` | |
| `POST` | `/projects/{p}/cdl/validate` | `{source}` → diagnostics |
| `POST` | `/projects/{p}/octl/validate` | `{source, channelKey, templateUuid}` → diagnostics |

**Channels** — see §15.3. **Structures** — same shape as templates under `/structures`.

**Generation**

| Method | Path | Notes |
|---|---|---|
| `GET` | `/projects/{p}/generations` | Run history |
| `POST` | `/projects/{p}/generations` | Start run (§18.1) |
| `GET` | `/projects/{p}/generations/{id}` | Status + diagnostics |
| `GET` | `/projects/{p}/generations/{id}/events` | SSE progress |
| `POST` | `/projects/{p}/generations/{id}/cancel` | |
| `POST` | `/projects/{p}/generations/{id}/promote` | Rollback to a previous build |
| `GET`/`POST`/`PUT`/`DELETE` | `/projects/{p}/targets[/{id}]` | Target CRUD (PROJECT_ADMIN) |

**Revisions**

| Method | Path |
|---|---|
| `GET` | `/projects/{p}/revisions` (`?since=`, `?userId=`, `?assetUuid=`) |
| `GET` | `/projects/{p}/revisions/{r}` |
| `GET` | `/projects/{p}/revisions/{r}/diff` |
| `POST` | `/projects/{p}/restore` (`{toRevision}`, PROJECT_ADMIN) |

**Preview** — see §19.1.

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
- Media bytes are written to the blob store **before** the transaction commits, and orphaned blobs (commit failed) are collected by the nightly sweep — never the reverse order, so a committed asset version always has its bytes.
- Generation runs outside the request transaction: the snapshot is loaded read-only at a pinned revision, so a long build never holds locks.

### 21.5 Caching

Template compilation is cached in two tiers by `CompiledTemplateCache` (`sf-domain`, Caffeine). Only compilation is cached, never rendered output. Template save compiles uncached, since it is authoring-time validation.

| Tier | Used by | Key | Eviction |
|---|---|---|---|
| Per-build memo (`TemplateCompileMemo`), OCTL | generation: VALIDATE, the completeness check and RENDER | `(templateUuid, channel)` | released with the build's snapshot object |
| Per-build memo, CDL | same | `templateUuid` | same |
| Cross-request, OCTL | preview | `(projectId, templateUuid, validFromRevision, channel)` | `sf.cache.compiled-templates.max-size` (2,000), `sf.cache.compiled-templates.idle` (30 min) |
| Cross-request, CDL | preview | `(projectId, templateUuid, validFromRevision)` | same |

- **Per build.** One memo per generation snapshot (held in a weak-keyed cache), shared by every stage and render thread of the run, so each (template, channel) compiles at most once per build. The key needs no revision because the snapshot pins every template source and every `assetType:uid → UUID` mapping for the build.
- **Across requests.** The template version (`validFromRevision`) in the key means a template edit or a time-travel preview never hits another version's entry. OCTL resolution also depends on *other* assets, so each entry records every `assetType:uid` lookup the compile made, including failed ones. On a hit those lookups are re-resolved against the current project resolver; if any answer differs (a renamed, deleted or newly created target), the entry is recompiled and replaced. A stale mapping is never served. Two concurrent misses may both compile; the last write wins.
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
  revision:
    retention-days: unlimited

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
                                   └──< asset ──< asset_version
                                                     │
                                                     └──< asset_reference
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
| Code editing | Monaco with custom CDL/OCTL languages (tokenizer, completion, diagnostics) |
| i18n | Angular i18n, en + de at launch |
| Testing | Vitest + Testing Library, Playwright for E2E |

### 23.2 Application structure

```
ui/src/app/
├── core/
│   ├── auth/           auth.store.ts, jwt.interceptor.ts, refresh.interceptor.ts, guards
│   ├── api/            generated/, api-error.interceptor.ts, etag.interceptor.ts
│   ├── project/        project-context.store.ts, project.resolver.ts
│   └── ui/             toast.service.ts, dialog.service.ts, shortcut.service.ts
├── shared/
│   ├── components/     sf-button, sf-field, sf-table, sf-tree, sf-empty-state, sf-diff
│   ├── directives/     sfAutofocus, sfTooltip, sfDropTarget
│   └── pipes/          sfRelativeTime, sfFileSize
├── features/
│   ├── auth/           login, password change
│   ├── dashboard/      project picker, recent activity
│   ├── pages/          page-list (tree), page-editor (split view), body-editor
│   ├── media/          library grid, uploader, detail drawer
│   ├── templates/      template-list, cdl-editor, octl-editor (channel tabs)
│   ├── structures/     navigation editor + renderer editor
│   ├── channels/       channel CRUD
│   ├── revisions/      timeline, diff viewer, restore
│   ├── generation/     run dialog, live log (SSE), run history
│   └── admin/          users, projects, members
└── design/             tokens.scss, typography.scss, themes/
```

### 23.3 Auth handling

- `authStore` holds the access token in a signal — **never** in `localStorage`.
- `jwtInterceptor` attaches `Authorization: Bearer …`.
- `refreshInterceptor` catches `401`, pauses concurrent requests in a single-flight refresh, retries once, and routes to `/login` on failure while preserving `returnUrl`.
- A silent refresh timer fires at 80% of token lifetime.
- Route guards: `authGuard`, `projectMemberGuard(minRole)`. Guards read roles from the decoded token, so navigation never waits on a network call.
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
- Validation messages come from the definition (`validate … message "…"`), falling back to i18n defaults.
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

- Monaco with a custom OCTL language: tokenizer for `$CMS_…$`, bracket matching for block instructions, folding, and completion providers fed by the template's own CDL (`$CMS_VALUE(` offers the declared editor names, `$CMS_REF(page:` offers UIDs from the project index).
- Diagnostics: `POST /octl/validate` on a 500 ms debounce → markers with codes and quick links to the reference documentation.
- Channel tabs across the top (`HTML | Markdown | + Add channel`); an unsaved indicator per tab.
- Split view: CDL on the left, channel template on the right, sample-content preview below — a developer sees the effect of a declaration immediately.
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
10. **Generate.** Dialog (mode, channels, target, comment) → live log with per-stage progress, error/warning grouping by code, and a file-count summary. Errors link straight to the offending template line.
11. **Admin.** Users, projects, members.

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
- Generation runs are claimed via a `FOR UPDATE SKIP LOCKED` queue row so exactly one node executes a run.
- PostgreSQL: expected 30–80 GB at the top of the range; partitioning of `asset_version` by `project_id` is the documented escape hatch (not needed at v1 scale).

### 26.3 Security

| Area | Control |
|---|---|
| Transport | TLS 1.3 only, HSTS, secure cookies |
| Auth | §9; BCrypt cost 12; lockout; refresh rotation with reuse detection |
| AuthZ | Per-project role check on every endpoint; deny-by-default; project existence not leaked |
| Injection | Parameterized JPQL/SQL only; no string-built queries; OCTL cannot reach Java |
| XSS | Channel-default escaping in OCTL; TipTap schema-constrained input; Angular sanitization; strict CSP on preview |
| Upload | Tika type sniffing, allow-list, size cap, SVG sanitization, EXIF strip, non-executable storage path |
| SSRF | No server-side fetch of user-supplied URLs in v1 |
| Path traversal | Output paths normalized and asserted to stay under the target root; `..` rejected at validation |
| Secrets | Env/secret-manager only; never in the DB or logs |
| Audit | Revisions cover content; a separate `audit_log` covers auth, membership, channel and target changes; retained 1 year |
| Rate limits | Login, preview render, generation start |
| Headers | CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` |

### 26.4 Observability

- Structured JSON logs with `traceId`, `projectKey`, `revision`, `userId`.
- Micrometer metrics: `sf.revision.allocate`, `sf.render.duration{template,channel}`, `sf.generation.duration{mode}`, `sf.generation.files`, `sf.media.upload.bytes`, cache hit ratios, HTTP histograms.
- OpenTelemetry tracing across request → service → render.
- Health: `/actuator/health` with DB, blob store and Liquibase checks; `/actuator/info` exposes schema version.
- Alerts: generation failure rate, p95 save latency, refresh-token reuse detections, disk headroom on the blob store.

### 26.5 Backup & recovery

- PostgreSQL: nightly base backup + WAL archiving; PITR target RPO 5 min, RTO 1 h.
- Blob store: replicated/versioned bucket or nightly rsync snapshot; blobs are immutable and content-addressed, so incremental backup is cheap.
- Consistency: because blobs are written before commit, a DB restore to an earlier point never references a missing blob.
- Quarterly restore drill, documented in the runbook.
- Project export/import (`ZIP`: assets JSON + blobs + manifest) as a portability and migration path.

### 26.6 Operations

- Deployment: two containers (backend, static UI behind Nginx) + external PostgreSQL container.
- Startup order: Liquibase migration runs on the backend before the app is `READY`; a failed migration keeps the container unhealthy rather than starting a degraded app.
- Zero-downtime deploys require backward-compatible changesets (expand → migrate → contract over two releases for destructive changes).
- Configuration via environment variables; profiles `dev`, `test`, `demo`, `prod`.

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

**Post-v1 candidates:** editorial workflow and scheduled publishing, multi-language content dimension, per-asset permissions, template packages shareable across projects, webhooks, headless JSON channel with an incremental delivery API, visual template scaffolding.

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
| `SF-API-0403` | 403 | Role insufficient for this project action |
| `SF-API-0404` | 404 | Asset, project or revision not found (or not visible) |
| `SF-API-0409` | 409 | Revision conflict (`If-Match` mismatch) |
| `SF-API-0412` | 412 | `If-Match` header missing on a mutating request |
| `SF-API-0413` | 413 | Upload exceeds the configured limit |
| `SF-API-0415` | 415 | MIME type not allowed |
| `SF-API-0422` | 422 | Content fails CDL validation (field-level details attached; structural page content findings in `issues`, §10.5) |
| `SF-API-0429` | 429 | Rate limit exceeded |
| `SF-DOM-0101` | 422 | UID already taken (after probe exhaustion) |
| `SF-DOM-0102` | 422 | Reserved UID |
| `SF-DOM-0110` | 409 | Folder not empty |
| `SF-DOM-0120` | 409 | Asset still referenced (delete without `force`) |
| `SF-DOM-0130` | 422 | Page reference folder target has no page in its subtree (a section template outside the body's `allow` list is `SF-API-0422` with an `allow` issue, §10.5) |
| `SF-TPL-01xx` | 422 | CDL/OCTL compile errors (§16.11) |
| `SF-TPL-0111` | — | Cross-asset value without an editor path (compile warning) |
| `SF-TPL-0112` | — | Cross-asset value target missing or soft-deleted (render warning) |
| `SF-TPL-0130`–`0133`, `SF-TPL-0135` | 422 (preview) | Render limit exceeded: depth, loop iterations, output size, time budget, include cycle (§16.10); fails only that page in generation (run `PARTIAL`) |
| `SF-GEN-0110` | — | Output path collision (build error) |
| `SF-GEN-0120` | — | Content incomplete: page held back, run `PARTIAL` (§10.5) |
| `SF-GEN-0210` | — | No channel template for an enabled channel (warning) |
| `SF-GEN-0220` | — | Reference to a deleted asset: `$CMS_REF`, `$CMS_INCLUDE` or a body section target is soft-deleted; renders empty (warning, §16.4). Cross-asset values use `SF-TPL-0112` |
| `SF-GEN-0301` | — | `raw` filter on a plain-text editor (warning) |
| `SF-GEN-0410` | — | Navigation cycle truncated (warning) |
| `SF-GEN-0500` | 409 | A generation run is already active for this project |

---

## Appendix C — Open questions

| # | Question | Owner | Needed by | Status | Decision (v1) |
|---|---|---|---|---|---|
| Q1 | Should section instances be reusable across pages (shared sections) or always page-owned? Affects the content model and the reference table. | Product | M2 | **Resolved** | Page-owned. Section instances live inside a page's `bodies` (`SectionInstance` model, `BodyService`/`AddSectionRequest`); the `asset_reference` `OCTL_INCLUDE` edge covers *template* reuse, not instance sharing. |
| Q2 | Multi-language: separate projects, folder convention, or a first-class content dimension in v2? | Product | v2 planning | **Deferred to v2** | Explicit v2 (spec §2.2: no multi-language dimension in v1). |
| Q3 | Do we need a JSON/headless channel at v1 for a client-side search index, or is a post-processor sufficient? | Tech lead | M5 | **Resolved** | Post-processor sufficient. `SearchIndexPostProcessor` emits the search-index JSON from generation; the `structure` `list` kind covers listings. No first-class JSON channel in v1. |
| Q4 | Retention policy for revisions on large projects — is unlimited history acceptable at 50,000 assets? | Ops | M7 | **Deferred** | Unlimited in v1; compaction is a documented escape hatch reserved by §7.7 (`revision.compacted` flag reserved). Revisit before 50,000-asset scale. |
| Q5 | Should `PROJECT_ADMIN` be able to add members who are not yet instance users (invite flow with email)? | Product | M6 | **Resolved** | No invite flow in v1. Membership is restricted to existing instance users: `PUT/DELETE /projects/{key}/members/{userId}` operate by `userId`, not email. |
| Q6 | Preferred publish target for the pilot customer: filesystem+Nginx, or S3+CDN? Affects M4 priorities. | Ops | M4 | **Resolved** | Filesystem + Nginx first. `FilesystemBlobStore` is the default backend, `FilesystemTargetWriter` the default target, and `infra/nginx/default.conf` + `infra/docker/docker-compose.yml` deliver the site. S3 (`S3BlobStore`, `S3TargetWriter`) ships as an optional backend for later. |
| Q7 | Does any pilot template need loops over *pages* (a listing section) beyond what `structure` provides? If yes, `$CMS_FOR(page : query(...))$` needs a scoped query grammar. | Tech lead | M5 | **Resolved** | No. The `structure` asset's `list`/`navigation`/`breadcrumb` kinds (§17.3) cover v1 listing needs; the scoped page-query loop grammar is deferred (recorded as a post-v1 candidate). |

### Resolutions (notes)

- **Q1** — Section instances are always page-owned; a `section` has its own `instanceId` (a UUID stable across edits) inside a page `body`. Reasons: shared/mutable sections would break the "one mutation → one revision → one parent asset" model and complicate the `asset_reference` materialization (a shared section's change would fan out to every referencing page). Template *reuse* (the desired behaviour) is already provided by `$CMS_INCLUDE` and the section-template registry.
- **Q5** — Membership is `(project, user)` only; there is no email-invite/guest-user concept. A member must already be an `app_user`. Instance admin creates users (or an invite-with-account-creation flow) out of band; the members API then binds them by `userId`. This matches the implemented `ProjectMemberRepository`/`ProjectController` members endpoints.
- **Q6** — Filesystem + Nginx is the v1 pilot target (matches the committed `infra/` stack). S3 is implemented but de-prioritized: it is not the default and has no dedicated ops runbook at v1. M4 priorities were set accordingly (filesystem atomic staged publish + `current` symlink first).
- **Q3/Q4/Q7** — Decisions recorded above are consistent with what the code implements; Q2 remains explicitly v2. No v1-affecting question is left open.
