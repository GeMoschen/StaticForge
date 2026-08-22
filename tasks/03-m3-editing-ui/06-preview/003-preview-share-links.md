---
id: M3.6.3
status: done
depends: [M3.6.1]
epic: m3-editing-ui
feature: preview
area: fullstack
---

# M3.6.3 — Preview share links

## Context

Implement signed, expiring read-only preview links for stakeholders (§19.3).

## Goals

- Backend: `PreviewTokenService` issuing a signed JWT (`?t=<jwt>`, 7 days, read-only)
  scoped to one page + one revision.
- Frontend: share action producing the link; the shared view renders the page without an
  account.

## Acceptance criteria

- [ ] A share link opens the page read-only for 7 days for one page/revision.
- [ ] The token grants no CMS access (read-only, single scope).

## Out of scope

- Stakeholder commenting (post-v1).

## Notes / hazards

- Keep the token scope minimal and expiring.
