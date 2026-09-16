# M20 — Template inheritance

**Spec:** Extends §13 (page templates), §14.6 (bodies), §16.2 (OCTL instructions),
§16.9 (grammar), §16.11 (diagnostics) and §18.1 (incremental scope). This epic is not part of the
original §27 roadmap. Like `M8`–`M15`, it is inserted after the foundations epic (`M16`).

## Goal

Today each page template carries its whole HTML skeleton (`<html>`, `<head>`, header, footer,
navigation). A project with five page templates copies that skeleton five times, and each change to
the site chrome means editing every copy. `$CMS_INCLUDE` only partly helps: it can pull in
**section** templates (`GenerationRenderer.blockResolver(...).renderInclude` →
`resolveByUid(AssetType.SECTION_TEMPLATE, …)`), but it cannot express "this page is the base layout
with these regions replaced".

This epic adds layout inheritance for **page templates only**:

- A page template can be marked **`abstract`**. An abstract template is a layout: pages cannot be
  assigned to it, and it never appears in page-creation pickers.
- A child page template's channel source starts with `$CMS_EXTENDS(page_template:base)$` and
  replaces named regions with `$CMS_BLOCK(name)$ … $CMS_END_BLOCK$`. Inside an override,
  `$CMS_PARENT$` renders the next ancestor's content for that block.
- A parent's own `$CMS_BLOCK(name)$ … $CMS_END_BLOCK$` defines the block's default content.
- Inheritance is **multi-level** (base → section-layout → article). The depth is capped, and cycles
  are compile errors.
- A child **inherits its ancestors' CDL editors and bodies**. Its *effective* content definition is
  the union along the chain. A child editor or body whose name collides with an inherited one is an
  error.

## Exit criteria (epic is done when)

- [x] `$CMS_EXTENDS`, `$CMS_BLOCK`/`$CMS_END_BLOCK` and `$CMS_PARENT` lex, parse and compile, with a
      catalogued diagnostic for every misuse: extends not first or repeated, content outside blocks
      in an extending template, duplicate block names, `$CMS_PARENT` outside a block, a cycle,
      depth over the cap, a non-page-template parent, or a parent missing the channel.
- [x] A three-level chain (abstract `base` → abstract `docs_layout` → `article`) renders correctly
      in **generation and preview** for HTML and Markdown. Golden-file cases cover default blocks,
      overrides, `$CMS_PARENT$` at every level, and nested blocks.
- [x] Pages cannot be created with, or switched to, an abstract template (422). A template that is
      in use by pages cannot be marked abstract (422 naming the usage count).
- [x] A child's effective content definition (editors + bodies inherited along the chain) drives the
      page editor form, server-side content validation (`M16.5.2`) and `$CMS_BODY`/editor-name
      checks in OCTL compilation.
- [x] Changing a parent template:
      - (a) is rejected with 422 listing the broken descendants if it would break one (e.g. a new
        parent editor collides with a child editor name);
      - (b) runs a `renamedFrom` page-content migration on the pages of **every descendant** in one
        compound revision;
      - (c) causes an incremental build to re-render every page of every descendant.
- [x] `asset_reference` holds a `TEMPLATE` edge child → parent, so usages of an abstract template
      list its children, and export of a child pulls its ancestor chain in implicitly (M11
      provenance).
- [x] The template IDE shows the abstract toggle, the parent chain and the inherited (read-only)
      editors, and shows OCTL diagnostics live per channel from a context-aware validate endpoint.
- [x] `./gradlew build` and `ui` `npm run build` + `npm test` are green (with the known
      `templateUrl` spec-runner caveat noted in `M15`).

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [language](01-language/README.md) | backend | — (M20.1.2 also depends on `M16.1.1` for cache-key design) |
| 2 | [domain](02-domain/README.md) | backend | 1; `M16.3.2`, `M16.3.3`, `M16.5.2` |
| 3 | [rendering](03-rendering/README.md) | backend | 1, 2; `M16.1.1` |
| 4 | [ui](04-ui/README.md) | frontend | 2, 3 |
| 5 | [docs-e2e](05-docs-e2e/README.md) | qa | 1–4 |

## Dependencies

- `M16:compile-cache` (`M16.1.1`): a compiled child template depends on every source in its chain,
  so the cache key must cover the chain, not only the child.
- `M16:reference-materialization` (`M16.3.2`, `M16.3.3`): template references are written on
  template save and read revision-aware. The child → parent `TEMPLATE` edge builds on that write
  path.
- `M16:render-safety-validation` (`M16.5.1` include cycle guard, `M16.5.2` server-side
  `ContentValidator`): inheritance reuses the cycle-guard approach and must validate against the
  *effective* definition.
- `M15` compound revisions (`RevisionService.beginBatch`/`allocateOrJoin`): the descendant-wide
  `renamedFrom` migration.
- `M13` template store folders (`page_templates` fixed folder, `FolderScope.templateKindFromPayload`).

## Notes

- **Parent is declared in OCTL, recorded on the template.** `$CMS_EXTENDS(page_template:uid)$` sits in
  each channel source, as decided. But CDL inheritance needs **one** parent per template, independent
  of channel, so on save `TemplateServiceImpl` derives `payload.parentTemplateRef` (UUID) from the
  channel sources. Every channel source that extends must name the same parent (error otherwise). A
  channel source that doesn't extend is a standalone render for that channel but still inherits the
  CDL. Treat `parentTemplateRef` as derived data. It is never edited directly.
- **Effective definition is computed, not copied.** Descendants keep only their *own* CDL in
  `contentDefinition`/`compiledDefinition`. The effective definition is computed from the chain at
  read/render time, against the same snapshot/revision. Denormalizing it into every descendant would
  turn a parent edit into N descendant writes and noisy revisions. It would also make time travel
  depend on when the cascade ran. The only cascade *writes* are the page `renamedFrom` migrations
  (M20.2.2), which already exist today for a single template.
- **Skeleton discrepancy:** the skeleton line for M20.2.2 says "parent-change cascade validation
  (compound revision)". Validation itself writes nothing. The compound revision applies only to the
  descendant-wide `renamedFrom` page migration.
- The parent may be any page template. `abstract` only controls whether pages may use it, not whether
  it may be extended. Extending a non-abstract template is legal and useful (a "landing page" variant
  of a normal template).
- **Section templates are out of scope** (user decision). `$CMS_EXTENDS` in a section template is a
  compile error.
- **No Monaco in the UI.** `ui/src/app/features/templates/templates.component.html` edits CDL and
  channel OCTL in plain `<textarea>`s, and the UI never calls `POST /octl/validate` today. M20.4.1
  adds diagnostics to the existing textareas. A Monaco/OCTL language mode is not part of this epic.

## Implementation notes (2026-09-16)

Evidence and deviations; the code is the source of truth where they differ from the task files.

- **Diagnostic numbers.** M19 had already taken `SF-TPL-0140`–`0142` and `SF-CDL-0107`/`0108`. M20 uses
  `SF-TPL-0150` extends position, `0151` content outside blocks, `0152` block name (invalid or duplicate), `0153`
  `$CMS_PARENT$` misuse, `0154` cycle, `0155` depth, `0156` extends target / section template, `0157` unknown
  override (warning), `0158` ancestor lacks channel, `0159` channels extend different parents, plus `0160` ancestor
  has compile errors, `0161` parent can't be loaded, `0162` block contains itself, and `SF-CDL-0109` inherited name
  collision. `SF-TPL-0130`/`0131` were already constants. Domain problems: `SF-DOM-0122` template in use can't be
  abstract, `SF-DOM-0123` page on an abstract template, `SF-DOM-0124` descendants would break; `SF-DOM-0120` names
  the children. Import conflict: `PARENT_TEMPLATE_MISSING`.
- **Loaders.** Instead of three loader implementations there is one domain view, `asset.template.TemplateHierarchy`
  (lookup + ancestors + effective definition + chain compile), built live/at a revision by `TemplateHierarchies` and
  over the snapshot by `SnapshotTemplateHierarchy`. `CompiledTemplateCache` records each chain compile's template
  lookups (version keys) and re-checks them on a hit, like reference resolutions.
- **A channel that doesn't extend** still inherits the parent's CDL (`Inheritance.inheritedDefinitions`).
- **Page-template `renamedFrom`.** Before M20 page templates had no content migration at all (only section
  templates did); it was added for the template and all descendants, in the template save's revision.
- **"Pages list filtered by template"** doesn't exist in the UI; the `SF-DOM-0122` notice links each listed page
  (the problem carries `pageUuids`). There is no "change template" picker in the page editor, so only the
  create-page dialog filters abstract templates.
- **Include inside a block** renders through the same `OctlRenderer` state and `RenderBudget` as any other node, so
  the depth/cycle counters are not reset; covered by reasoning, not by a dedicated test.

**Verification.** `./gradlew build` (see `tasks/todo.md` review); new tests: `OctlInheritanceSyntaxTest`,
`OctlChainCompileTest`, `InheritanceRenderTest`, five golden cases, `DocsGoldenSnippetsTest` catalogue check,
`TemplateInheritanceIntegrationTest` (13), `TemplateInheritanceRenderIntegrationTest`, `TemplateInheritanceApiTest`
(3); UI `inheritance.util.spec.ts` (10). Component specs were added but can't run here (known `templateUrl` runner
issue). `e2e/m20-journeys.spec.ts` passed against a live dev backend + `ng serve`, including the generated files;
m16–m19 journeys still pass.
