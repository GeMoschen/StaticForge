# Feature: Gradle multi-module build

**Spec:** §4.3 (module layout), §21.1 (packages), `tasks/project-structure.md`.
**Area:** infra / backend. **Epic:** M0.

## Goal

Replace the placeholder single-module Gradle build with the professional multi-module
layout (`server/sf-common`, `sf-domain`, `sf-template`, `sf-generate`, `sf-api`,
`sf-app` plus the `ui/` Angular workspace) and wire a CI pipeline around it.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-gradle-multiproject-setup.md](001-gradle-multiproject-setup.md) | — |
| 2 | [002-build-conventions.md](002-build-conventions.md) | 1 |
| 3 | [003-ci-pipeline.md](003-ci-pipeline.md) | 1, 2 |

## Feature exit criteria

- [ ] `./gradlew build` succeeds from a clean checkout and produces all modules.
- [ ] Module dependency graph matches §4.3 (no forbidden upward deps; enforced by a
      check).
- [ ] Version catalog + shared conventions applied uniformly.
- [ ] CI runs build/test/quality on every push and fails on regression.
