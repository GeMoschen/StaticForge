# Feature: Frontend shell

**Spec:** §23.1/23.2 (stack & structure), §24.3 (design tokens), §4.2 (Angular 18+,
OpenAPI-generated client).
**Area:** frontend. **Epic:** M0.

## Goal

Create the Angular workspace and application shell: standalone components, signals +
zoneless, routing skeleton, design tokens/theming, core UI plumbing, and the
OpenAPI→TS client generation pipeline (against an initial smoke contract).

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-angular-workspace.md](001-angular-workspace.md) | M0.1.1 |
| 2 | [002-design-tokens.md](002-design-tokens.md) | 1 |
| 3 | [003-core-ui-plumbing.md](003-core-ui-plumbing.md) | 1 |
| 4 | [004-api-client-generation.md](004-api-client-generation.md) | 1 |

## Feature exit criteria

- [ ] `ng build` (esbuild) + `ng test` (Vitest) + `ng e2e` (Playwright) are configured.
- [ ] The app boots zoneless with a placeholder routed shell and the design tokens load.
- [ ] The generated TS client builds from an OpenAPI document.

## Dependencies

`M0:gradle-multiproject` (for repo layout + CI awareness).
