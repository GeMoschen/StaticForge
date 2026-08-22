# Feature: Golden-file rendering tests

**Spec:** §25.4 (golden-file triples), §16.11 diagnostics.
**Area:** qa. **Epic:** M2.

## Goal

Build the directory-driven golden-file harness and seed it with the core OCTL feature
corpus, including the XSS escaping corpus.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-golden-file-harness.md](001-golden-file-harness.md) | M2.4.2 |
| 2 | [002-render-corpus.md](002-render-corpus.md) | M2.5.1, 1 |

## Feature exit criteria

- [ ] Adding an OCTL feature = adding a directory (no test code) (§25.4).
- [ ] The `escaping-xss` corpus proves no executable output escapes by default.

## Dependencies

`M2:renderer`, `M2:filters`.
