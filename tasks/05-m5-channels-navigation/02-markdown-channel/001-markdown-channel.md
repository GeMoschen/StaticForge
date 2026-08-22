---
id: M5.2.1
status: done
depends: [M5.1.1]
epic: m5-channels-navigation
feature: markdown-channel
area: backend
---

# M5.2.1 — Markdown channel & copy-from

## Context

Implement the markdown channel behavior of §15.4 and §16.3.

## Goals

- Ensure `MARKDOWN` default escaping applies to the markdown channel.
- Verify/implement `md` (markdown→HTML) and `plain` (HTML→text) filters for the
  `<->` conversions the §16.7 example relies on.
- Implement the `SF-GEN-0210` warning when a template has no markdown body (renders empty).
- Implement "Copy from channel" that seeds a new channel template from an existing one.

## Acceptance criteria

- [ ] The §16.7 markdown section example renders correctly.
- [ ] A section without a markdown template warns (not errors) during generation.

## Out of scope

- The UI copy flow (already covered in channel UI).

## Notes / hazards

- `plain`/`md` conversion is symmetric-ish but not lossless; pin behavior with golden files.
