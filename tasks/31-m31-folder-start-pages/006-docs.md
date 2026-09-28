---
id: M31.6
status: todo
depends: [M31.1, M31.2, M31.3, M31.4, M31.5]
epic: m31-folder-start-pages
feature: docs
area: qa
---

# M31.6 — Spec and docs

## Context

`cms-specification.md`, `docs/api.md`, `docs/user-guide.md`, `docs/template-developer-guide.md`. Epic decisions 1–13.

## Goals

- Spec: §10.2 (fix the outdated root description: pages live in `pages_root`; folder `startPage`), §15.2/§18.3 index
  handling (start page > `indexUid`, `pathOverride` wins), §16.4 folder references, §17 navigation folder resolution,
  §18.2 planner edge `START_PAGE`, §18.9 redirect cause, §20.2 `PATCH /folders/{uuid}`, §24 UI, §26.5 protocol 11,
  Appendix B `SF-DOM-0111`, `SF-GEN-0112`.
- `docs/api.md`: the endpoint, body, roles, errors, `FolderView.startPageUuid`.
- User guide: "Make a page the home page" (root settings via "All pages", start page, release, build).
- Template developer guide: start pages ignore the template's `outputPath`; `pathOverride` still wins.

## Acceptance criteria

- [ ] Every new endpoint, field and code documented; docs checked against the merged code, deviations recorded here.

## Out of scope

- Code changes.

## Notes / hazards

- Read every task file's "Deviation:" lines before writing.
