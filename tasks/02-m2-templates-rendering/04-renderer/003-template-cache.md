---
id: M2.4.3
status: done
depends: [M2.4.2]
epic: m2-templates-rendering
feature: renderer
area: backend
---

# M2.4.3 — Compiled-template cache

## Context

Cache `CompiledTemplate`s per §21.5 into Caffeine, invalidated by revision.

## Goals

- Wire the `compiledTemplates` Caffeine cache keyed `(assetUuid, revision, channel)`
  (size 2,000, 30 min idle) and `contentDefinitions` `(assetUuid, revision)`.
- Expose via Spring `CacheManager`; ensure keys carry the revision so content changes
  invalidate naturally (§21.5).

## Acceptance criteria

- [ ] Rebuild at a new revision never serves a stale template.
- [ ] Cache hit/miss metrics available.

## Out of scope

- Other caches (media/navigation are later).

## Notes / hazards

- Explicit invalidation is unnecessary *because* keys include revision — don't add it.
