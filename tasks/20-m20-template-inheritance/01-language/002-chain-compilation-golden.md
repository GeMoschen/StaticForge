---
id: M20.1.2
status: done
depends: [M20.1.1, M16.1.1]
epic: m20-template-inheritance
feature: language
area: backend
---

# M20.1.2 — Chain compilation (`ParentTemplateLoader`, cycles, depth cap, block merge) + golden runner

## Context

- `OctlCompiler.compile(source, channelKey, ReferenceResolver, ContentDefinition)` is stateless.
  It runs lex → parse → validate and resolves `assetType:uid` into `refMap`. Its hash is
  `sha256(channel + '\0' + source)`.
- `CompiledTemplate(channelKey, hash, nodes, references)` has no notion of a parent.
- `ReferenceResolver` (`template/octl/ReferenceResolver.java`) maps a reference to a UUID. It cannot
  load source.
- `GoldenFileRenderTest` (`server/sf-template/src/test/java/.../render/`) iterates the folders in
  `src/test/resources/render/`, each with `template.octl`, an optional `content.json` and
  `expected.html`. It compiles with a `null` resolver and no `BlockResolver`.
- `M16.1.1` introduces `CompiledTemplateCache`. This task defines the chain hash that cache must key
  on.

## Goals

- Add a `ParentTemplateLoader` SPI in `sf-template`:
  - `Optional<ParentSource> load(UUID pageTemplateUuid, String channelKey)`
  - `ParentSource(uuid, uid, String channelSource /* nullable = parent has no template for channel */, ContentDefinition ownDefinition)`
  - Callers implement it from a snapshot (generation) or from live data (save/preview/validate).
- Add a compiler entry point, e.g. `compile(source, channelKey, ReferenceResolver, ParentTemplateLoader, ContentDefinition ownDefinition)`:
  1. Compile the child as today.
  2. If it has `Extends`, resolve the UUID through the `ReferenceResolver`, load the parent through
     the loader, compile it, and repeat up the chain.
  3. Build the **effective content definition**: the union of `ownDefinition` along the chain, root
     first. Run the existing editor-name (`SF-TPL-0103`) and `$CMS_BODY` (`SF-TPL-0120`)
     validation against it, so a child may render an editor or body declared only by an ancestor.
  4. Build the **block table**: for each block name, the ordered list of definitions from
     most-derived to root.
  5. Return a `CompiledTemplate` extended with `List<CompiledLayer> chain` (root layout nodes are what
     render). Include `effectiveDefinition` and a **chain hash** over (channel, every layer's
     source, in order). `references` is the union of all layers' references.
- Chain diagnostics (numbering continues from M20.1.1):

  | Code | Severity | Condition |
  |---|---|---|
  | `SF-TPL-0144` | error | inheritance cycle (message lists the chain `a → b → a`) |
  | `SF-TPL-0145` | error | chain deeper than `MAX_INHERITANCE_DEPTH` (proposal: 8) |
  | `SF-TPL-0147` | warning | a child overrides a block name that no ancestor defines (almost always a typo; include a "did you mean" suggestion per §24.6) |
  | `SF-TPL-0148` | error | an ancestor has no channel template for the channel being compiled |
  | `SF-CDL-0107` | error | a child's own editor or body name collides with an inherited one (message names the ancestor that declares it) |

  An ancestor's own compile errors surface on the child as one diagnostic carrying the ancestor uid.
  They are not repeated line by line.
- The existing `compile(...)` without a loader keeps working unchanged. A template with `Extends`
  compiled without a loader produces a single, clear "parent not loadable in this context"
  diagnostic, not a crash.
- Golden runner: an inheritance fixture folder may contain `parents/<uid>.octl` (plus optional
  `parents/<uid>.cdl`). The runner builds an in-memory `ReferenceResolver` + `ParentTemplateLoader`
  from them. New cases:
  - `extends-default-blocks`: the child overrides nothing.
  - `extends-override-parent`: an override uses `$CMS_PARENT$`.
  - `extends-multilevel`: three levels, `$CMS_PARENT$` at each level.
  - `extends-nested-blocks`: overriding an inner block of a non-overridden outer block.
  - A Markdown case under `render-md/`.

## Acceptance criteria

- [x] `ParentTemplateLoader` and the chain-aware compile entry point exist. The loader-less `compile`
      behaves as before, and every existing golden test is unchanged.
- [x] Unit tests cover 0144 (2- and 3-cycles), 0145 (depth cap + 1), 0147, 0148, SF-CDL-0107, an
      ancestor compile error surfacing once, and editor/body names resolved through the effective
      definition.
- [x] The chain hash changes when **any** layer's source changes, and is stable otherwise. Tested,
      and documented as the key `M16.1.1`'s cache must use for templates with a chain.
- [x] The golden runner supports `parents/`, and the five new golden cases pass.
- [x] `./gradlew :server:sf-template:test` is green.

## Out of scope

- Loader implementations over the snapshot or live repositories: M20.2.1 (save/validate) and
  M20.3.1 (generation/preview).
- Rendering the linked template: M20.3.1. This task may reuse the runner, but the renderer's
  block-table walk is implemented there. Sequence it so the golden cases land with M20.3.1 if the
  renderer is not ready yet.

## Notes / hazards

- **Cycle detection must key on UUID, not uid.** A UID rename between loads must not hide a cycle.
- **Channel semantics:** each channel compiles its own chain. If the child has an `html` template that
  extends `base` but `base` has no `html` template, that is `SF-TPL-0148` (an error, not a silent
  empty render). If the child has no template for a channel at all, nothing changes from today:
  generation warns `SF-GEN-0210`.
- The effective definition is independent of channel, because CDL is per template, not per channel.
  Compute it once per chain; don't recompute it for every channel.
- `$CMS_SET` variables set outside blocks in a child are evaluated before the root layout renders and
  are visible inside that child's overrides. Define the order explicitly (root-first or child-first)
  and pin it with a golden case, because it is observable.
