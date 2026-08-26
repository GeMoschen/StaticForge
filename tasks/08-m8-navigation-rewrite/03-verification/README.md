# Feature: Verification

**Spec:** N/A (cross-cutting QA over the whole M8 rewrite).
**Area:** qa. **Epic:** M8.

## Goal

Prove the epic's exit criteria end-to-end with a golden/integration/e2e suite, the same
role `04-cross-channel` played for M5.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-e2e-navigation-and-urls.md](001-e2e-navigation-and-urls.md) | M8.1, M8.2 |

## Feature exit criteria

- [ ] A single e2e journey covers: build a navigation tree with a folder-targeted
      `PageReference` and a `startNode`-configured folder, render it in a page
      template, generate the project, verify the emitted URLs, edit the target page,
      regenerate, verify URL stability, reset the registry, regenerate again, verify
      reassignment.

## Dependencies

`M8.1`, `M8.2`.
