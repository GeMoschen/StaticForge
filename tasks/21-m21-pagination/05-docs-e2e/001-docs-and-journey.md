---
id: M21.5.1
status: done
depends: [M21.2.2, M21.3.1, M21.4.1]
epic: m21-pagination
feature: docs-e2e
area: qa
---

# M21.5.1 — Pagination docs + E2E journey

## Context

Pagination touches the CDL reference (`docs/editors/`, written in `M21.1.1`), OCTL scopes
(`docs/template-developer-guide.md` §2.1/§2.5), output paths (`cms-specification.md` §18.3),
preview (§19) and the editor-facing user guide. Journeys live in `ui/e2e/` (e.g.
`m15-journeys.spec.ts`). The project memory notes the local run setup (dev ports/login) and that
journeys since `M5` often could not run against a live backend in the sandbox.

## Goals

- Docs:
  - `docs/template-developer-guide.md`:
    - `CMS_PAGINATION` scope table in §2.5 and `$CMS_META(pageNumber|totalPages)$` in §2.1;
    - a worked "blog index" example (page template with `editor pagination`, `$CMS_FOR` over
      items, numbered pager from `pages[]`, `<link rel="prev/next/canonical">`);
    - new diagnostics in Part 3.
  - `docs/editors/pagination.md`: final sort semantics, `nav.visible` exclusion, dangling-reference
    warning, empty source → one page.
  - `docs/user-guide.md`: configuring a listing page and using the preview page selector.
  - `cms-specification.md`:
    - §14.3 editor table (19 types), §16.5 scopes;
    - §18.3 `paginationPath` + `{pageNumber}`/`{pagePath}` placeholders and default pattern;
    - §19 `?page=n`;
    - Appendix C Q7 note that pagination covers listing slices (the scoped query loop grammar
      remains `M19`'s concern).
- E2E journey `ui/e2e/m21-journeys.spec.ts`:
  1. As a developer, create a page template with `editor pagination posts { sources ["nav"] pageSize 2 sort ["navigation"] }`
     and an HTML channel template with items loop + prev/next links.
  2. Create 5 pages and a navigation folder with 5 page references.
  3. As an editor, create a blog page from the template and pick the folder, size 2.
  4. Preview: 3 pages via the selector; page 3 shows 1 item.
  5. Generate FULL: 3 output files exist (page 1 at the normal path); all hrefs resolve (link check
     against the target output).
  6. Remove one page reference and generate INCREMENTAL: only 2 pages remain published, with no
     stale `page/3/`.
- Record results (including environment caveats) in the epic README exit criteria.

## Acceptance criteria

- [x] All listed doc sections are updated; examples compile, verified by pasting them into the
      golden/integration test fixtures or the running app.
- [x] `m21-journeys.spec.ts` exists and collects; it passes against a running backend, or the
      inability to run is recorded with evidence as in `M15.6.1`.
- [x] A link check of the generated output from step 5 reports zero broken hrefs.
- [x] The epic README exit criteria are ticked with evidence references.

## Out of scope

- Performance benchmarking of very large paginated sources beyond the §18.6 regression check already
  covered by the existing benchmark.

## Notes / hazards

- The link check must resolve each href against **its own page's** output path, not the site root
  (`tasks/lessons.md`).
- Keep the journey independent of dataset sources so it can run before `M19`. Add a dataset variant
  as a separate test once `M19` has landed.
