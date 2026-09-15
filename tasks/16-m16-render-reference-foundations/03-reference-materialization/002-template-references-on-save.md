---
id: M16.3.2
status: todo
depends: [M16.3.1]
epic: m16-render-reference-foundations
feature: reference-materialization
area: backend
---

# M16.3.2 — Template OCTL references written on template save

## Context

`TemplateServiceImpl.compileChannel` (~l.214) compiles every channel source on save and throws
422 `SF-API-0422` on errors. Its `referenceResolver` (the `nav` prefix maps to FOLDER with a scope
check) resolves each `assetType:uid` to a UUID, and the result is in `CompiledTemplate.references()`.
Nothing persists those references, so a changed target is only connected to pages through
generation's render-dependency rows (`GenerationService.materializeReferences`, kind `OCTL_REF`,
empty `source_path`). `ReferenceKind` already defines `OCTL_VALUE`, `OCTL_REF` and `OCTL_INCLUDE`,
but none of them is ever written.

## Goals

- When a template version is written (`TemplateServiceImpl` create, update, `saveChannel`, rename
  cascade), call `ReferenceMaterializer` with the template's outgoing edges derived from **all**
  channel sources of the new version:
  - `$CMS_INCLUDE(section_template:x)$` → `OCTL_INCLUDE`
  - `$CMS_VALUE(type:uid…)$`, `$CMS_IF`/`$CMS_FOR`/`$CMS_SET` accessors on an asset → `OCTL_VALUE`
  - `$CMS_REF(type:uid)$`, `$CMS_NAVIGATION(nav:uid)$`, `$CMS_FOR(x : nav:uid)$` → `OCTL_REF`
  - `source_path`: `channelTemplates.<channel>`, so usages can say which channel uses the target.
- This needs the compiler to report the **instruction kind** per reference, not only
  `referenceKey → UUID`. Extend `CompiledTemplate` with a per-reference kind (e.g.
  `Map<String, ReferenceUse>` or a list of `(key, uuid, use)`), where `use ∈ {VALUE, REF, INCLUDE}`
  is defined in sf-template. Map it to `ReferenceKind` in sf-domain. Keep `references()` for existing
  callers.
- Merge these edges with the template's own non-OCTL edges (none today) into one `replaceOutgoing`
  call, so a template version has a single consistent edge set.

## Acceptance criteria

- [ ] Saving a page template whose html channel has `$CMS_INCLUDE(section_template:teaser)$` and
      whose markdown channel has `$CMS_REF(page:about)$` → open rows `OCTL_INCLUDE` → teaser and
      `OCTL_REF` → about, each with its channel in `source_path`.
- [ ] Removing the include in a later save closes that row at the new revision.
- [ ] A `nav:root` navigation reference writes an `OCTL_REF` row to `navigation_root` (the alias from
      `FolderScope.navigationReferenceUid`).
- [ ] Compiler unit test: the reference kinds are reported correctly for every instruction type,
      including references inside `$CMS_IF` conditions and `$CMS_FOR` sources.
- [ ] The template UID-rename cascade (`M15.2.2`) writes edges for the renamed template and for
      every rewritten page in the one compound revision.
- [ ] `./gradlew :server:sf-template:test :server:sf-domain:test` green.

## Out of scope

- Removing generation's render-dependency inserts (`M16.3.3`).
- Child → parent template edges for inheritance (`M20.2.2`, which adds them through this same path).
- Processed text media OCTL edges (`M18.2.1`, which reuses this path).

## Notes / hazards

- **UID literal references.** `UidChangeResult.affectedTemplates` scans template sources for literal
  UIDs. With persisted `OCTL_*` rows, a UID rename could use the reference table instead. Leave
  `findUidLiteralReferences` as it is here; just note the opportunity in the PR.
- Section templates rendered via a page's `bodies` are already connected by `TEMPLATE` rows from
  `M16.3.1`. Don't duplicate those edges from OCTL.
