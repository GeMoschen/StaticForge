---
id: M15.4.2
status: todo
depends: [M15.4.1]
epic: m15-compound-revisions
feature: revision-ux
area: frontend
---

# M15.4.2 — Verify diff/restore/conflict UX against real multi-asset revisions

## Context

`revision-diff.component.ts` (`ui/src/app/features/revisions/revision-diff.component.ts`)
already computes `assets = computed(() => diff()?.assets ?? [])` and offers
`restoreAsset(asset: AssetDiff)` per list entry plus `confirmRollback()` for the whole
project — both were built during `M6` against an API shape (`RevisionDiff.assets: AssetDiff[]`)
that always happened to hold exactly one element. This task is verification-and-light-
polish, not a rebuild: confirm the existing list rendering, per-asset restore, and
rollback confirmation copy all remain correct and legible once a revision routinely
holds many assets (post-`M15.2.1`, project creation is the first real 8-asset
revision this UI will ever have rendered).

## Goals

- Manually and via updated component tests, load the diff view for a post-`M15.2.1`
  project-creation revision (8 `AssetDiff` entries, all `action: "CREATE"`, mostly
  empty-payload folders) and confirm: the list renders all 8 without layout breakage,
  each entry's `restoreAsset` button targets the correct `asset.uuid`, and nothing in
  `sf-visual-diff`/`sf-body-diff`/`sf-field-diff` (the per-asset field-diff renderers)
  assumes it's the only asset on the page (e.g. shared signal state that should be
  per-asset-scoped but isn't).
- Confirm `requestRollback`/`confirmRollback`'s dialog copy ("Rolling back appends a new
  revision restoring the project state at this revision...") reads correctly regardless
  of how many assets the target revision touched — it already describes project-wide
  state, not this-revision's-assets, so likely needs no copy change; verify rather than
  assume.
- Confirm the conflict drawer (`ui/src/app/features/pages/conflict-drawer.component.ts`)
  needs no change: it's driven by `PageAutosaveService`'s single-asset `409` handling,
  which this milestone doesn't alter (no batched *write* UX is introduced — see the
  epic README's scope note). Document this confirmation in the task's completion notes
  rather than silently assuming it.
- If the 8-entry project-creation diff is visually noisy (mostly empty protected
  folders), consider a lightweight collapse/grouping affordance (e.g. group by
  `action`, or collapse folder-only `CREATE` entries under a summary line) — but only
  if the plain list rendering actually proves hard to scan in practice; don't add UI
  complexity preemptively.

## Acceptance criteria

- [ ] A component test loads a fixture `RevisionDiff` with 8 `AssetDiff` entries and
      asserts all 8 render, each with a working, correctly-scoped restore action.
- [ ] The rollback confirmation flow is manually verified against a multi-asset target
      revision (e.g. rolling back to the project-creation revision) and behaves
      correctly (existing test coverage extended if needed).
- [ ] The conflict-drawer no-change confirmation is documented (a one-line note in the
      PR/task result, per this repo's `tasks/todo.md` convention of recording what was
      verified vs. changed).
- [ ] `npm run build` and `npm test` green; if E2E journeys are runnable in this
      environment (`SF_RUN_E2E=1`), `m6-journeys.spec.ts` (journeys 5-8) still passes
      unmodified, confirming this milestone didn't regress the existing collaboration
      UX it's built on top of.

## Out of scope

- Building a new batched-edit authoring UX — explicitly out of scope for the whole
  milestone (epic README).
- The spine/history label change — `M15.4.1`.

## Notes / hazards

- This task is deliberately scoped as "verify, and lightly polish only if needed" —
  resist the urge to redesign the diff view's layout wholesale; the M6 implementation
  already renders `AssetDiff[]` generically, so the likeliest outcome is "it already
  works, ship it with a regression test," not a rebuild.
