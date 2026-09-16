---
id: M20.2.1
status: todo
depends: [M20.1.2, M16.5.2]
epic: m20-template-inheritance
feature: domain
area: backend
---

# M20.2.1 — `abstract` page templates, derived `parentTemplateRef`, effective content definition

## Context

`server/sf-domain/src/main/java/com/acme/staticforge/asset/template/TemplateServiceImpl.java`:

- It compiles on save: `compileDefinition(source)` and `compileChannel(projectId, source, channelKey, definition)`
  throw 422 `SF-API-0422` with diagnostics.
- `buildPayload` writes `contentDefinition`, `compiledDefinition`, `channelTemplates{ch:{source, compiledHash}}`
  and `category`, plus `deprecated` for section templates, and `bodies[]` and `outputPath{channel: expr}`
  for page templates.
- `saveChannel` compiles one channel against the template's own definition.

`asset/page/PageServiceImpl.validatePagePayload(payload, projectId)` only checks that the page's
`templateRef` and each section's `templateRef` point to the right template kinds. The UI builds page
forms from the template's `compiledDefinition`.

## Goals

- **`abstract`** (boolean, page templates only; default `false`). It lives in the create/update
  commands and the payload.
  - Setting `abstract=true` when any current page has `templateRef` = this template → 422 with the
    page count and the first N page uids. The pages must be moved to another template first.
  - `PageServiceImpl.validatePagePayload` rejects a `templateRef` to an abstract template (create,
    change template, import path) → 422.
  - The template list API exposes `abstract`, so pickers can filter.
- **`parentTemplateRef`** (UUID, derived):
  - On page-template save, compile every channel with the chain-aware compiler (M20.1.2), using a
    **live** `ParentTemplateLoader` over current versions.
  - Every channel source containing `$CMS_EXTENDS` must name the same parent. Otherwise raise a new
    error (proposal `SF-TPL-0149`: "channels extend different parents"). Store the UUID; if no
    channel extends, store `null`.
  - A client can never write `parentTemplateRef` directly.
  - `$CMS_EXTENDS` in a **section** template → 422 with `SF-TPL-0146`.
- **Effective definition** via a domain helper, e.g.
  `EffectiveDefinitionService.effectiveDefinition(projectId, templateUuid, revision?)`:
  - Walks `parentTemplateRef` and unions the own definitions root-first.
  - Uses the same union and collision rules as the compiler (M20.1.2), sharing code, not
    re-implementing it.
  - Applied in these places:
    - The template read API/DTO gains `effectiveDefinition`, plus `inheritedFrom` per editor/body
      (ancestor uid). The page editor form uses it.
    - `ContentValidator` on page save (`M16.5.2`) validates against the effective definition.
    - `compileChannel` on save validates editor names and `$CMS_BODY` against the effective
      definition.
  - The payload's `compiledDefinition` stays the template's **own** definition (see the epic Notes).
    For page templates, `bodies[]` in the payload also stays the own list; effective bodies come
    from the helper.
- Export/import: `abstract` and `parentTemplateRef` round-trip. On import, `parentTemplateRef` is
  re-derived (or its UUID is validated to exist in the archive or target project, with a conflict
  report entry if it doesn't).

## Acceptance criteria

- [ ] Integration tests:
  - [ ] Pages can't be created with an abstract template, or switched to one (422).
  - [ ] A template in use can't be made abstract (422 with the count).
  - [ ] `$CMS_EXTENDS` in a section template is rejected (422 + `SF-TPL-0146`).
  - [ ] Channels extending different parents are rejected (`SF-TPL-0149`).
  - [ ] A child editor colliding with an inherited one is rejected (`SF-CDL-0107`).
- [ ] A child template whose channel source uses an editor that only its parent declares saves
      successfully. The same source on a template without the parent fails with `SF-TPL-0103`, so
      the effective definition is genuinely used.
- [ ] `GET` template returns `abstract`, `parentTemplateRef` and `effectiveDefinition` with
      `inheritedFrom`. The OpenAPI schema and `schema.d.ts` are regenerated.
- [ ] Page save validates content against the effective definition, e.g. a required editor inherited
      from the parent is enforced (per `M16.5.2`'s semantics).
- [ ] Export → import round-trips a three-level chain, with `abstract` flags and parent refs intact
      (extend `ProjectExportImportIntegrationTest`).
- [ ] `./gradlew build` is green.

## Out of scope

- Validating **descendants** when a parent changes, `renamedFrom` cascades, and graph edges:
  M20.2.2.
- Rendering: M20.3.1. UI: M20.4.1.

## Notes / hazards

- **Time travel:** the effective definition must be computed at the *requested revision*, walking
  the parent chain as of that revision. The parent's current version is wrong for a past revision.
  Give the helper a revision parameter from day one.
- **Existing data:** today no template has `abstract` or `parentTemplateRef`. Treat an absent field as
  `false`/`null`; no Liquibase change is needed, since these are payload fields (ADR-0003).
- `TemplateServiceImpl.saveChannel` (single-channel save) must run the same parent-consistency check
  against the other channels' stored sources. Otherwise one channel can quietly point to a different
  parent.
- The protected fixed folders (`page_templates`, `FolderScope.templateKindFromPayload`) are
  unaffected; abstract templates live in the same folder.
