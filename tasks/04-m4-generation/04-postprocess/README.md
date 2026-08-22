# Feature: Post-processors

**Spec:** §18.2 (POST stage).
**Area:** backend. **Epic:** M4.

## Goal

Implement the channel post-processors: prettify/minify HTML, sitemap, robots, redirect
map, search index.

## Tasks

| # | Task | Depends |
|---|---|---|
| 1 | [001-postprocessors.md](001-postprocessors.md) | M4.2.1 |

## Feature exit criteria

- [ ] Per-channel post-processors (prettify/minify, sitemap.xml, robots.txt, redirect
      map, search index JSON) run after render.

## Dependencies

`M4:render-pipeline`.
