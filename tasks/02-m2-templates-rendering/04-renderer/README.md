# Feature: Renderer

**Spec:** §16.5 (scopes), §16.10 (engine), §21.5 (cache), §21.3 (Renderer contract).
**Area:** backend. **Epic:** M2.

## Goal

Implement the actual render engine: scopes, the stack-machine walker, guard rails, and
the compiled-template cache.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-render-context-scopes.md](001-render-context-scopes.md) | M2.3.3 |
| 2 | [002-render-engine.md](002-render-engine.md) | 1 |
| 3 | [003-template-cache.md](003-template-cache.md) | 2 |

## Feature exit criteria

- [ ] §16.5 scopes resolve correctly (`$CMS_PAGE.*`, loop vars, nav nodes).
- [ ] Guard rails (§16.10) — include depth 32, 100k loops, 32 MB output, 5 s budget —
      fail a file with a diagnostic, not the build.
- [ ] Rendering is side-effect-free and thread-safe; `RenderResult` carries touched UUIDs.

## Dependencies

`M2:octl` (CompiledTemplate).
