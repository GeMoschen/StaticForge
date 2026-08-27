---
id: M11.3.4
status: todo
depends: [M11.3.1]
epic: m11-store-coverage-and-provenance
feature: export-import-ui-v2
area: frontend
---

# M11.3.4 — Explicit/implicit indication in the export tree itself

## Context

`project-settings-export.component`'s tri-state tree (`M10.3.2`, already
shipped for Pages/Media, extended to Navigation by `M11.3.1`) computes a
folder's checkbox state (`folderState`) purely from how many of its
*descendants* are selected — checked, unchecked, or the standard tri-state
"indeterminate" dash when only some are. That conflates two genuinely
different situations that `M11.2.1` already distinguishes on the backend:

1. A folder with only *some* descendants explicitly picked, where the folder
   itself is not exported at all unless something else pulls it in — the
   traditional meaning of an "indeterminate" checkbox.
2. A folder that **will** be exported — fully, as itself — purely because
   it's an ancestor of something selected beneath it (`M11.2.1`'s `implicit`
   classification). This is not "partially selected"; the folder is
   definitely included, just not because the user (or a folder-subtree pick)
   chose it directly.

Today's tree conflates case 2 into the same indeterminate visual as case 1,
which understates what will actually happen: the user has no way to tell,
before exporting, which ancestor folders are coming along for the ride. This
task fixes that specifically, across every foldered store's tree (Pages,
Media, Navigation — not just the new one this epic adds).

## Goals

- Give each tree node a three-way visual state instead of the current
  checked/unchecked/indeterminate pair conflating explicit-partial with
  implicit-whole:
  - **Unchecked** — not included.
  - **Explicit** — the user directly checked this node, or it's covered by
    an ancestor folder's own "this folder + full subtree" pick (i.e.,
    exactly today's `ancestorChecked`-propagated "checked" state) — rendered
    as today's normal checked state.
  - **Implicit** — not directly checked and not covered by an ancestor's
    full-subtree pick, but will be included anyway because *some* descendant
    of it is selected (explicit or implicit) — a new, visually distinct
    state (e.g. a filled-but-differently-styled checkbox, or a small
    "included automatically" icon/tag next to the row), not the traditional
    indeterminate dash.
- Compute this client-side by mirroring the same ancestor-walk logic the
  backend already uses (`resolveIncludedAssetIds`/`M11.2.1`) — the frontend
  already has the full tree loaded in memory (`ProjectContextStore`), so this
  is a pure local computation, not a new API call: any node with at least one
  explicit-or-implicit descendant is `implicit` unless it's itself
  explicit.
- Apply this uniformly to the Pages and Media trees (retrofit, since they
  predate this distinction) as well as the new Navigation tree from
  `M11.3.1` — one shared implementation, not three.

## Acceptance criteria

- [ ] Checking a single deep leaf item visually marks every ancestor folder
      above it up to the tree root as `implicit` (not `unchecked`, and not
      the old generic `indeterminate` dash).
- [ ] Checking a folder (picking "this folder + its subtree") marks that
      folder and every live descendant `explicit`, and every ancestor above
      it `implicit` — matching `M11.2.1`'s own backend classification
      exactly.
- [ ] A folder with two children, only one of which is explicitly checked and
      the other not, itself shows as `implicit` (it will be exported, as
      itself, because of the one explicit descendant) — this is the exact
      case that used to render as a plain "indeterminate" dash and now must
      read as "included, automatically."
- [ ] This applies identically in the Pages, Media, and Navigation trees.

## Out of scope

- Any change to what's actually sent in the export request — `assetUuids`
  still only needs the user's own explicit picks (`M10.1.1`'s existing
  design; the backend still does the real expansion) — this task is purely
  about what the tree *shows*, not what gets submitted.
- The import-side conflict report's explicit/implicit tags — `M11.3.3`,
  already covers that separately.

## Notes / hazards

- Keep the visual distinct enough from both "checked" and "indeterminate"
  that a user glancing at the tree can tell all three states apart at a
  glance — this is exactly the kind of state the epic's own "professional
  AAA-grade" bar (carried over from `M10.3.3`) is meant to catch if it's
  muddy or easy to misread.
