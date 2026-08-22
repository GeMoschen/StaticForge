# StaticForge CMS — Architecture

This document grounds the high-level architecture described in `cms-specification.md` §4–§7 in the code as it actually exists. It is a *reader's* map, not a spec: where a class or module is named, it exists in the repository.

The signed-off architecture decisions live in [`docs/adrs/`](adrs/):

- [0001 — Module layering](adrs/0001-module-layering.md)
- [0002 — Revision safety](adrs/0002-revision-safety.md)
- [0003 — JSON payload + reference materialization](adrs/0003-json-payload-reference-materialization.md)
- [0004 — CDL + OCTL languages](adrs/0004-cdl-octl-languages.md)
- [0005 — Generation atomic publish](adrs/0005-generation-atomic-publish.md)

## 1. System overview

StaticForge is a **headless, revision-safe CMS that produces static sites**. Three concerns are deliberately separated (§1):

| Concern | Owned by | Artifact |
|---|---|---|
| *What can be edited* | CDL inside templates | editor declarations |
| *What the editor typed* | content storage | versioned content values per asset |
| *How it is rendered* | OCTL channel templates | one template per (template, channel) pair |

```
Browser (Angular SPA)
   │  HTTPS · REST/JSON · Bearer JWT
Spring Boot backend (staticforge-server)
   │  JDBC                        │ file/S3
PostgreSQL (external Docker)      Binary store (media + generated output)
```

Runtime is Java 21 / Spring Boot 3.3 with virtual threads enabled for generation fan-out. See spec §4.2 for the full technology table.

## 2. Module layout

Six Gradle modules, dependency edges strictly upward (see ADR-0001):

```
sf-app → sf-api → { sf-domain, sf-template, sf-generate } → sf-common
                       sf-domain → sf-template
```

| Module | Package roots (`com.acme.staticforge.*`) | Responsibility |
|---|---|---|
| `sf-common` | `common` | `Problem`/`ProblemFactory` (RFC 9457), `JsonUtil`, shared utilities |
| `sf-domain` | `asset`, `revision`, `project`, `user`, `channel`, `structure`, `preview`, `generate` | entities, repositories, domain services, transactions |
| `sf-template` | `template.cdl`, `.octl`, `.render`, `.content`, `.diagnostic`, `.expression` | CDL + OCTL lex/parse/compile/render |
| `sf-generate` | `generate.plan`, `.snapshot`, `.render`, `.stage`, `.target`, `.nav`, `.postprocess` | build planning, rendering pipeline, writers, targets |
| `sf-api` | `api`, `security` | REST controllers, DTOs, JWT/authorization |
| `sf-app` | root, `tooling` | Spring Boot application, Liquibase, `OpenApiGeneratorMain` |

The `checkModuleLayers` task (root `build.gradle.kts`) fails the build on any forbidden edge.

## 3. Core domain model

The model strictly separates **identity** from **state** (ADR-0002):

- `Asset` — one immutable row per asset for its lifetime; holds `uuid`, `project_id`, `asset_type`, `uid`, `created_at/by`. Updated only on an explicit UID rename.
- `AssetVersion` — one row per change; holds the mutable state (`display_name`, `folder_id`, `folder_path`, `template_asset_id`, payload) plus a `valid_from_revision`/`valid_to_revision` interval and a `deleted` flag.
- `AssetReference` — materialized outgoing edge (`from_asset_id`, `to_asset_id`, `kind`, `source_path`, revision interval), typed by `ReferenceKind` (ADR-0003).

Type-specific data lives in a `jsonb` payload column (ADR-0003); the handful of query/integrity fields are real columns on `asset_version`, kept in sync by the domain layer. `asset_reference` powers the usage view, incremental generation, and broken-link reporting.

## 4. Revision safety

Every mutation → one revision → one transaction. Key pieces:

- `RevisionCounterRepository` + `JdbcRevisionCounterRepository` — gapless, contention-safe per-project allocation (ADR-0002).
- `RevisionContext` — carried by every mutating service method; `RevisionService.allocate(...)` is called first.
- `@RevisionAware` — ArchUnit-enforced marker: the only classes allowed to call repository save/delete.
- `RevisionDiff`/`DiffService`/`JsonDiffer`/`HtmlBlockSplitter` — structural diff with block-level rich-text diffing (§7.6).
- `ProjectRestoreService` — project-wide rollback as a bulk restore in one new revision.

Concurrency token is the revision interval itself (`If-Match: "rev-{n}"`); there is no JPA `@Version` column (spec §22.5).

## 5. The two languages

- **CDL** (`template.cdl`): `CdlLexer` → `CdlParser` → AST → `CdlCompiler`/`CdlValidator` → `ContentDefinition`, plus `Diagnostic[]`. Declares editors (`EditorDefinition`, `EditorType`), bodies (`BodyDefinition`), and conditional visibility (`visibleWhen`).
- **OCTL** (`template.octl` + `template.render`): `OctlLexer` → `OctlParser` → AST → `OctlCompiler` → `CompiledTemplate` (immutable, cached by `(assetUuid, revision, channel)`). `Renderer`/`OctlRenderer` walks the compiled template against a `RenderContext`, applying `Filters` and channel `Escaping` (escaping-by-default).

Diagnostics: `template.diagnostic.DiagnosticCodes` (OCTL `SF-TPL-*`, CDL `SF-CDL-*`), `generate.GenerationDiagnosticCodes` (`SF-GEN-*`). See the [template-developer guide](template-developer-guide.md) for the full code catalogue.

## 6. Generation pipeline

`generate.GenerationalService` orchestrates the eight stages of §18: snapshot (`SnapshotService`/`Snapshot`) → plan (`BuildPlanner`/`BuildPlan`) → validate → render (`RenderPipeline`/`GenerationRenderer`) → assets (`AssetCopyStage`) → post-process (`PostProcessStage` + `postprocess/*`) → atomic write (`target/*`) → report. Filesystem publish is atomic via `{root}/builds/{runId}/` + `current` symlink (ADR-0005). Paths resolve through `render.OutputPathResolver`.

## 7. Media and blob store

`asset.media`: `MediaService` behind `BlobStore` (`FilesystemBlobStore` default, `S3BlobStore` optional). Bytes are content-addressed by SHA-256 (`Blob`, `BlobRepository`); `SvgSanitizer` sanitizes SVG uploads. Variants and metadata extraction per §11.4.

## 8. Security and authorization

`sf-api.security` holds the JWT stack (`JwtService`, `RefreshTokenService`, `SfJwtAuthenticationConverter`, `ProjectAuthorizationService`). Authorization is `(user, project) → role`, evaluated per request (`@PreAuthorize("@projectAuth.has(...)")`) with a `404`-vs-`403` distinction so project existence is not leaked (§8.4). No per-asset ACLs in v1.

## 9. Data and schema

Liquibase owns the schema (`ddl-auto: validate` in every profile); see `infra/README.md` for the four profiles (`dev`, `test`, `demo`, `prod`) and database details. The schema is a strict superset of §22.2, with `dbms`-scoped changesets for PostgreSQL↔H2 portability.

## 10. Frontend

Angular 18+ standalone, zoneless + signals. The dynamic form engine (`sf-content-form` + `FormBuilderService` + `EDITOR_REGISTRY`) renders a form from the `ContentDefinition`; the revision spine is the signature UX element (§24.2). See the [user guide](user-guide.md) and `ui/src/app/features/` for the feature layout.
