---
id: M2.7.1
status: done
depends: [M2.4.2]
epic: m2-templates-rendering
feature: render-tests
area: qa
---

# M2.7.1 — Golden-file test harness

## Context

Build the harness of §25.4: each case is `template.octl + content.json + expected.*`,
walked and compared.

## Goals

- Implement a test runner that walks `src/test/resources/render/`, renders each triple,
  and compares normalized output.
- Support per-channel `expected` files and normalization rules (whitespace, line endings).
- Ensure a mismatch fails with a useful diff.

## Acceptance criteria

- [ ] The runner discovers and executes all corpus directories automatically.
- [ ] A new feature directory is picked up with zero test-code changes.

## Out of scope

- Corpus *content* (next task).

## Notes / hazards

- Normalization must be deterministic to avoid spurious diffs.
