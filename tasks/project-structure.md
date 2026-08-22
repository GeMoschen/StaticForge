# Target Project Structure

This is the repository layout the implementation should converge on. It is derived
from §4.3 (Gradle modules) and §23.2 (Angular features) of `cms-specification.md`.
The current repo holds a placeholder single-module Gradle project; M0 replaces it.

## Top level

```
staticforge/
├── build.gradle.kts          # root build: version catalog, shared conventions
├── settings.gradle.kts       # includes server/*, ui
├── gradle/                   # wrapper + libs.versions.toml (version catalog)
├── server/                   # Spring Boot backend (Gradle multi-module)
├── ui/                       # Angular workspace (staticforge-ui)
├── infra/                    # docker-compose, nginx, CI/CD, runbooks
├── docs/                     # architecture, ADRs, API reference, runbooks
└── tasks/                    # this directory (work breakdown; not shipped)
```

## Backend modules (`server/`)

Per §4.3, one Gradle sub-project per layer, with a strict upward-only dependency order:

```
server/
├── sf-common/        # value objects, SfException hierarchy, Problem factory,
│                     #   Slugifier, JsonUtil — no Spring, no DB, no deps on peers
├── sf-domain/        # entities (Asset, AssetVersion, Revision, Project, AppUser…),
│                     #   repositories, UidGenerator, RevisionCounterRepository,
│                     #   domain services (ProjectService, AssetService…)
│                     #   depends: sf-common
├── sf-template/      # CDL lexer/parser/compiler/validator + OCTL lexer/parser/
│                     #   compiler/renderer + filters + diagnostics
│                     #   depends: sf-common (+ sf-domain types for resolution)
├── sf-generate/      # BuildPlanner, GenerationService, RenderTask, targets/
│                     #   (filesystem/ZIP/S3), postprocessors/
│                     #   depends: sf-domain, sf-template
├── sf-api/           # REST controllers, DTOs, MapStruct mappers, security filters,
│                     #   problem handlers, OpenAPI metadata
│                     #   depends: sf-domain, sf-template, sf-generate
└── sf-app/           # Spring Boot app, @SpringBootApplication, Liquibase changelogs,
                      #   application.yml profiles (dev/test/demo/prod), Actuator
                      #   depends: everything above
```

Dependency direction: `sf-app → sf-api → { sf-domain, sf-template, sf-generate } →
sf-common`. Never the reverse. `sf-template` must not depend on `sf-api`.

### Backend package namespace

`com.acme.staticforge.*` following §21.1 (`common/`, `project/`, `user/`, `security/`,
`revision/`, `asset/`, `render/`, `generate/`, `preview/`, `api/`).

## Frontend (`ui/`)

Angular 18+ standalone workspace, per §23.2:

```
ui/src/app/
├── core/            # auth (store, jwt/refresh/etag interceptors, guards),
│                    #   api generated client + error interceptor,
│                    #   project-context store + resolver, ui (toast/dialog/shortcut)
├── shared/          # components (sf-button, sf-field, sf-table, sf-tree,
│                    #   sf-diff, sf-empty-state), directives, pipes
├── features/        # auth, dashboard, pages, media, templates, structures,
│                    #   channels, revisions, generation, admin
└── design/          # tokens.scss, typography.scss, themes/
```

## Infra (`infra/`)

```
infra/
├── docker/          # docker-compose.yml (postgres, backend, nginx+ui)
├── nginx/           # static site serving + staticforge-ui SPA config
├── ci/              # GitHub Actions workflows
└── scripts/         # local dev helpers, backup/restore scripts, runbooks
```

## Key cross-cutting files

- `server/sf-app/src/main/resources/db/changelog/` — Liquibase changelogs (§22.4)
- `server/*/src/test/resources/render/` — golden-file render corpus (§25.4)
- Shared test fixtures (e.g. expression grammar cases) are emitted as files consumed
  by **both** backend and frontend (§14.4, §23.5).
