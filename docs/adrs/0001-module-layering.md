# ADR-0001 — Gradle module layering with upward-only dependencies

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** Tech lead (specced in `cms-specification.md` §4.3, §21.2; enforced in `build.gradle.kts`)

## Context

The backend is a single Java 21 / Spring Boot 3.3 codebase but must separate concerns that evolve at different rates: domain model, template languages (CDL/OCTL), generation, REST/security, and application wiring. A single flat module would let any package reach any other, which is how long-term coupling (and circular dependency failures) happen.

## Decision

Split the backend into six Gradle modules and enforce a strict **upward-only** dependency graph. The allowed edges are declared as data in the root `build.gradle.kts` (`allowedEdges`) and verified at build time by the `checkModuleLayers` task (wired into `check`):

```
sf-common   → (nothing)
sf-domain   → sf-common, sf-template
sf-template → sf-common
sf-generate → sf-common, sf-domain, sf-template
sf-api      → sf-common, sf-domain, sf-template, sf-generate
sf-app      → sf-common, sf-domain, sf-template, sf-generate, sf-api
```

The graph is checked by walking each module's `compileClasspath` and failing the build on any `ProjectDependency` edge not present in `allowedEdges`. A reverse or peer edge is a build failure, not a review comment.

Package roots mirror the modules (`com.acme.staticforge.*`):

| Module | Package roots | Owns |
|---|---|---|
| `sf-common` | `common` | shared value objects, `Problem`/`ProblemFactory`, `JsonUtil` |
| `sf-domain` | `asset`, `revision`, `project`, `user`, `channel`, `structure`, `preview`, `generate` (run entity), `security` | entities, repositories, domain services |
| `sf-template` | `template.cdl`, `template.octl`, `template.render`, `template.content`, `template.diagnostic`, `template.expression` | CDL + OCTL parsing, compilation, rendering |
| `sf-generate` | `generate.plan`, `generate.snapshot`, `generate.render`, `generate.stage`, `generate.target`, `generate.nav`, `generate.postprocess` | build planner, writers, targets, post-processors |
| `sf-api` | `api`, `security` | REST controllers, DTOs, JWT/authorization |
| `sf-app` | `(root)`, `tooling` | Spring Boot application, Liquibase, OpenAPI generator |

## Consequences

- A module cannot reach "down" the stack: the render engine (`sf-template`) cannot see domain entities, and controllers (`sf-api`) cannot reach persistence directly, forcing every write through the domain `*Service` layer.
- `sf-domain` depending on `sf-template` (rather than the reverse) is deliberate: content validation and template persistence need the compiled definitions produced by `sf-template`, but `sf-template` stays free of any persistence/security dependency so it remains unit-testable in isolation.
- The layering rule in spec §21.2 (no repository save/delete outside a `@RevisionAware` service) is a complementary cross-cutting rule tracked separately; see `revision.RevisionAware`.
