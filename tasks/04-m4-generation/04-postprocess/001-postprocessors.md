---
id: M4.4.1
status: done
depends: [M4.2.1]
epic: m4-generation
feature: postprocess
area: backend
---

# M4.4.1 — Channel post-processors

## Context

Implement the §18.2 POST stage: per-channel post-processors.

## Goals

- Prettify/minify HTML per channel `settings` (§15.2).
- Generate `sitemap.xml`, `robots.txt`, redirect map, and a search index JSON.
- Respect `prettyPrint`, `minify`, `lineEnding`, `charset` settings.

## Acceptance criteria

- [ ] HTML is prettified/minified per settings.
- [ ] `sitemap.xml` + `robots.txt` + redirect map + search index are produced when enabled.

## Out of scope

- Search *consumption* (client site's concern).

## Notes / hazards

- Defer to small, pinned libs where sensible; note the dependency.
