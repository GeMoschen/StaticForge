---
id: M0.1.2
status: done
depends: [M0.1.1]
epic: m0-skeleton
feature: gradle-multiproject
area: infra
---

# M0.1.2 — Build conventions & quality tooling

## Context

Give the multi-module build a shared, professional baseline so that later epics inherit
consistent formatting, linting, and architecture rules (§21.2, §25.7).

## Goals

- Introduce a Gradle version catalog (`gradle/libs.versions.toml`) pinning all future
  dependencies (Java 21 toolchain, Spring Boot 3.3, Hibernate 6.5, Liquibase 4.29,
  Spring Security 6, JUnit 5/jqwik/AssertJ, MapStruct, Caffeine).
- Wire formatting (`spotless`) and static analysis (checkstyle and/or ArchUnit baseline)
  across `server/*`.
- Set the Java 21 toolchain and virtual-thread-friendly settings consistently.
- Configure `tasks.test { useJUnitPlatform() }` and coverage reporting (JaCoCo) so the
  §25.7 gates have data to work with.

## Acceptance criteria

- [ ] `./gradlew spotlessCheck` and `./gradlew check` are wired and pass on the skeleton.
- [ ] `libs.versions.toml` is the single source of dependency versions (no hardcoded
      versions in module build files).
- [ ] JaCoCo aggregate report is produced for the server modules.
- [ ] An ArchUnit-style rule asserting the module layering (from M0.1.1) is present and
      run as part of `check`.

## Out of scope

- Actual business rules beyond layering.
- Frontend linting (feature 4).

## Notes / hazards

- Keep the tooling un-opinionated enough that future agents don't fight it; document any
  deviation in `docs/`.
- §21.2 mentions an ArchUnit rule ("no repository save outside `@RevisionAware`"); that
  specific rule lands in M1 — only the *harness* is set up here.
