---
id: M18.2.1
status: todo
depends: [M18.1.2, M16.3.1]
epic: m18-parsable-text-media
feature: compile-on-save
area: backend
---

# M18.2.1 — OCTL validation + reference materialization for processed media

## Context

`OctlCompiler.compile(source, channelKey, ReferenceResolver, ContentDefinition)` already
supports a `null` ContentDefinition, which skips the editor-name checks. With no content
definition, `$CMS_BODY` is always `OCTL_BODY_IN_SECTION`. Template save resolves `assetType:uid`
through `TemplateServiceImpl.referenceResolver`. That resolver is duplicated as `assetTypeForRef`
in `GenerationRenderer` and `PageRenderService`, and maps `nav` to FOLDER with a navigation-scope
check. `OctlCompiler` returns `OctlResult(template, diagnostics)`, and `CompiledTemplate.references()`
lists the resolved reference UUIDs. After `M16.3.1`, saving an asset writes its outgoing
`asset_reference` rows in the same revision and closes the superseded ones.

## Goals

- A single `TextMediaCompiler` (name open), placed in `sf-domain` next to the media service so
  both generation (`sf-generate`) and preview (`sf-domain`) can reuse it. It compiles processed
  media source with:
  - The project's **default channel** key (see the epic Notes for why media renders once).
  - The shared project reference resolver. Reuse or extract the one `TemplateServiceImpl`
    uses; don't add a fourth copy of `assetTypeForRef`.
  - A **text-media instruction policy**: `$CMS_BODY`, `$CMS_INCLUDE` and the leaf/HTML form
    of `$CMS_NAVIGATION` are errors. `$CMS_VALUE`, `$CMS_REF`, `$CMS_IF`, `$CMS_FOR`
    (including `nav:` iteration), `$CMS_SET`, `$CMS_META` and `$CMS_COMMENT` are allowed.
    Enforce this as a compiler option or a post-parse AST walk. Don't fork the parser.
  - New diagnostic constants in `DiagnosticCodes` (take the next free `SF-TPL-*` numbers when
    implementing, and check what `M16`/`M17` have already allocated):
    - **error**: instruction not allowed in text media
    - **warning**: `$$` in the source changes the output (line/col for each occurrence)
    - **warning**: `$CMS_VALUE` without an escaping filter (`js`, `json`, `attr`, `url`,
      `html`, `raw`) in a `application/javascript`/`text/javascript`/`application/json` file
- Hook compilation into every save that changes processed source:
  - `setProcessCms(true)` compiles the current blob. Errors → 422, flag not set.
  - `writeText` while `processCms` is on compiles the new text. Errors → 422, nothing stored.
  - `replace` while the flag stays on compiles the new file. Errors → 422.
  - Switching the flag off does no compile.
  - Successful saves return warnings in the response body next to the media view, using the
    same diagnostics DTO shape the template save and `OctlValidateController` use.
- A non-mutating `POST /media/{uuid}/text/validate` (or a `validate` body on the CDL/OCTL
  validate controllers) takes a draft text and returns diagnostics, so the editor can show
  live errors without saving.
- Reference materialization: in the same revision as the save, write the outgoing rows from
  `CompiledTemplate.references()` for the processed media asset, using the kinds `M16.3.2`
  settles for template OCTL references (`OCTL_VALUE`/`OCTL_REF`/`OCTL_INCLUDE`), through the
  shared `M16.3.*` mechanism. Close all of them when the flag goes off or the asset is
  soft-deleted.

## Acceptance criteria

- [ ] Switching on a CSS file that contains `$CMS_VALUE(global:site.brandColor)$` for a
      non-existent global set returns 422 with `SF-TPL-0110` and leaves the flag off.
- [ ] A text write containing `$CMS_BODY(main)$` or `$CMS_INCLUDE(section_template:x)$`
      returns 422 with the new text-media-policy error.
- [ ] A JS file with `const all = $$('a');` saves successfully with a `$$` warning at the
      right line/column.
- [ ] A JSON file with `"title": "$CMS_VALUE(global:site.title)$"` saves with the
      unescaped-value warning. `"$CMS_VALUE(global:site.title | json)$"` produces no warning.
- [ ] After saving, `GET /assets/{uuid}/usages` on the referenced page/media/global set
      lists the processed media file (verifies the rows were written in the save's revision).
- [ ] Switching the flag off closes the rows, and usages no longer list the file.
- [ ] The validate endpoint returns diagnostics for draft text and creates no revision.
- [ ] Unit tests cover the instruction policy and both warnings. Integration tests cover
      422-with-no-revision and reference rows per revision.

## Out of scope

- Rendering (`M18.3.*`).
- Editor-side syntax highlighting (`M18.4.1` shows diagnostics only).
- Changing how page/section templates are validated.

## Notes / hazards

- **Validation uses the snapshot at save time.** A later rename or deletion of a referenced
  asset breaks processed media the same way it breaks templates. The existing
  `UidChangeResult.affectedTemplates` literal scan (`findUidLiteralReferences`) should include
  processed media sources. Check whether it scans blobs or only payload text: it likely only
  scans template payloads, so extend it or record the gap in this task.
- The `$$` warning must not fire inside `$CMS_COMMENT$` blocks. Implement it against the
  lexer's token stream, not a raw `indexOf`.
- Don't block saves on warnings. The user explicitly chose opt-in over automatic parsing so
  authors stay in control.
