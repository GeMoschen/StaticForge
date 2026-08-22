# Feature: Markdown channel

**Spec:** §15.4 (adding a channel), §16.3 (`md`/`plain` filters).
**Area:** backend. **Epic:** M5.

## Goal

Make a markdown channel first-class: correct escaping, the `md`/`plain` filters, and
copy-from behavior producing the SF-GEN-0210 warning where absent.

## Tasks

| # | Task | Depends |
|---|---|---|
| 1 | [001-markdown-channel.md](001-markdown-channel.md) | M5.1.1 |

## Feature exit criteria

- [ ] A markdown channel renders with `MARKDOWN` default escaping and `md`/`plain`
      filters working.
- [ ] Templates lacking a markdown body warn `SF-GEN-0210` (not fail).

## Dependencies

`M5:channels`, `M2:filters`.
