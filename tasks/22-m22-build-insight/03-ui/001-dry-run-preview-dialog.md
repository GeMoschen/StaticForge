---
id: M22.3.1
status: done
depends: [M22.2.1]
epic: m22-build-insight
feature: ui
area: frontend
---

# M22.3.1 — Plan preview in the generation dialog

## Context

`ui/src/app/features/generation/generation-dialog.component.*` has FULL/INCREMENTAL
radio buttons, a target picker and a channel list (loaded via `loadChannels`).
`submit()` calls `generation.service.ts` to `POST /generations`. The user learns what
happened only after the run, from counts and grouped diagnostics
(`generation-diagnostics.ts`). After `M22.2.1`, `POST /generations/plan` returns
`GenerationPlanView`.

## Goals

- `generation.service.ts`:
  - `planGeneration(projectKey, request, {page,size,rootKind,channel,validate})`
  - `getRunPlan(projectKey, runId, {…})`
  - Uses generated types from `schema.d.ts`.
- **Shared components** (`ui/src/app/features/generation/insight/` or `shared/`):
  - `sf-rebuild-reason`: renders one `reason`.
    - Root badge text: "Full build", "Full build (no previous successful build for this target)", "Changed", "Deleted", "Explicitly selected".
    - Chain rendered as an ordered list of steps: asset type + uid, edge label ("uses template", "includes section", "references media", "renders navigation", generic "references" with `referenceKind`), optional source path in monospace, root revision linking to the revision diff.
    - "+ N other changes" when `causeCount > 1`.
    - Edge labels live in one lookup map. Unknown edge kinds fall back to the raw name,
      so edges added by `M17`–`M21` render before they get a label.
  - `sf-plan-entries-table`: paged entries (output path, asset, channel, reason
    collapsed/expanded), filters for root kind and channel, text filter.
- **Dialog:**
  - A "Preview plan" action (also shortcut `Alt+P`) runs the dry run with the current
    form values. Changing mode, target, channels or scope marks the preview stale.
  - Summary: entry count, changed asset count (expandable list), counts by root kind
    and by first edge ("412 via section_template:teaser").
  - Revision the plan was computed at.
  - A prominent warning when `fallbackCause` is set ("Incremental requested — no
    previous successful build for target *Site*; this will be a full build").
  - A "Validate templates" checkbox maps to `validate=true`. Diagnostics reuse
    `generation-diagnostics.ts` rendering.
  - Generating after a preview keeps working exactly as today. If the project revision
    moved since the preview, show "Plan preview is out of date" and do not block.
- Loading/error/empty states. Zero entries means "Nothing to rebuild" and still allows
  starting the run.
- Specs: service request mapping; reason component for each root kind, multi-step
  chain, unknown edge kind and `causeCount`; dialog stale marking and fallback warning.

## Acceptance criteria

- [x] Dialog shows an accurate preview (verified against a running backend: preview
      counts equal the counts of the run started right after).
- [x] Fallback-to-full is visibly warned about before starting.
- [x] Reason and entries components render every root kind and an unknown edge kind
      without errors.
- [x] Keyboard: preview, expand/collapse chains, page through entries without a mouse;
      chains are announced as ordered lists.
- [x] `npm run build` green; new specs pass, or their failure is shown to be the known
      `templateUrl` tooling issue (logic specs must pass regardless).

## Out of scope

- Run details tab and Impact panel (`M22.3.2`).
- Editing the plan (excluding pages, forcing extra pages).

## Notes / hazards

- Don't auto-run the dry run on every form change; it snapshots the project. Run it
  explicitly and mark it stale instead.
- Very large plans: the dialog shows the summary plus a paged table; never fetch all
  entries.
- The generation UI is DEVELOPER/PROJECT_ADMIN only (same as starting a run). Hide the
  preview action for other roles, matching the existing dialog gating.
