# Feature: API — record set endpoints, record create by set, dataset record templates

**Spec:** Extends §20.2 (REST), §20.4 (OpenAPI → `schema.d.ts`).

## Goal

Expose record sets over REST, switch record creation to "add to a set", and carry dataset record
templates through the dataset endpoints.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-record-set-controller-and-dto-changes.md](001-record-set-controller-and-dto-changes.md) | `M25.1.1`, `M25.1.2`, `M25.2.1` |

## Feature exit criteria

- [ ] `RecordSetController` CRUD + record listing per set; record create by set; dataset DTOs with
      `channelTemplates`; OpenAPI + `ui/src/app/api/schema.d.ts` regenerated.

## Dependencies

`M25.1.*`, `M25.2.1`, `M19.2.1` (dataset/record controllers — the pattern to follow).
