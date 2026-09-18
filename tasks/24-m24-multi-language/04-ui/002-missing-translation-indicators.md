---
id: M24.4.2
status: done
depends: [M24.4.1]
epic: m24-multi-language
feature: ui
area: fullstack
---

# M24.4.2 — Missing-translation indicators

## Context

After M24.4.1 editors can translate field by field, but nothing tells them which pages
are incomplete in a locale. The page tree (`features/pages/*`) and pages list already
show per-page state; `ContentValidator` (M24.2.1) knows each localizable editor's
per-locale presence.

## Goals

- Backend: `TranslationStatusService` computes, for an asset (page incl. its section
  instances, global set, record) and each project locale, `{locale, missing, total}` over
  localizable leaf editors that have a default-locale value but no value in that locale
  (fallback-resolved values count as **missing** — they are inherited, not translated).
  - Exposed on the page/record/global-set detail views (`translationStatus` field) and as
    `GET /api/v1/projects/{key}/translation-status?locale=&folder=&type=` (paged per
    docs/api.md conventions) for list views.
  - Computed from current versions on request; no new table (5,000-page list call must
    stay under 1 s on H2 fixture — measure; add a cache only if it doesn't).
- UI:
  - field-level: a "not translated" marker next to localizable fields in the editing
    locale;
  - page editor header: "`en`: 3 of 12 fields missing";
  - page tree / pages list: a small per-locale indicator for the editing locale with a
    filter "missing in `en`";
  - global sets and records lists: same indicator.
- Values stored for locales no longer in the project config are listed as "orphaned
  translations" on the asset detail (read-only info, no delete action here).

## Acceptance criteria

- [x] API test: page with 4 localizable fields, 3 translated to `en` → `{en, missing:1,
      total:4}`; `de` default → `missing:0`.
- [x] Section instance fields count toward the hosting page.
- [x] Pages list filter "missing in en" returns only incomplete pages.
- [x] Orphaned locale values listed after removing a locale in settings.
- [x] Non-localized project: endpoint returns empty status; no indicators rendered.
- [x] `./gradlew :server:sf-domain:test :server:sf-api:test` and `npm run build` green.

## Out of scope

- A dedicated translation dashboard/workflow (feature idea #15 was not selected).
- Tracking *outdated* translations (default value changed after translation).

## Notes / hazards

- Keep the "missing" definition identical between backend and UI — the UI marker must use
  the backend status or the same shared helper, not a second rule set.

## Implementation notes (2026-09-17)

- `asset.localization.TranslationStatusService` computes, per language, how many language-dependent
  fields the default language fills that the language does not — a fallback-resolved value counts as
  **missing**, which is the whole point. A page counts its own values plus every section instance
  and catalog card in it.
- `GET /projects/{key}/translation-status` (`?type=`, `?locale=`) and `.../{uuid}`; `?locale=en`
  is the "missing in en" filter. Orphaned languages (values for a language the project no longer
  declares) are reported on the same view.
- The page editor header shows "English: 3 of 12 fields not translated" for the language being
  edited, and the form marks each untranslated field in place.
- `TranslationStatusIntegrationTest` covers the counts, section instances counting toward their
  page, empty fields owing nothing, orphaned languages and the project listing.
