---
id: M5.3.1
status: done
depends: [M5.1.1]
epic: m5-channels-navigation
feature: structure-navigation
area: backend
---

# M5.3.1 — Structure asset domain & source grammar

## Context

Implement the §17.1 structure asset: declarative source + per-channel renderers, plus the
three `kind` values (§17.3).

## Goals

- Model the `structure` asset with `kind` ∈ {navigation, breadcrumb, list}, a `source`
  block (`root`, `depth`, `include`/`exclude` predicates, `order by`, `expand`), and
  `channelTemplates` like other templates.
- Parse/validate the source grammar (root page/folder ref, depth, include/exclude over
  `nav.*`/metadata, order, expand all|activePathOnly|none).
- Model the `node` projection (`label`, `href`, `active`, `trail`, `children`, `page`).

## Acceptance criteria

- [ ] A structure asset parses the §17.1 source grammar and stores it.
- [ ] `kind` discriminates navigation vs breadcrumb vs list.

## Out of scope

- Computation (next task), rendering (after).

## Notes / hazards

- Structures share the source/order/filter grammar across kinds (§17.3).
