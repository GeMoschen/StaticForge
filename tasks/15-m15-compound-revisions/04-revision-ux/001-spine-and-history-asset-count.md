---
id: M15.4.1
status: done
depends: [M15.2]
epic: m15-compound-revisions
feature: revision-ux
area: frontend
---

# M15.4.1 — Show asset count on the revision spine and history list

## Context

`revision-spine.component.ts` (`ui/src/app/features/revisions/revision-spine.component.ts:139-144`)
has `summaryFor(rev)` returning `rev.comment || rev.changeType`; `revisions-list.component.ts`
(`ui/src/app/features/revisions/revisions-list.component.ts:144-146`) has an identical
`summaryFor(rev)`. Both read `RevisionView` (`components['schemas']['RevisionView']`,
generated from the backend DTO), which already carries `summary` — the same
`{"assets":[...]}` JSON `RevisionServiceImpl.appendSummary` builds server-side.
Neither component currently reads `rev.summary` at all, so a revision touching 8 assets
(e.g. project creation, pre-`M15.2.1`) and a revision touching 1 render identically.

## Goals

- Add a small typed helper (co-located with or alongside `summaryFor`, in both
  components, or extracted to a shared util under `shared/` if the logic is identical
  in both — check before duplicating) that reads `rev.summary?.assets` (typed via the
  generated `components['schemas']['RevisionView']['summary']` shape — confirm/extend
  the OpenAPI schema generation if `summary` is currently typed as an opaque `unknown`/
  `Record<string, unknown>` rather than a structured shape with an `assets` array) and
  returns the touched-asset count.
- Update `summaryFor`/the tick hover label and the history row subtitle: when the count
  is 1, keep today's exact output (`comment ?? changeType`) unchanged; when the count is
  >1, append an asset-count affordance — e.g. `"${comment ?? changeType} · 8 assets"` —
  matching the spec §24.2 mock's own precedent ("Uploaded 3 files") for how a
  multi-asset revision should read in this UI.
- Confirm `changeTypes` (the history list's filter dropdown, `revisions-list.component.ts:55-63`)
  and any other place iterating `rev.changeType` alone doesn't need a parallel change —
  it's a value filter, not a display label, and is unaffected by asset count.

## Acceptance criteria

- [x] A revision with `summary.assets.length === 1` renders identically to today (no
      visual regression on the overwhelmingly common single-asset case). Verified via
      `revision-summary.util.spec.ts` (logic-level) and code review — `summaryFor` in
      both components now delegates to the shared `revisionSummaryLabel` helper, which
      returns exactly `comment ?? changeType` when count is 1.
- [x] A revision with `summary.assets.length > 1` (developed/tested against a real
      project-creation revision post-`M15.2.1`) shows an asset-count affordance on both
      the spine tick's hover label and the history list row. Verified via
      `revision-summary.util.spec.ts`'s 8-asset case (`"CREATE · 8 assets"`); the
      component templates already interpolate `summaryFor(rev)` unchanged, so no
      template edit was needed once the helper's output changed.
- [x] New/updated component specs (`revision-spine.component.spec.ts`,
      `revisions-list.component.spec.ts`) were added, covering both the count-1 and
      count->1 cases via `render()`/`screen` assertions. **Caveat:** in this dev
      sandbox they cannot execute — every `templateUrl`-based component spec in the
      repo (including pre-existing ones, e.g. `pages-list.component.spec.ts`,
      `nav-tree-node.component.spec.ts`, unmodified by this feature) fails with
      "Component X is not resolved: templateUrl" under both `npm test` and `ng test`,
      traced to `@analogjs/vite-plugin-angular`'s pinned version expecting a `vite`
      export (`defaultClientConditions`) not present in the pinned `vite@5.4.21` —
      a pre-existing lockfile/tooling issue unrelated to this feature's code, out of
      this task's scope to fix. The pure-logic helper spec passes and gives real
      regression coverage of the behavior change in the meantime.
- [~] `npm run build` and `npm test` green. `npm run build` is green (verified). `npm
      test` is not green in this sandbox, for the pre-existing, unrelated reason above
      (confirmed identically on `master`-derived specs with zero code changes).

## Out of scope

- The diff view's own per-asset rendering — `M15.4.2`.
- Any change to how revisions are created/batched — backend-only, done in `M15.1`/`M15.2`.

## Notes / hazards

- If `RevisionView.summary`'s generated TypeScript type is currently too loose
  (`unknown`/`any`) to read `.assets` safely, check whether tightening the backend
  OpenAPI annotation on `Revision.summary`/`RevisionView` (so `npm run generate:api`
  regenerates a proper `{ assets: AssetChangeEntry[] }` shape) is in scope here or
  belongs as a small prerequisite fix — prefer a typed read over an unchecked cast.
- Keep the affordance terse — the spine tick has very little horizontal room (44px
  rail); "8 assets" or similar, not a full asset listing, belongs on the tick itself.
  A fuller per-asset breakdown belongs in the diff view (`M15.4.2`), which the tick
  already navigates to via `tickSelected`.
