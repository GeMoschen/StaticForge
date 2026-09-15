---
id: M24.4.2
status: todo
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

- [ ] API test: page with 4 localizable fields, 3 translated to `en` → `{en, missing:1,
      total:4}`; `de` default → `missing:0`.
- [ ] Section instance fields count toward the hosting page.
- [ ] Pages list filter "missing in en" returns only incomplete pages.
- [ ] Orphaned locale values listed after removing a locale in settings.
- [ ] Non-localized project: endpoint returns empty status; no indicators rendered.
- [ ] `./gradlew :server:sf-domain:test :server:sf-api:test` and `npm run build` green.

## Out of scope

- A dedicated translation dashboard/workflow (feature idea #15 was not selected).
- Tracking *outdated* translations (default value changed after translation).

## Notes / hazards

- Keep the "missing" definition identical between backend and UI — the UI marker must use
  the backend status or the same shared helper, not a second rule set.
