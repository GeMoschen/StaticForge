# Feature: OCTL filters

**Spec:** §16.3 (filters + escaping).
**Area:** backend. **Epic:** M2.

## Goal

Implement the full filter set and escaping semantics (default escaping, `raw`, warnings).

## Tasks

| # | Task | Depends |
|---|---|---|
| 1 | [001-filters-escaping.md](001-filters-escaping.md) | M2.3.3 |

## Feature exit criteria

- [ ] All §16.3 filters (`html, attr, js, url, raw, upper, lower, capitalize, trim,
      truncate, default, date, number, stripTags, nl2br, md, plain, json, slug, join,
      size`) work piped left-to-right.
- [ ] Channel `default_escaping` applied last unless an escaping filter/`raw` present;
      `raw` on `text` warns `SF-GEN-0301`.

## Dependencies

`M2:octl` (filter position in AST), `M2:renderer` (invocation).
