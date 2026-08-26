---
id: M8.1.4
status: todo
depends: [M8.1.3]
epic: m8-navigation-rewrite
feature: navigation-store
area: backend
---

# M8.1.4 — `navigation` OCTL instruction

## Context

Templates need a function to render a navigation subtree, replacing
`$CMS_NAV(structure:uid)$`/`$CMS_NAV_RECURSE(node)$`. Follow the established extension
point: add a method to `BlockResolver` (default no-op), a new instruction token in the
OCTL lexer/parser/AST, and implement the method per render caller.

## Goals

- OCTL grammar addition (extend §16.9's abridged EBNF in this task's PR description, not
  the spec file): `navigation = "NAVIGATION(" , accessor , [ "," , namedArgs ] , ")"`
  where `accessor` is a nav-folder reference (`nav:<uid>` — new `assetRef` kind, add
  `"nav"` alongside `page|media|section_template|page_template|folder`) and `namedArgs`
  supports at least `depth` (int) and `channel` (defaults to the current render
  channel).
- `BlockResolver.renderNavigation(navFolderUuid, args) -> String` (default `""`,
  matching the existing `renderCatalog` pattern) plus a recursion hook
  (`renderNavigationRecurse(node) -> String`, default `""`) for nested-list templates,
  mirroring the old `$CMS_NAV_RECURSE$` ergonomics but against the new tree shape from
  `M8.1.3`.
- Implement `BlockResolver` for this instruction in both `GenerationRenderer`
  (snapshot-backed) and preview's `PageRenderService` (live-repo-backed), each calling
  `NavigationService.tree(...)` and rendering the folder's own per-channel OCTL template
  (navigation folders keep the "renderer template lives on the asset" pattern from the
  old `structure.channelTemplates`, scoped now to `PAGE_REFERENCE`/folder nodes instead
  of the removed `NavNode`).
- Href resolution inside a rendered nav node must go through the URL registry once
  `M8.2` lands — for this task, resolve hrefs via the existing `UrlResolver`/
  `OutputPathResolver` path directly (a straight page-path lookup) so the feature is
  independently testable; `M8.2.3` is where the registry is spliced in.

## Acceptance criteria

- [ ] `$CMS_NAVIGATION(nav:main)$` compiles and renders a nested list reflecting the
      tree from `M8.1.3`, with `active`/`trail` marking relative to the page being
      rendered (same semantics as the old §17.2 step 5).
- [ ] Golden-file tests cover: flat folder, nested folders, a folder with `null`
      `startNode` rendered as non-linked grouping, and cycle truncation surfacing the
      new diagnostic code from `M8.1.3`.
- [ ] Unknown `nav:` uid at compile time raises the existing "unresolvable asset
      reference" diagnostic (`SF-TPL-0110`), reusing `ReferenceResolver`.

## Out of scope

- URL registry integration (`M8.2`).

## Notes / hazards

- Keep the instruction name `NAVIGATION`, not `NAV` — `NAV` is retired with the old
  feature in `M8.1.1` and reusing it risks confusing old golden fixtures/diagnostics
  still referencing `SF-GEN-0410`.
