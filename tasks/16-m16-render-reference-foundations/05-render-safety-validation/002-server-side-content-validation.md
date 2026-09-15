---
id: M16.5.2
status: todo
depends: []
epic: m16-render-reference-foundations
feature: render-safety-validation
area: backend
---

# M16.5.2 — Server-side `ContentValidator` on save (structural) and on publish (completeness)

## Context

`server/sf-domain/src/main/java/com/acme/staticforge/asset/content/ContentValidator.java`:
- Pure. It validates a content object against a `ContentDefinition` and honors `visibleWhen`.
- Returns `List<ContentIssue(path, code, severity, message)>`.
- Its Javadoc says: "The caller decides when ERROR findings must block a publish as opposed to a save."
- It has no caller in main code.

`PageServiceImpl` (`asset/page/PageServiceImpl.java`) calls `validatePagePayload(payload, projectId)`
(~l.232) from update and every body/section operation (~l.79–183). That check only verifies that
template refs resolve to the right template type. §10.5 says:
- Required editors must be non-empty **for publish**, not for save.
- Save always succeeds if structurally valid.
- Section `templateRef` must be in the body's `allow` list (§14.6).

The UI autosaves (`PageAutosaveService`), so a half-filled form must still save.

## Goals

- Classify `ContentIssue` codes as **structural** or **completeness**, either via a `kind` field or a
  static code set:
  - Structural: wrong JSON type for the editor type, a value outside `options`, a malformed
    `ASSET_REF` / `link` / `MEDIA_REF` / `CATALOG` shape, a list item that isn't an object, a catalog
    card template not in `allow`.
  - Completeness: `required`, `min` / `max` counts, `maxLength` / `maxChars`, `pattern`.
- On save (`PageServiceImpl` update and body/section/catalog operations):
  - Validate page `content` against the page template's compiled definition, and each section
    instance's `content` against its section template's definition, recursing into catalog cards.
  - Reject **structural** issues with 422 `SF-API-0422` (`ProblemFactory`'s validation problem, the
    same shape `TemplateServiceImpl` ~l.317 uses for CDL/OCTL diagnostics), listing issues with full
    paths (`bodies.main[2].content.links[0].target`).
  - Return completeness issues on the save response as advisory data. Add an `issues` field to the
    view DTO and regenerate the OpenAPI schema.
- Enforce the body `allow` list (`BodyDefinition.allow`) in section add, move and copy.
- On publish: in `RenderPipeline.validate` (generation VALIDATE stage), run completeness validation
  per planned page. ERROR-severity issues fail that page's entries with a new
  `SF-GEN-0120 "Content incomplete"` (listing paths) in `GenerationDiagnosticCodes`. Other pages
  still render (PARTIAL), matching how render failures behave today.
- Get definitions from the `M16.1.1` cache when available. Otherwise compile via the existing CDL path.

## Acceptance criteria

- [ ] API test: saving a page with a number editor holding `"abc"` → 422 with path `content.<editor>`.
      Saving with a required text editor empty → 200 and `issues` contains the required finding.
- [ ] Adding a section whose template isn't in the body's `allow` list → 422. Moving a section into
      such a body → 422.
- [ ] A catalog card nested two levels deep with a structural error → 422 with a nested path.
- [ ] Generation test: a page with an empty required editor fails with `SF-GEN-0120`, the run is
      PARTIAL, and other pages are written.
- [ ] Existing page and section API tests still pass. Any fixture that relied on invalid content is
      fixed, with each such fixture listed in the PR.
- [ ] The UI build is green after the schema regeneration. The page editor shows no errors for the
      new advisory `issues` field; displaying them is optional polish.
- [ ] `./gradlew build` green.

## Out of scope

- Validating globals and records (`M17.1.2`, `M19.1.2` reuse this classification).
- UI display of completeness issues beyond keeping the build green.
- Validating template `defaultValue`s against their own editor (CDL compiler territory).

## Notes / hazards

- `visibleWhen`-hidden fields are skipped by `ContentValidator`. Keep that on save as well, so a
  hidden required field never blocks.
- Legacy content saved before this task may be structurally invalid. Saves that don't touch the
  invalid part would then start failing. Recommended: validate only the subtree an operation changes
  (for section operations, that section's content); for full-page updates, validate everything. Or
  ship a one-off report query listing projects with invalid content before enabling it. Pick one and
  document it.
- `SF-GEN-0120` must not collide with existing codes. `GenerationDiagnosticCodes` currently has
  `0110`, `0210`, `0410`, `0411` and `0500`; confirm before assigning.
