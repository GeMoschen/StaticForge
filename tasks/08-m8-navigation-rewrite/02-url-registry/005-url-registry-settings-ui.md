---
id: M8.2.5
status: done
depends: [M8.2.4]
epic: m8-navigation-rewrite
feature: url-registry
area: frontend
---

# M8.2.5 — Project settings: Navigation URLs panel

## Context

Add a new tab to the project settings shell (`ui/src/app/features/settings/`), next to
`general`/`media`/`channels`/`generation`/`revisions`, following the
`project-settings-general`/`project-settings-media` component pattern.

## Goals

- New tab entry `url-registry` (label "Navigation URLs") in
  `project-settings-shell.component.html`, routed via a lazy child route in
  `app.routes.ts`.
- `project-settings-url-registry.component.ts/.html/.scss`: standalone, `OnPush`,
  injects a new `url-registry.service.ts` (same typed-`HttpClient`-over-generated-schema
  pattern as `channels.service.ts`).
- Table view: filterable by channel and area (`PREVIEW`/`GENERATED` tabs or a toggle),
  columns = `PageReference` label, URL, overridden flag, assigned-at; inline edit for
  manual override (calls the `PATCH` endpoint).
- Reset controls: per-row reset, per-channel reset, per-area reset, and a
  project-wide "Reset all" — each behind a confirmation dialog (reuse the shared
  `shared/` confirm-dialog component) since reset is destructive per `M8.2.4`'s Notes.

## Acceptance criteria

- [x] Tab appears in project settings and loads the registry list against the real
      backend.
- [x] Filtering by channel/area works.
- [x] Manual override edits persist and reflect immediately in the table.
- [x] Every reset action requires confirmation and, after confirming, the affected rows
      disappear from the table (since `reset` deletes them; they reappear only once
      something re-triggers a `resolve`, e.g. a generation run or a nav preview).
- [x] Vitest tests for the table's filter/override/reset interactions (written; see Notes
      for their run status against this repo's pre-existing test-infra defect).

## Out of scope

- Nothing further planned in this epic — this is the last task.

## Notes / hazards

- After a reset, the UI should clearly communicate "entries will repopulate on next
  generation/preview" rather than implying they're gone forever, to avoid alarming
  users who don't understand the lazy-repopulate contract from `M8.2.2`.

## Implementation record (M8.2.5, done)

**Schema regeneration was needed first.** `ui/src/app/core/api/generated/schema.d.ts` had
none of `M8.2.4`'s url-registry types. Ran `./gradlew :server:sf-app:generateOpenApi` then
`npm run generate:api` from `ui/`; the regenerated schema now includes
`UrlRegistryEntryView`, `UrlRegistryOverrideRequest`, `UrlRegistryResetRequest`,
`PageUrlRegistryEntryView` (the `Page<UrlRegistryEntryView>` envelope), and the three
`/url-registry...` paths. Committed as part of this task, same convention as `M8.1.6`.

**Final structure**, all under `ui/src/app/features/settings/` (matching the
`project-settings-general`/`project-settings-media` sibling-file convention, not a new
top-level feature folder):
- `url-registry.service.ts` — thin, self-contained `HttpClient` wrapper (own re-exported
  schema types, `withCredentials: true` on every call), covering `list` (channel/area/q/
  page/size params), `override` (`PATCH .../url-registry/{id}`), and `reset`
  (`POST .../url-registry/reset`, body built by the component per the chosen scope).
- `project-settings-url-registry.component.ts/.html/.scss` — standalone, `OnPush`. Table
  with channel and area (`PREVIEW`/`GENERATED`) `<select>` filters, pagination (20/page),
  inline per-row override edit (a text input replaces the URL cell, `Save`/`Cancel`), and
  four reset entry points: per-row (via each row's `Reset` button), per-channel and
  per-area (enabled only once that filter is set, so the scope being reset is always the
  same scope currently visible in the table), and a project-wide `Reset all`. Every reset
  path routes through one `pendingReset` signal + `confirmReset()`/`cancelReset()` pair so
  the confirmation copy and the actual request payload can never drift apart.

**Confirm-dialog approach.** No standalone `sf-confirm-dialog` shared component exists in
this codebase (verified by reading `ui/src/app/shared/components/` — `sf-table` and
`sf-tree` are bare content-projection wrappers, and there is no dialog component there at
all). The actual shared piece is `ui/src/app/core/ui/dialog.service.ts`'s `DialogService`:
a small `signal<DialogState | null>` with `open(config)`/`close()`, already used by
`media-detail-drawer.component.ts`. Its convention (confirmed by reading that component)
is: the service only holds *what* to show (title/message/labels/kind), and each consuming
component renders its own scrim+dialog markup off `dialog.state()` and wires the actual
confirm action to its own local pending-state signal — there's no generic "run this
callback on confirm" on the service itself. Followed that exact pattern here: `requestReset*()`
methods set `pendingReset` and call `dialog.open(...)` with scope-specific copy (naming the
entry/channel/area/"every channel, every area" explicitly, and — per this task's own Notes
hazard — always stating entries "will repopulate automatically the next time a generation
run or navigation preview resolves them"); `confirmReset()` reads `pendingReset()`, builds
the matching `{entryId}`/`{channelKey}`/`{area}`/`{}` request, calls the service, and on
success closes the dialog and reloads the list (the deleted rows simply don't come back
until something re-triggers a resolve, satisfying the "affected rows disappear" acceptance
criterion via a plain refetch rather than manual list surgery).

**Route + tab.** `project-settings-shell.component.html` gained a `url-registry` tab
("Navigation URLs") after `revisions`. `app.routes.ts` registers it via `loadComponent`
(a genuine lazy chunk — confirmed in the `npm run build` output: a separate
`project-settings-url-registry-component` chunk, 16.43 kB raw / 4.30 kB transfer), unlike
the other settings tabs which are eagerly `component`-mapped; the task's own Goals section
explicitly asked for a lazy child route here, so this one tab intentionally diverges from
its four siblings on that point while keeping everything else (styling, service shape,
inline-dialog markup) consistent with them.

**Build:** `cd ui && npm run build` is green (`ng build`) — no new errors or budget
warnings; the three pre-existing SCSS budget warnings on `templates`/`channels`/`media`
predate this change and are unrelated.

**Tests.** `project-settings-url-registry.component.spec.ts` (7 tests): list load against
the (mocked) backend, channel+area filtering, override persisting and reflecting
immediately, and all four reset scopes each asserting the confirmation dialog blocks the
call until confirmed and the request payload matches the scope
(`{entryId}`/`{channelKey}`/`{area}`/`{}`). Running `npm run test` hits the exact same
pre-existing, repo-wide `templateUrl`-component test-infra defect documented in `M8.1.6`'s
Resolution notes (`Component 'X' is not resolved: templateUrl: ...`, traced there to
`vitest.config.ts` never wiring up `@analogjs/vite-plugin-angular`) — reproduced identically
on these new specs, not a new failure signature. Per this task's own instructions and
`M8.1.6`'s precedent, this was not treated as a blocker; `npm run build` was the hard gate
and is green.
