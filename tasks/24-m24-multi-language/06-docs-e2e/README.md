# Feature: Docs + E2E verification

**Spec:** §25.6 (critical E2E journeys), §25.4 (golden files), documentation in `docs/`.

## Goal

Document the locale model for template developers, editors and admins, and prove the
whole flow end-to-end: configure locales → mark editors localizable → translate →
preview → generate → verify links, hreflang and incremental narrowing.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-docs-and-journey.md](001-docs-and-journey.md) | M24.1.2, M24.3.3, M24.4.2, M24.5.1 |

## Feature exit criteria

- [ ] Template developer guide, editor docs, user guide and architecture updated.
- [ ] A Playwright journey covers the full multi-language flow, and the non-localized
      regression pass is recorded.

## Dependencies

All earlier M24 features.
