---
id: M2.4.2
status: done
depends: [M2.4.1]
epic: m2-templates-rendering
feature: renderer
area: backend
---

# M2.4.2 — Render engine (stack-machine walker)

## Context

Implement the §16.10 render walker satisfying the §21.3 `Renderer` contract.

## Goals

- Implement `Renderer.render(CompiledTemplate, RenderContext) → RenderResult`
  using a stack-machine walk with an adaptive `StringBuilder` (§16.10).
- Implement `$CMS_VALUE/REF/BODY/INCLUDE/NAV/IF/FOR/SET/META/COMMENT/NAV_RECURSE`.
- Apply guard rails: include depth 32, loop iterations 100,000, 32 MB output, 5 s
  wall-clock; exceeding fails the *file* with a diagnostic.
- Collect the set of touched asset UUIDs into `RenderResult` (§21.3).

## Acceptance criteria

- [ ] `$CMS_INCLUDE` renders another template inline (within depth limit).
- [ ] A runaway loop is cut at 100k iterations with a diagnostic (not a crash).
- [ ] `RenderResult` returns output + dependency UUID set.

## Out of scope

- Filters (feature 5) — invoke them through a filter registry interface.
- Parallelism (M4), though the runner must stay thread-safe.

## Notes / hazards

- Side-effect-free and thread-safe are hard requirements (§16.10).
