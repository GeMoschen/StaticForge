# Feature: Archived projects — read-only and hidden

**Spec:** Extends §8.1 (`archived`), §8.4 (404 for inaccessible projects), §18 (generation), §19.3 (share links).

## Goal

Make archiving meaningful: an archived project is invisible to non-admin members, read-only for everyone, and
reversible by an instance admin.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-archived-projects-read-only.md](001-archived-projects-read-only.md) | `M26.1.1` |

## Feature exit criteria

- [ ] Non-admin members get `404` for every endpoint of an archived project on their next request.
- [ ] Every mutating endpoint rejects writes with `409 SF-DOM-0130` (endpoint walk test).
- [ ] Share links stop working; generation can't start; unarchive restores everything.

## Dependencies

`M26.1.1` (epoch bump helper).
