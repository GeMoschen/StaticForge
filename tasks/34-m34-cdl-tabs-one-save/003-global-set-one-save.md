---
id: M34.3
status: done
depends: [M34.2]
epic: m34-cdl-tabs-one-save
feature: globals
area: backend
---

# M34.3 — Global set: schema and values in one save

## Context

`GlobalSetServiceImpl`, `GlobalsController`. User decision 5.

## Goals

- `PUT /globals/{uuid}/schema` accepts `content`: the values edited against the stored schema are validated and saved
  as `PUT …/content` would (save-scope rules included), then migrated into the new schema — one version, one revision.
- Values alone keep using `PUT …/content` (an `EDITOR` may call it).

## Acceptance criteria

- [x] One request writes schema and values; save findings are returned like the values endpoint's.
