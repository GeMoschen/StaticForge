---
id: M8.2.2
status: todo
depends: [M8.2.1]
epic: m8-navigation-rewrite
feature: url-registry
area: backend
---

# M8.2.2 — URL registry service

## Context

Implements the "assign once, cache forever until reset" contract: given a
`PageReference`, a channel, and an area, return its URL — computing and persisting it
via `OutputPathResolver` only on first access, otherwise returning the stored row
untouched.

## Goals

- `UrlRegistryService.resolve(pageReferenceUuid, channelKey, area, ctx) -> String`:
  - Look up an existing `UrlRegistryEntry`; if present, return `url` as-is (no
    recomputation, no drift-checking against current `OutputPathResolver` output).
  - If absent: resolve the `PageReference` to a concrete page via
    `NavigationService.resolve` (`M8.1.3`), compute the URL via `OutputPathResolver`
    for that page+channel, persist a new entry, return it.
- `UrlRegistryService.override(pageReferenceUuid, channelKey, area, url, ctx)`: manual
  edit — upsert the entry with `overridden = true`. No format validation beyond "valid
  relative or absolute URL" (reuse whatever validator, if any, channels/paths already
  use).
- `UrlRegistryService.reset(projectId, scope, ctx)` where `scope` narrows to a single
  entry, a channel, an area, or the whole project — deletes matching entries. Does
  **not** eagerly recompute; the next `resolve` call repopulates lazily.
- All methods take `RevisionContext` for audit logging purposes only (the registry
  itself is not revisioned per `M8.2.1`'s Notes) — confirm with the M1 revision service
  whether a non-asset audit trail needs a different mechanism than `RevisionContext`,
  and note the answer here.

## Acceptance criteria

- [ ] First `resolve` call for a new tuple computes and persists; a second call returns
      the identical string even if the underlying page's slug/displayName changes in
      between (prove with a test that changes the page then re-resolves).
- [ ] `override` makes subsequent `resolve` calls return the manual value, marked
      `overridden`.
- [ ] `reset` at each scope level (entry/channel/area/project) deletes exactly the
      matching rows and nothing else.
- [ ] `resolve` after a `reset` recomputes fresh (proving the lazy-repopulate
      contract) and clears `overridden`.

## Out of scope

- Wiring into generation/preview render paths (`M8.2.3`), REST exposure (`M8.2.4`).

## Notes / hazards

- Concurrent first-`resolve` for the same tuple (two parallel generation workers)
  must not create duplicate rows — enforce via the unique constraint from `M8.2.1` plus
  a catch-and-reread on constraint violation, not a distributed lock.
