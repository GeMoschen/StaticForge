---
id: M32.4
status: done
depends: [M32.2]
epic: m32-complete-url-registry
feature: preview
area: backend
---

# M32.4 — Preview: every link through the registry, per locale

## Context

`PageRenderService` (`urlResolver`, navigation href ~l. 708, `rewriteLinks`), `LiveOutputPathResolver`,
`ProjectLocales`. Epic decision 6; user decisions 2, 4, 8.

## Goals

- When the preview renders site-relative links (`!rewriteLinks`), every link kind — page, paginated page, media
  (variants), folder, navigation — resolves through the registry in `PREVIEW` for the render **locale** (today the
  locale is dropped and the default language is stored).
- The previewed page's own URL is registered in `PREVIEW` too.
- `computed` comes from `LiveOutputPathResolver` (drafts); derived targets per M32.2.
- A collision falls back to the computed URL and logs it (no preview error).
- Share-token links (`rewriteLinks`) are unchanged.

## Acceptance criteria

- [x] Previewing a German page creates/uses `de` PREVIEW rows; the English preview uses `en` rows; no locale-less rows
      in a localized project.
- [x] A PREVIEW override changes the preview's links; GENERATED rows are untouched (areas independent).
- [x] Media and folder links in preview use the registry.
- [x] `./gradlew build` green.

## Out of scope

- Generation (M32.3), UI (M32.8).

## Notes / hazards

- Preview renders are frequent; use the same per-(channel, locale) preload or a request-scoped cache, never a query per
  link.
