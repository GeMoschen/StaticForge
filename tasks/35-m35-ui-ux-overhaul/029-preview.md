---
id: M35.29
status: todo
depends: [M35.18]
epic: m35-ui-ux-overhaul
feature: extras
area: fullstack
---

# M35.29 — Preview upgrades

## Context

`features/preview/preview-frame.component.*`: Draft/Published toggle, viewport presets 375/768/1280/100%, pagination,
refresh, share link, and click-to-focus a section. It exists only in the page editor. User decision 21.

## Goals

- A preview toolbar built from `sf-toolbar` with:
  - **Channel** picker (all channels of the template)
  - **Language** picker (defaults to the editing language)
  - Draft/Published toggle
  - Viewport presets plus a custom width
  - **Zoom** (fit, 50–150 %)
  - Refresh (`Ctrl+Enter`)
  - **Open in new tab**
  - Share link
- The preview state is persisted in preferences.
- **Record preview:** when a dataset has a record template for a channel, the record editor offers the same preview
  split.
  - Check whether a record preview endpoint exists.
  - If not, add `GET …/records/{uuid}/preview?channel&locale&state`, mirroring the page preview (auth, draft vs
    released, share tokens), with backend tests.
- An incomplete or failing preview shows an explanatory state with the render diagnostics, not a blank frame.

## Acceptance criteria

- [ ] Screen definition of done met for the preview in the page and record editors.
- [ ] Backend tests for the record preview (if added). OpenAPI and `docs/api.md` updated.
- [ ] `./gradlew test`, `npx vitest run` and `npx ng build` green.
