# Frontend performance

Status: enforced in `ui/angular.json` (production build budget). Covers spec §23.8 and §25.7.

## Bundle budget

Production `ng build` enforces an `initial` bundle budget (target: initial JS
≤ 350 kB gzip per §23.8):

| Budget type | maximumWarning | maximumError |
|---|---|---|
| `initial` | 320 kB | 350 kB |
| `anyComponentStyle` | 2 kB | 4 kB |

- `initial` fails the build at 350 kB, which is > 5% over the budget target, satisfying the §25.7 "build fails on regression > 5%" gate.
- Current initial total (last measured): **270.19 kB** raw / **76.21 kB** estimated gzip. Comfortably under the 350 kB budget; the 320 kB warning threshold gives ~18% headroom and flags regressions before they hard-fail.

Note: the `anyComponentStyle` warnings already emitted for several component styles are informational and intentionally left in place.

## Performance targets (§23.8 / §26.1)

| Metric | Target |
|---|---|
| Initial JS | ≤ 350 kB gzip |
| LCP | ≤ 1.8 s on a mid-range laptop |
| Interaction (INP) | ≤ 100 ms |

## Measurement approach (intended, not yet wired into CI)

- Bundle size: the Angular build budget itself is the gate; `ng build --configuration production` fails on regression.
- Field/lab metrics: intended to be captured in CI via a Lighthouse CI step (throttled mid-range profile) asserting LCP ≤ 1.8 s and interaction metrics ≤ 100 ms.
- CI wiring is owned by the CI agent (`.github/`); this doc records the targets only.

## Change detection & list rendering

- The app is zoneless with `OnPush` change detection throughout; components use signals.
- Every `@for` loop carries an explicit `track` expression (equivalent to `trackBy`). Audited loops: pages list (`track page.uuid`, `track folder.uuid`), media library (`track item.uuid`, `track upload.id`), revisions list (`track rev.revisionId`), generation (`track run.id`, `track line.id`), folder tree (`track child.uuid`), structures (`track item.uuid`), channels, and form editors. No missing `track` clauses found.
- Virtual scrolling:
  - Revision timeline (`revisions-list`) uses a hand-rolled windowed virtual scroll (spacer + translateY window, `slice()` on scroll).
  - Media grid uses lazy-loaded images (`loading="lazy"`) with an intersection-observer sentinel for incremental loading.

## One bundle, no code splitting

Every route component is imported eagerly in `app.routes.ts`; there are no `loadComponent`/`loadChildren` dynamic
imports, so the build emits a single `main-*.js` (about 1.03 MB raw, 190 kB transferred, M21). This was decided on
2026-09-16: the form editors import each other in a cycle (section editor → content form → editor registry → catalog
editor → section editor), which chunk boundaries make fragile, and an "undefined ɵcmp" error was reported opening a
page with sections. The `initial` budget in `angular.json` is sized for the single bundle (warning 1.1 MB, error
1.3 MB). Don't reintroduce lazy routes without resolving that cycle first.
