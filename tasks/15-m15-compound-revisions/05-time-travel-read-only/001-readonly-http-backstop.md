---
id: M15.5.1
status: done
depends: []
epic: m15-compound-revisions
feature: time-travel-read-only
area: frontend
---

# M15.5.1 — Client-side read-only HTTP backstop during time travel

## Context

`TimeTravelStore` (`ui/src/app/features/revisions/time-travel.store.ts`) already exposes
`isTimeTravel` (a computed signal) and is entered/exited by
`project-shell.component.ts`'s `onTick`/`backToNow` (lines 23-36). Today only
`page-editor.component.ts` reads it, aliasing it to `readOnly` and gating its own edit
handlers. Every other write path — `templates.component.ts`'s `saveDefinition`/
`saveChannel`/`deleteChannel`/`delete`/create calls, `media-detail-drawer.component.ts`'s
`replaceMedia`/`deleteAsset`, `nav-folder-detail.component.ts`/
`nav-reference-detail.component.ts`'s create/move/delete, `project-settings-shell`'s
panels, channel CRUD — calls `ApiClient` methods directly with no awareness of time
travel at all. The existing interceptor chain, registered in `ui/src/app/app.config.ts`
(`provideHttpClient(withInterceptors([jwtInterceptor, refreshInterceptor,
errorInterceptor, etagInterceptor]))`), is the natural place for a project-wide
backstop: one more interceptor that every request already flows through, regardless of
which component or service issued it.

## Goals

- Add `readonlyInterceptor` (`ui/src/app/core/api/readonly.interceptor.ts`,
  `HttpInterceptorFn`, matching the existing interceptors' style) that: injects
  `TimeTravelStore`, and for any outgoing request whose method is `POST`/`PUT`/`PATCH`/
  `DELETE` **and** whose URL matches the active project's API base (reuse whatever
  project-scoping the `etag`/`error` interceptors already use to recognize
  project-scoped requests — don't block auth/refresh calls, which must keep working
  while time-travelling), short-circuits with a client-side error (e.g.
  `throwError(() => new HttpErrorResponse({ status: 0, statusText: 'Read-only (viewing revision)', url: req.url }))`)
  instead of calling `next(req)`, whenever `timeTravel.isTimeTravel()` is true.
- Ensure `GET`/`HEAD` requests are never blocked — time travel is a viewing mode; the
  revision diff view, asset-at-revision reads, and preview must keep working normally
  while active.
- Register `readonlyInterceptor` in `app.config.ts`'s interceptor chain, ordered before
  `errorInterceptor` so a blocked request still gets routed through the existing global
  error-toast handling rather than needing its own separate surfacing path (verify
  `errorInterceptor`'s existing handling produces a sensible toast for this synthetic
  error, or extend it minimally if not).
- Add a `ReadOnlyBannerService`/reuse `ToastService` to surface a clear, one-time-per-
  attempt message ("You're viewing revision N — exit time travel to make changes")
  rather than a generic network-error toast, so a blocked action reads as intentional,
  not broken.

## Acceptance criteria

- [x] A new interceptor unit test (`readonly.interceptor.spec.ts`) proves: with
      `TimeTravelStore.isTimeTravel()` true, a `PUT`/`POST`/`PATCH`/`DELETE` request to
      a project-scoped endpoint never reaches `HttpTestingController`'s backend (i.e.
      `next(req)` is never called); a `GET` request in the same state passes through
      unaffected; with `isTimeTravel()` false, all methods pass through unaffected.
      Also verifies the `POST .../restore` exemption. All 5 cases pass
      (`npx vitest run src/app/core/api/readonly.interceptor.spec.ts`).
- [x] The interceptor is registered in `app.config.ts` and the app still boots/builds
      (`npm run build` succeeds).
- [x] A blocked request surfaces a clear, distinguishable message to the user (not a
      generic "network error") — the synthetic `HttpErrorResponse.error` carries
      `{ title, detail }` shaped exactly like the `Problem` body `errorInterceptor`
      already unwraps, so the existing toast shows
      `READ_ONLY_TIME_TRAVEL_MESSAGE` ("You're viewing a past revision — exit time
      travel to make changes.") verbatim, no extension to `errorInterceptor` needed.
- [x] `npm run build` green. `npm test`: the interceptor's own spec is green, but the
      overall suite is **not** fully green in this environment — see note below; this
      is a pre-existing condition, not a regression from this task.

**Note on `npm test`:** this sandbox's `npm test` already fails ~59-61 of ~159-161
tests on `master`/pre-task, entirely in `*.component.spec.ts` files that use
`templateUrl` (both ones this task didn't touch, e.g. `sf-rename-asset-dialog`,
`sf-create-asset-dialog`, `sf-diff`, `sf-empty-state`, `project-settings-url-registry`,
and ones added for `M15.5.2`) — every one fails identically with `Component '...' is
not resolved: ... Did you run and wait for 'resolveComponentResources()'?`, regardless
of whether the spec uses raw `TestBed.createComponent` or `@testing-library/angular`'s
`render()` (confirmed both fail the same way on already-existing specs). This is a
pre-existing environment/tooling issue in this sandbox unrelated to time-travel and
outside this task's scope to fix. Specs with no `templateUrl` component under test
(this interceptor's spec, service specs) are unaffected and pass.

## Out of scope

- Disabling individual editor UI controls (buttons, form fields) — `M15.5.2`. This task
  is the network-layer backstop only; task 2 is the UX layer on top of it.

## Notes / hazards

- This backstop must not interfere with the page editor's own existing `readOnly`
  handling, `PageAutosaveService`'s conflict flow, or the revision-diff/restore actions
  that are *supposed* to work while looking at history from the settings/revisions
  route (`revision-diff.component.ts`'s `restoreAsset`/`confirmRollback` — these are
  explicit, deliberate mutations the user makes *about* a past revision, issued from
  the revisions list/diff view, which is reached via `settings/revisions/{id}`, not
  from inside "time travel mode" as `TimeTravelStore` defines it; confirm the two
  are actually distinct in the running app before assuming restore needs an
  exemption — if they turn out to be the same state, carve out an explicit exemption
  for `POST /assets/{uuid}/restore` and `POST /projects/{p}/restore` rather than
  silently breaking restore-from-a-past-revision).
- Keep the interceptor's project-scoping logic minimal and reuse existing precedent
  (`etag.interceptor.ts`/`error.interceptor.ts` already have to recognize project API
  URLs) rather than inventing a third URL-matching scheme.
