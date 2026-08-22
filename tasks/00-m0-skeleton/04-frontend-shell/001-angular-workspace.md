---
id: M0.4.1
status: done
depends: [M0.1.1]
epic: m0-skeleton
feature: frontend-shell
area: frontend
---

# M0.4.1 — Angular workspace & application shell

## Context

Bootstrap the Angular 18+ workspace at `ui/` (§23.1) with standalone components, signals
and zoneless change detection, and a routed shell with lazy-loadable feature routes.

## Goals

- Create the `ui/` Angular workspace (`staticforge-ui`), Angular CLI + esbuild.
- Configure standalone components, zoneless change detection, and `signalStore`
  scaffolding (NgRx Signals) per feature (§23.1).
- Set up standalone routing with lazy `loadComponent` and a resolver pattern for the
  (future) project context (§23.2).
- Configure Vitest + Testing Library, and Playwright (Chromium/Firefox/WebKit) for E2E.
- Lay out the `core/`, `shared/`, `features/`, `design/` folders with placeholder
  modules so later agents drop into the right place.

## Acceptance criteria

- [ ] `ng serve`/`ng build` produce a working SPA shell.
- [ ] A placeholder route loads lazily; analytics/bundle basics from §23.8 (OnPush,
      trackBy convention) are documented in `docs/`.
- [ ] A trivial Vitest unit test and a trivial Playwright spec both pass.

## Out of scope

- Feature screens and real auth (M3).
- Monaco/TipTap wiring (M3).

## Notes / hazards

- Keep zoneless + `OnPush` conventions from day one — retrofitting is costly (§23.8).
