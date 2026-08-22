---
id: M2.3.3
status: done
depends: [M2.3.2]
epic: m2-templates-rendering
feature: octl
area: backend
---

# M2.3.3 — OCTL compiler & reference resolution

## Context

Third stage of §16.10: resolve references to UUIDs at compile time and produce the
immutable `CompiledTemplate`, recording `asset_reference` edges (§16.4).

## Goals

- Implement `OctlCompiler` resolving `assetType:uid` references to asset UUIDs at
  compile time (stored in `CompiledTemplate`), recording `OCTL_VALUE`/`OCTL_REF`/
  `OCTL_INCLUDE`/`NAV` kind edges in `asset_reference`.
- Unresolvable UID → compile error `SF-TPL-0110` (§16.4); soft-deleted target → deferred
  to build warning `SF-GEN-0220`.
- Produce immutable `CompiledTemplate` with a stable content hash.

## Acceptance criteria

- [ ] A `$CMS_REF(page:home)$` compiles to the home page's UUID and records the edge.
- [ ] Unknown UID yields `SF-TPL-0110`; the compiled template stores UUIDs, not UIDs.

## Out of scope

- Rendering (feature 4). `$CMS_BODY`/`$CMS_NAV` scope checks need template-body context
      (feature 6 cross-checks).

## Notes / hazards

- The source still shows UIDs — UID rename must warn about literal UID use (§6.4).
