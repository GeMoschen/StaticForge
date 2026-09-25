---
id: M27.2.3
status: todo
depends: [M27.2.1]
epic: m27-release-and-scheduling
feature: released-rendering
area: backend
---

# M27.2.3 — Preview: draft view by default, published view, share links carry the view

## Context

`sf-domain/.../preview/PageRenderService.java` (`doRender` `:264-281`, `templateAt` `:430`),
`LiveAssetValueResolver.java` (`:112-130`), `asset/navigation/LiveNavigationLookup.java` (always current, `:31-54`),
`PreviewTokenService.java` (claims, `issueShareToken` `:57-67`, `issueMediaShareToken` `:80`),
`sf-api/.../api/PreviewController.java` (`/pages/{uuid}` `:69`, `/share` `:86`, public `/share` `:108`), processed
text media preview (M18), section preview (`POST /preview/section`). `M27.2.1`. Epic decisions 16, 17.

## Goals

- **View parameter.** `GET /preview/pages/{uuid}?view=draft|published` (default `draft`), combinable with `revision`,
  `channel`, `locale`, `page`. `draft` = the page's version at R (current when no revision) with every dependency's
  draft (today's behaviour); `published` = the released view at R for the locale.
- **One path.** `PageRenderService` resolves through the same view abstraction as generation (a `PreviewAssetSource`
  or the snapshot with a view) instead of three live readers; `LiveNavigationLookup` and `LiveAssetValueResolver` take
  the view (draft = current/at R, published = released at R). Fix the existing inconsistency that navigation in a
  revision preview is always current: navigation follows the preview's revision in both views.
- **Published view of an unreleased page** (`NEW` / `UNPUBLISHED` in that locale): `404` with problem
  `SF-DOM-0155` "Not published in this locale" (the UI shows "not published" instead of the frame).
- **Response headers** `X-SF-View: draft|published` and, for draft, `X-SF-Release-Status` of the page for the locale.
- **Share links.** `POST /preview/pages/{uuid}/share` takes `view` (default `draft`); the token carries a `view` claim;
  tokens without the claim (issued before M27) mean `draft`. Media share links (preview's media URLs) carry the view
  of the page preview that produced them, so a published preview shows released media files.
- **Preview link rewriting** (`$CMS_REF` → preview URLs) keeps the view parameter so navigating inside the frame stays
  in the same view.
- **Section preview** stays draft-only (it renders a single section instance being edited).
- Regenerate OpenAPI and `schema.d.ts`.

## Acceptance criteria

- [ ] Draft view shows an unreleased edit; published view shows the released text; the same for a record value used
      on the page and for a changed global set.
- [ ] Published view of a `NEW` page → `404 SF-DOM-0155`; draft view of it renders.
- [ ] Published view per locale: EN released v2 and DE v1 → each locale shows its own version.
- [ ] Revision preview: navigation reflects the preview revision (regression test for the old "always current" bug).
- [ ] A share link issued with `view=published` keeps rendering the released state after a new draft is saved; an old
      token without `view` still renders the draft.
- [ ] Links inside the preview keep `view`.
- [ ] `./gradlew build` green.

## Out of scope

- The preview toggle and share dialog UI (`M27.6.3`).

## Notes / hazards

- The preview renders "the page as of its last autosave" (§19.2) — unchanged for the draft view.
- Preview is `VIEWER`: the published view leaks nothing new (released content is by definition public-to-be).
