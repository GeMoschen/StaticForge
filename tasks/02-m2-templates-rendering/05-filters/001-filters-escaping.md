---
id: M2.5.1
status: done
depends: [M2.3.3]
epic: m2-templates-rendering
feature: filters
area: backend
---

# M2.5.1 — Filters & escaping semantics

## Context

Implement the §16.3 filter pipeline and the §16.1 "safe by default" escaping.

## Goals

- Implement all built-in filters (left-to-right piping, `filter(a,b)` args).
- Implement escaping: channel `default_escaping` (`HTML`/`MARKDOWN`/`NONE`) applied as
  the final step unless the chain already escapes or uses `raw`.
- Emit `SF-GEN-0301` warning when `raw` is used on a plain-text editor; allow `raw` on
  richtext without warning (§16.3).

## Acceptance criteria

- [ ] The §16.3 filter catalogue behaves correctly (golden cases in feature 7).
- [ ] A `text` value renders HTML-escaped by default in the HTML channel.
- [ ] `raw` on `text` produces `SF-GEN-0301`.

## Out of scope

- `md`/`plain` richtext converters may delegate to a small lib — note the dependency.

## Notes / hazards

- XSS-corpus correctness is validated in feature 7 (`escaping-xss`).
