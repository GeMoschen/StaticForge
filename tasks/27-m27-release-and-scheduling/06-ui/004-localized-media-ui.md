---
id: M27.6.4
status: done
depends: [M27.3.1, M27.6.1]
epic: m27-release-and-scheduling
feature: ui
area: frontend
---

# M27.6.4 — Localized media UI: toggle, per-locale files, discard confirmation

## Context

`features/media/media-detail-drawer.component.*` (metadata, replace, text editing), `media-library`,
`core/project/editing-locale.store.ts`, `locales.store.ts`, API `PUT /media/{uuid}/localized`,
`POST|DELETE /media/{uuid}/files/{locale}`, `GET|PUT /media/{uuid}/text?locale=`, `409 SF-MEDIA-0505` (`M27.3.1`).
Epic decisions 18, 19.

## Goals

- In a project with locales, the media drawer shows **"Different file per language"** (switch). Turning it on is
  immediate (one revision); turning it off with other locale files shows the server's list in a confirmation
  ("These files will be discarded: EN hero-en.png (1.2 MB) …") and resends with `confirmDiscard`.
- For localized media, a **Files** section lists every configured locale: own file (thumbnail, name, size, Replace,
  Remove) or "Uses {fallback locale}'s file" with Upload. Drag & drop onto a locale row uploads for that locale.
- Text media: the text editor gets a locale selector for localized text media.
- The library grid thumbnail shows the editing locale's resolved file; a small "localized" marker on localized media.
- Media pickers (media editor, link dialog) keep selecting the asset (not a locale file) — show the editing locale's
  thumbnail.

## Acceptance criteria

- [x] Vitest: toggle off with other files shows the list and resends with `confirmDiscard`; fallback rows labelled
      correctly (fixtures from real responses).
- [x] Manual check: upload an EN file, switch editing locale → thumbnail follows; release EN → badge per locale.
- [x] Hidden in projects without locales.
- [x] `npm run build` and `npx vitest run` green.

## Out of scope

- Per-locale variant policies.

## Notes / hazards

- Uploads reuse the existing upload component and its error handling (413/415 messages).
