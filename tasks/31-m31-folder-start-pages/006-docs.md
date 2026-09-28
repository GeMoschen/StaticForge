---
id: M31.6
status: done
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

- [x] Every new endpoint, field and code documented; docs checked against the merged code, deviations recorded here.

## Out of scope

- Code changes.

## Notes / hazards

- Read every task file's "Deviation:" lines before writing.
- Written against HEAD 963e32b (all code lanes merged) and the "Deviation:" notes of M31.1–M31.5:
  - Spec: §3 glossary (*Start page*), §5.4 (`START_PAGE` edge, not a delete guard), §10.2 (outdated `uid=root, path=/`
    description fixed: hidden shared `root` vs. the site root `pages_root`; start page model, `PATCH`, 422/409 cases,
    `FolderView.startPageUuid`, release per locale / `pages_root` live, effective vs. stale pointer, the shared "index
    page" rule), §15.2 (`indexUid` only without a start page; `index` reserved), §16.4 (`$CMS_REF(folder:…)` → index page
    else `folderUrl`, never `pages_root/`), §17.2 (folder resolution prefers the index page; URL registry invalidation incl.
    release and import), §18.2 (`START_PAGE` edge, incoming-row rule, moved outputs now navigation-visible), §18.3
    (precedence pathOverride > start page > template > default; `SF-GEN-0112` makes the run `PARTIAL`; `SF-GEN-0110`
    backstop), §18.9 (AUTO/SHADOWED/LOOP on start page changes; registry exception), §19.2 (preview folder links),
    §20.2 (`PATCH /folders/{uuid}`), §24.5 item 20 (UI) + redirect preselection, §26.5 (protocol 11,
    `START_PAGE_NOT_MERGED`), Appendix B (`SF-DOM-0111`, `SF-GEN-0112`).
  - `docs/api.md` §1 import (protocol 11), §6 folders (endpoint, body, roles, errors, `startPageUuid`, edge), §10 plan
    steps (`START_PAGE`), §12 preview folder links, error catalogue. `docs/user-guide.md`: "Make a page your home page"
    how-to, Channels "Index page UID" row, redirect preselection, rebuild reasons. `docs/template-developer-guide.md`
    §2.6 and new §2.15 (start pages ignore the template's `outputPath`, `pathOverride` wins), §3.3 `SF-GEN-0112`.
    `docs/navigation-html-output.md`: folder resolution and registry invalidation.
  - `docs/administration.md` unchanged: it describes neither project import nor asset edits in the audit trail (a
    start page change is a revision, not an audit entry).
- Deviations documented as implemented: the index claim counts only index file **stems**, not `indexUid` (M31.1); `412`
  precedes the empty-body no-op (M31.1); preview folder links without an index page render an empty href (M31.3);
  moved outputs are navigation-visible in the planner (M31.4); the `pages_root` import merge writes through
  `AssetService.update` and skips `SF-DOM-0111` (M31.4). Not documented as user-facing: M31.5's "New page/folder under
  All pages" still sends no `folderUuid` (the page lands in the site root either way).
- Open elsewhere: M31.5's manual check box ("build, output has `index.html`") is still unticked in `005-ui.md`.
