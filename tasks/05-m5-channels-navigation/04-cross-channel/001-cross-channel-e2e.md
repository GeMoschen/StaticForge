---
id: M5.4.1
status: done
depends: [M5.2.1, M5.3.4]
epic: m5-channels-navigation
feature: cross-channel
area: qa
---

# M5.4.1 — Cross-channel E2E & nav golden files

## Context

Verify the multi-channel promise (G3) end to end.

## Goals

- Implement Playwright journey 4 (§25.6): create markdown channel, copy HTML template,
  adjust, generate both channels, verify two output files.
- Add golden-file cases for navigations/breadcrumb rendering in HTML + markdown.

## Acceptance criteria

- [ ] Journey 4 passes across the three browsers.
- [ ] Nav/breadcrumb golden files are correct in both channels.

## Out of scope

- Search-index/headless JSON channel (Appendix C Q3 — future).

## Notes / hazards

- Assert from the *same* content set: no content duplication.
