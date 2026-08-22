---
id: M2.3.1
status: done
depends: []
epic: m2-templates-rendering
feature: octl
area: backend
---

# M2.3.1 — OCTL lexer

## Context

First stage of §16.10: tokenize template source, recognizing `$CMS_…$` instructions and
passing everything else through as text (§16.1).

## Goals

- Implement `OctlLexer` producing text + instruction tokens; support `$$` as literal `$`
  (§16.2), balanced delimiters, and the full instruction set (`VALUE`, `REF`, `BODY`,
  `INCLUDE`, `NAV`, `IF`, `ELSEIF`, `ELSE`, `END_IF`, `FOR`, `END_FOR`, `SET`, `META`,
  `COMMENT`, `NAV_RECURSE`).
- Track positions for diagnostics.

## Acceptance criteria

- [ ] `{{`, `<%`, `${}` and other non-CMS delimiters pass through untouched.
- [ ] `$$` → literal `$`; unbalanced/unknown instructions tokenized with positions.

## Out of scope

- Parsing/compilation (next tasks).

## Notes / hazards

- Delimiters `$CMS_` and `$` are the only interpreted sequences (§16.1).
