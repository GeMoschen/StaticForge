---
id: M20.2.2
status: done
depends: [M20.2.1, M16.3.2, M16.3.3]
epic: m20-template-inheritance
feature: domain
area: backend
---

# M20.2.2 — Parent-change descendant validation, descendant-wide `renamedFrom` migration, `TEMPLATE` edges

## Context

- `TemplateServiceImpl` already migrates page content when a template's editors are renamed
  (`renamedFrom`, §12.3). It opens one compound revision
  (`revisionService.beginBatch(ctx.projectId(), ChangeType.UPDATE, …)`, ~line 348), rewrites each
  affected page's payload and appends one `AssetChange` per page. Today "affected" means pages whose
  `templateRef` or body section `templateRef` is *this* template.
- `ReferenceKind.TEMPLATE` exists but is never written. `M16.3.2` introduces writing template OCTL
  references on template save, and `M16.3.3` makes the reference queries revision-aware.
- `sf-generate/.../plan/BuildPlanner.affectedPages` is a BFS over changed assets:
  - `PAGE_TEMPLATE` → `pagesByTemplate` (payload index)
  - `SECTION_TEMPLATE` → `pagesBySection`
  - every asset → reverse edges via the reference repository
- `AssetServiceImpl.usages` lists inbound references.
- Export dependency expansion (M10/M11) pulls implicit dependencies with provenance.

## Goals

- **Descendant validation before commit.** When a page template that has descendants is saved (CDL or
  any channel source), recompile every descendant, transitively, against the *proposed* parent
  version using a loader that overlays the unsaved parent. If any descendant gets an error, reject
  the save with 422. The problem body lists each broken descendant uid and its diagnostics, e.g.:
  - parent adds editor `title` while child `article` already has `title` → `SF-CDL-0107`;
  - parent removes the `html` channel template → child `SF-TPL-0148`.

  A new `SF-TPL-0147` warning on a descendant (a block it overrides no longer exists) doesn't block
  the save. It is returned as a warning on the parent save response.
- **Descendant-wide `renamedFrom` migration.** When a parent editor carries `renamedFrom`, the
  existing migration runs for the pages of the parent **and of every descendant**, all inside the
  single batch revision. A descendant's own editors are unaffected.
- **`TEMPLATE` reference edges.** On page-template save, write/close
  `AssetReference(child → parentTemplateRef, kind TEMPLATE, sourcePath "parentTemplateRef")` through
  the write path from `M16.3.2`, in the same revision. Clearing the parent closes the edge.
- **Planner:** confirm that `BuildPlanner.affectedPages` reaches every descendant's pages through the
  new reverse `TEMPLATE` edge (parent changed → reverse edge → child `PAGE_TEMPLATE` →
  `pagesByTemplate`). Fix it if it doesn't. Add a planner test for a three-level chain.
- **Usages:** usages of an abstract template list its child templates, with kind `TEMPLATE`.
- **Soft delete:** deleting a template that has children is blocked by the existing reference-based
  delete guard. Verify it, and make the problem message name the children.
- **Export:** exporting a child template implicitly includes its ancestor chain, marked implicit per
  M11 provenance.

## Acceptance criteria

- [x] Integration tests:
  - [x] A parent save that introduces a collision in a grandchild is rejected (422 listing the
        grandchild), and nothing is written: no revision is allocated (verify the counter), and
        parent and child are unchanged.
  - [x] A parent save that only produces descendant warnings succeeds and returns the warnings.
  - [x] A parent editor rename with `renamedFrom` migrates pages of the parent, child and grandchild
        in **one** revision whose `summary.assets` lists every migrated page plus the parent.
- [x] A `TEMPLATE` edge is written on save and closed when the parent is removed (or the child
      re-parented), with the revision interval per `M16.3.3`.
- [x] `BuildPlanner` test: a change to the root layout in an incremental plan includes every page of
      every descendant, and nothing else.
- [x] Usages of an abstract template list its children. Deleting a template that has children is
      blocked, with a message naming them.
- [x] Exporting only a grandchild template includes child + root as implicit entries, and it
      imports cleanly into an empty project.
- [x] `./gradlew build` is green, and `RevisionInvariantsTest` still holds.

## Out of scope

- UI presentation of descendant errors/warnings: M20.4.1.
- Rendering: M20.3.1.

## Notes / hazards

- **Scale:** a root layout may have dozens of descendants. Recompilation for validation must reuse
  the chain compiler with a per-request memo keyed on (template UUID, channel). The same parent must
  not compile N times. Don't populate the global `M16.1.1` cache with the *unsaved* overlay version.
- **Cache invalidation:** after a parent save commits, cached compiled templates of every descendant
  are stale. If `M16.1.1` keys on the chain hash (M20.1.2), invalidation happens automatically.
  Verify with a test that preview shows the new parent layout for a child's page immediately after
  the save.
- The descendant set comes from the reverse `TEMPLATE` edges (revision-aware, current). Don't scan all
  template payloads; the edge exists precisely so this is an index lookup.
- Validation-then-write must be race-safe against a concurrent child save. It rides the parent's
  `If-Match` optimistic concurrency and the revision transaction. Document the remaining window, where
  a child saved concurrently against the old parent could slip through. The next save of either
  asset re-validates, and generation's `RenderPipeline.validate` catches it at build time.
