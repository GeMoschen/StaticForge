---
id: M26.2.1
status: todo
depends: [M26.1.1]
epic: m26-user-management
feature: archived-projects
area: backend
---

# M26.2.1 — Archived projects: hidden for members, read-only for everyone, unarchive

## Context

`ProjectServiceImpl.archive`, `ProjectController` (`/archive`, `list`), `JwtServiceImpl` (`projects` claim),
`ProjectAuthorizationService`, `RevisionServiceImpl.allocate/allocateOrJoin`, `GenerationController`,
`PreviewController` + `PreviewTokenService` (share links), `SearchIndexer` (already skips archived projects).
Epic decision 12.

## Goals

- **Hidden.** `JwtServiceImpl` omits archived projects from the `projects` claim; `GET /projects` omits them for
  non-admins (instance admins see them with `archived: true`). Archive and unarchive bump the epoch of every member
  of the project, so the next request of a member resolves the new claim.
- **Read-only.** `RevisionService.allocate` and `allocateOrJoin` throw `409 SF-DOM-0130` ("Project is archived")
  for an archived project. Explicit guards for writes that allocate no revision: start/promote generation runs,
  create preview share links, search reindex, and every other endpoint the walk below finds. Rendering a share
  link of an archived project answers `404`.
- **Unarchive.** `POST /projects/{key}/unarchive` (instance admin) — clears the flag, bumps members' epochs; audit
  `PROJECT_UNARCHIVED`. Archive audits `PROJECT_ARCHIVED`. Order the flag flip and any revision allocation so that
  archive and unarchive themselves are not blocked by the guard.
- **Endpoint walk test.** Enumerate every mutating handler (`POST`/`PUT`/`PATCH`/`DELETE`) under
  `/api/v1/projects/{key}/**` from `RequestMappingHandlerMapping`, call each as instance admin against an archived
  fixture project, and expect `409 SF-DOM-0130` (or `404` where the resource lookup comes first). Read-only
  `POST`s (e.g. `/generations/plan`, `…/preview-query`, `/octl/validate`, preview render) are listed in an explicit
  allowlist in the test with a reason each; `unarchive` is the only admitted write.
- Regenerate OpenAPI and `schema.d.ts`.

## Acceptance criteria

- [ ] With a still-valid token, a member's next request to an archived project is `404`; the project is missing from
      their `GET /projects`; after unarchive (and refresh) it is back with their old role.
- [ ] Instance admin: sees the project with `archived: true`, can read everything, every write is `409 SF-DOM-0130`.
- [ ] Endpoint walk test green, allowlist reviewed.
- [ ] Share link issued before archiving → `404` after; generation start → `409`.
- [ ] `./gradlew build` green.

## Out of scope

- UI banner and read-only mode (`M26.4.4`), admin projects list (`M26.3.1`).

## Notes / hazards

- A generation run already queued or running when the project is archived is allowed to finish; only new runs,
  promotes and retries are blocked. Say so in the Javadoc.
- `SearchIndexer` keeps skipping archived projects; after unarchive the startup catch-up or the next commit
  re-indexes — verify a searched asset appears again without a manual reindex, otherwise trigger one on unarchive.
- Background jobs that write (startup runners like `ReferenceBackfillRunner`, `LegacyOutputCleanupRunner`) must not
  fail startup on an archived project: they either skip archived projects or bypass the guard deliberately.
