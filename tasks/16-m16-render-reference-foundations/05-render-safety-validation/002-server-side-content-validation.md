---
id: M16.5.2
status: done
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

- [x] API test: saving a page with a number editor holding `"abc"` → 422 with path `content.<editor>`.
      Saving with a required text editor empty → 200 and `issues` contains the required finding.
- [x] Adding a section whose template isn't in the body's `allow` list → 422. Moving a section into
      such a body → 422.
- [x] A catalog card nested two levels deep with a structural error → 422 with a nested path.
- [x] Generation test: a page with an empty required editor fails with `SF-GEN-0120`, the run is
      PARTIAL, and other pages are written.
- [x] Existing page and section API tests still pass. Any fixture that relied on invalid content is
      fixed, with each such fixture listed in the PR.
- [x] The UI build is green after the schema regeneration. The page editor shows no errors for the
      new advisory `issues` field; displaying them is optional polish.
- [x] `./gradlew build` green.

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

### Implementation notes

- **Classification:** `ContentIssue` gained a `kind` component (`STRUCTURAL` | `COMPLETENESS`), derived
  from the code by the 4-arg constructor. Structural codes: `type`, `option`, `allow`, `template`
  (catalog card template not found). Everything else (`required`, `min`, `max`, `maxLength`,
  `maxChars`, `pattern`, `mimeType`, `visibleWhen`) is completeness.
- **`ContentValidator` hardening:** a non-object list item is a `type` issue. `media`/`reference`
  need a UUID `uuid`; `link` needs a known `kind` and string/UUID members; `richtext` needs string
  `format`/`value`. The form engine's placeholders for untouched object editors
  (`{type:"MEDIA_REF",uuid:null}`, `{kind:"INTERNAL",uuid:null,…}`, `{format:"html",value:""}`,
  `{type:"CATALOG",cards:[]}`) count as *empty*, so autosave never 422s on them and `required` now
  fires for them. A new overload takes a `SectionTemplateLookup` and a path prefix. Catalog cards are
  then checked against the editor's `allow` list and validated recursively against their own
  template.
- **`PageContentValidator`** (pure, `asset.content`) validates page content, body cardinality
  (`min`/`max` → completeness), body `allow` lists and section content. Paths look like
  `content.x` and `bodies.main[2].content.cards.cards[0].content.y`. Sections in undeclared
  (orphaned) bodies get no allow check; their content is still validated.
- **Save (`PageContentValidation`, `asset.page`):** a live-template lookup plus `422 SF-API-0422`
  with `issues` (structural only), built by the new `ProblemFactory.unprocessableEntity(detail,
  name, findings)`. Legacy strategy is subtree-only: `PUT` checks the whole page;
  `PATCH …/content` checks `content` if patched and every section of each patched body; add and move
  (same page and cross page) check only the inserted section, including the target body's `allow`
  list. Reorder and delete change no content and aren't validated. **There is no server-side
  "copy section" operation** (the UI has none either), so there was nothing to enforce for copy.
  Page duplicate copies stored content as-is.
- **`issues` on the view:** `PageController.toPage` fills `PageView.issues` for every page response
  (GET, create and all mutations) through `PageService.contentIssues`. It lists all findings on the
  whole page, each with its `kind`, so legacy structural findings outside the edited subtree show up
  too. The UI ignores the field for now. `schema.d.ts` was regenerated. Only the `ContentIssue` and
  `PageView.issues` hunks were kept; springdoc reordered unrelated `first`/`last`/`paged`
  properties, and those hunks were dropped to keep the shared file's diff minimal.
- **Definitions:** `TemplateContentDefinitions.of(templatePayload)` compiles the CDL. It is the single
  seam to switch to `CompiledTemplateCache` (M16.1.1). Save memoizes per validation; generation
  memoizes per pass (page templates by UUID, section templates by ref).
- **Publish:** `RenderPipeline.incompletePages(snapshot, plan)` returns one `SF-GEN-0120` per page
  with ERROR completeness findings, listing `path (message)`. Code confirmed free: existing codes
  are 0110, 0202–0206, 0210, 0220, 0301, 0410, 0411 and 0500–0503. `execute` removes those pages'
  entries before rendering and returns the diagnostics in the new `RenderOutcome.pageErrors`.
  `GenerationService` marks the run PARTIAL with `errorCount` and `diagnostics.errors`.
  **Deviations from the task text:**
  - The check runs inside `execute` rather than `validate()`, because `validate()`'s return
    contract is run-aborting errors.
  - Render failures today actually fail the whole run (FAILED), so "matching how render failures
    behave" isn't literally true. Only `SF-GEN-0120` is per-page PARTIAL.
  - Structural findings don't block publish. They were rendering before this task, and blocking
    them there is left to save-time validation.
  - Collision detection still sees the full plan, and the sitemap still lists held-back pages (the
    same as missing-channel skips today).
- **Fixtures:** no existing test fixture relied on invalid content. The full suite passed unchanged.
- **Hazard found (pre-existing, not fixed):** the Angular form engine stores `group "…" {}` children
  nested under the synthetic `_group_N` key. `docs/editors/group.md`, the renderer and
  `ContentValidator` all expect them at top level. A required editor inside a group edited through
  the UI therefore reports `required` and blocks publish with `SF-GEN-0120`. It already rendered
  empty before this task. Needs a UI fix (flatten group values).
- Docs: `docs/editors/README.md` has a new "When content is validated" section. The per-editor
  "enforced on save" wording now reads "blocks publish when violated".
