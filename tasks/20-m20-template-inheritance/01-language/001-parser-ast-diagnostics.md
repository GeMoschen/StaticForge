---
id: M20.1.1
status: todo
depends: []
epic: m20-template-inheritance
feature: language
area: backend
---

# M20.1.1 — `$CMS_EXTENDS` / `$CMS_BLOCK` / `$CMS_PARENT`: parser, AST, structural diagnostics

## Context

These files are under `server/sf-template/src/main/java/com/acme/staticforge/template/octl/`.

- `OctlParser` is package-private. `parseInstruction` switches over the keywords VALUE, REF, BODY,
  INCLUDE, NAVIGATION, NAVIGATION_RECURSE, SET, META, IF, FOR and COMMENT. An unknown keyword raises
  `SF-TPL-0101`. Block forms use `parseSequence(Set<String> stop)` and raise `SF-TPL-0102` when
  they are unbalanced.
- `OctlNode` is a sealed interface of records: Text, Value, Ref, Body, Include, Navigation,
  NavigationRecurse, If/Branch, For, Set, Meta and Comment.
- `OctlCompiler.validate` and `OctlRenderer.renderNodes` switch exhaustively over it.
- Diagnostic constants are in `template/diagnostic/DiagnosticCodes`. Existing OCTL codes are 0101–0120,
  0134, 0201, 0301 and 0310; `SF-TPL-0130`/`0131` are still string literals in `OctlRenderer`.

## Goals

- Parse the new instructions:
  - `$CMS_EXTENDS(page_template:uid)$`: the accessor must be an `assetType:uid` reference.
  - `$CMS_BLOCK(name)$ … $CMS_END_BLOCK$`: `name` is an identifier using the editor naming rules
    (§14.5); the body is parsed via `parseSequence(Set.of("END_BLOCK"))`; blocks may nest.
  - `$CMS_PARENT$`: takes no arguments.
- Add records `OctlNode.Extends(accessor)`, `OctlNode.Block(name, List<OctlNode> body)` and
  `OctlNode.Parent()`.
- Handle them in every exhaustive switch. For a single template with no chain, `OctlRenderer`
  renders a `Block` as its own body, renders `Parent` as empty, and skips `Extends`. The linked
  rendering comes in M20.3.1.
- Structural diagnostics that need only the one source, emitted by `OctlCompiler.validate` (the
  numbers are proposals; keep them in the 014x range and add them to `DiagnosticCodes`):

  | Code | Severity | Condition |
  |---|---|---|
  | `SF-TPL-0140` | error | `$CMS_EXTENDS` is not the first instruction (leading whitespace-only text is allowed), or appears more than once |
  | `SF-TPL-0141` | error | the template extends, but has non-whitespace text or any instruction other than `$CMS_BLOCK`/`$CMS_SET`/`$CMS_COMMENT` outside a top-level block |
  | `SF-TPL-0142` | error | duplicate block name within one template (nested included) |
  | `SF-TPL-0143` | error | `$CMS_PARENT$` outside any `$CMS_BLOCK`, or used in a template that does not extend |
  | `SF-TPL-0146` | error | `$CMS_EXTENDS` target is not `page_template:` (e.g. `section_template:x`, `nav:x`) |

  An unbalanced `$CMS_BLOCK` keeps reporting `SF-TPL-0102`. An unresolvable `page_template:uid`
  keeps reporting `SF-TPL-0110` through the existing `ReferenceResolver` path.
- `$CMS_BODY` (`SF-TPL-0120`) and the editor-name check (`SF-TPL-0103`) are **not changed here**.
  They need the effective definition, which M20.1.2/M20.2.1 provide.

## Acceptance criteria

- [ ] Parser unit tests cover every new instruction, nested blocks, an unbalanced
      `$CMS_BLOCK` (0102), and each of 0140/0141/0142/0143/0146.
- [ ] `OctlNode` has the three new records. The module compiles, so every exhaustive switch
      handles them.
- [ ] A template with blocks but no `$CMS_EXTENDS` renders each block's body in place
      (a parent/base template rendered on its own). Covered by a unit test.
- [ ] New constants are in `DiagnosticCodes`. The existing `SF-TPL-0130`/`0131` literals in
      `OctlRenderer` also move there, so the catalogue is complete in one place.
- [ ] `./gradlew :server:sf-template:test` is green, and every existing golden file is unchanged.

## Out of scope

- Loading ancestors, cycle/depth checks and block merging: M20.1.2.
- Linked rendering in generation/preview: M20.3.1.
- `$CMS_EXTENDS` in a *section* template. That is a context rule enforced on save (M20.2.1), because
  the compiler doesn't know which asset kind it is compiling.

## Notes / hazards

- `SF-TPL-0141` exists because text outside blocks in a child has no defined place in the parent's
  layout. Silently dropping it is the classic inheritance footgun. `$CMS_SET` outside blocks is
  allowed: it defines child-level variables visible in overrides, and the docs must say so.
- Keep block names out of the editor namespace. A block `header` and an editor `header` may
  co-exist, because blocks are only ever referenced by `$CMS_BLOCK`/`$CMS_PARENT`.
- `OctlLexer`/`OctlParser` are package-private. Test from the same package, as the existing parser
  tests do.
