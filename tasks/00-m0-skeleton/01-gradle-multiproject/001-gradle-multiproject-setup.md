---
id: M0.1.1
status: done
depends: []
epic: m0-skeleton
feature: gradle-multiproject
area: infra
---

# M0.1.1 — Gradle multi-module project setup

## Context

The repo currently has a single placeholder `build.gradle.kts` producing one module.
Replace it with the layout in `tasks/project-structure.md` (Gradle 8, Kotlin DSL,
version `com.acme.staticforge`).

## Goals

- Create `server/sf-common`, `sf-domain`, `sf-template`, `sf-generate`, `sf-api`,
  `sf-app` as Gradle sub-projects and `ui/` as an Angular workspace (frontend build
  wiring is thin here; real UI arrives in feature 4).
- Define the root `settings.gradle.kts` and `build.gradle.kts` with the correct
  include list and the module dependency edges from §4.3.
- Enforce the layering: `sf-app → sf-api → { sf-domain, sf-template, sf-generate } →
  sf-common`; provide an `sf-common` that has no Spring/DB dependencies.
- Remove the placeholder `src/main/java/de/gemo/Main.java` and old single-module
  wiring once superseded.

## Acceptance criteria

- [ ] `./gradlew projects` lists all six backend modules plus `ui`.
- [ ] Each module has a `build.gradle.kts` with correct `implementation(project(...))`
      dependencies (no cyclic or reversed edges).
- [ ] `./gradlew build` succeeds from a clean checkout.
- [ ] A Gradle build-time check (e.g. ArchUnit on classpath, or a module-graph test)
      fails the build if a forbidden cross-module dependency is introduced.

## Out of scope

- Business code in any module (modules may contain empty `Application`-less skeletons
  or a single placeholder class).
- Angular component content.

## Notes / hazards

- Spring Boot plugin applies at `sf-app` only; library modules use the Java library
  plugin. Use `java-test-fixtures` where shared test builders will later be needed.
- Keep `group`/`version` centralized (see next task for the version catalog).
