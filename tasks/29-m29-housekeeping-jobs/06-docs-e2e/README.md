# Feature: Docs and journey

**Spec:** §7.7, §11.2, §11.4, §18.4–§18.5, §20.2, §26.3–§26.6, Appendix B.

## Goal

Bring the spec and operator docs in line with what M29 built, and prove the jobs end to end in the running app.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-docs-and-spec.md](001-docs-and-spec.md) | `M29.1`–`M29.5` |
| 2 | [002-housekeeping-journey.md](002-housekeeping-journey.md) | `M29.5.1`, `M29.5.2` |

## Feature exit criteria

- [x] Spec, `docs/administration.md` (jobs runbook), `docs/api.md`, `infra/README.md` (properties) and
      `docs/user-guide.md` (compaction notice) are updated.
- [x] The Playwright journey is green twice on a clean dev stack.

## Dependencies

Features 1–5.
