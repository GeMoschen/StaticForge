---
id: M4.2.2
status: done
depends: [M4.2.1]
epic: m4-generation
feature: render-pipeline
area: backend
---

# M4.2.2 — Output path resolution & collision detection

## Context

Implement §18.3 output-path resolution and collision errors.

## Goals

- Resolve each page's output path in channel `c` by the §18.3 order: page pathOverride →
  page template `outputPath[c]` → project default `{folder}{uid}.{ext}`.
- Expand placeholders `{folder} {uid} {ext} {displayNameSlug} {year} {month} {day}
  {channel}`.
- Implement index handling (`indexUid` default `index`) and `trailingSlash`/`PRETTY`
  URL-strategy path rewriting.
- Detect path collisions → build error `SF-GEN-0110` listing both assets.

## Acceptance criteria

- [ ] The §18.3 resolution order and placeholder expansion are correct.
- [ ] `/products/hammer` PRETTY/trailingSlash becomes `/products/hammer/index.html`,
      and `$CMS_REF` emits `/products/hammer/`.
- [ ] A collision is a build error, not a silent overwrite.

## Out of scope

- `$CMS_REF` emission polish beyond path correctness (already in renderer).

## Notes / hazards

- Normalize + assert paths stay under the target root (`..` rejected, §26.3).
