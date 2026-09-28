# StaticForge CMS — Task Breakdown & Multi-Agent Work Guide

This directory is the **single source of truth** for *what* remains to be built. It
breaks the entire `cms-specification.md` (2544 lines) into a three-level hierarchy of
work items. **No code lives here** — only work descriptions, goals, and acceptance
criteria.

## Source of truth

- Product spec: `../cms-specification.md`
- Target code layout: [`project-structure.md`](project-structure.md)

## The three levels

| Level | Directory / file | Meaning |
|---|---|---|
| **Epic** (bigger task) | `NN-<epic>/README.md` | A milestone from the delivery roadmap (§27: M0–M7). Has an exit criterion. |
| **Feature** (small task) | `NN-<epic>/NN-<feature>/README.md` | One cohesive capability (e.g. "JWT auth", "OCTL renderer"). Groups related tasks and declares their sequencing. |
| **Task** (simple task) | `NN-<epic>/NN-<feature>/NNN-*.md` | The unit of work for **one agent**. Has explicit goals + acceptance criteria. |

Every task file carries a small YAML front-matter block that agents (and CI bots) can
parse mechanically.

## Task file format

Each task file starts:

```yaml
---
id: M1.4.2            # EXAMPLE ONLY — epic.feature.task, globally unique
status: todo          # todo | in-progress | blocked | done
depends: [M1.4.1]     # ids of tasks that MUST be done first (empty = ready now)
epic: m1-identity-revisions
feature: revision
area: backend         # backend | frontend | infra | fullstack | qa
---

# M1.4.2 — Task title

## Context        (1–2 lines; links to spec §)
## Goals
## Acceptance criteria  (checkboxes)
## Out of scope
## Notes / hazards
```

## How an agent finds its next task

1. Grep for ready tasks: every task with `status: todo` whose `depends:` are all
   `done` (or empty) is executable **now**.
2. Prefer the **earliest epic** with ready tasks (order: M0 → M7). Epics are hard
   dependencies; do not start a later epic while an earlier one has ready work.
3. Work **one task at a time**. When you start, flip `status: in-progress`. When done,
   flip `status: done` and tick every acceptance checkbox.
4. If blocked (e.g. a dependency is wrong or a spec gap), set `status: blocked` and
   write the reason inline under `Notes`.

Rules of thumb:

- **One task ⇒ one owner.** Two agents must not edit the same task file or the same
  source package simultaneously. Coordinate ownership *before* starting.
- Backend, frontend, and infra agents rarely collide if each owns whole tasks; the
  `area` tag is your first sorting key.
- A task is **not done** until its acceptance criteria are proven (tests pass, build
  green, endpoint demonstrable). "I think it works" ≠ done.

## Status legend

- `todo` — not started, ready (or waiting on deps).
- `in-progress` — actively owned by an agent.
- `blocked` — cannot proceed; reason in the task file.
- `done` — acceptance criteria met and verified.

## Epic map (dependency order)

| # | Epic | Spec (§) | Exit criterion |
|---|---|---|---|
| 00 | [m0-skeleton](00-m0-skeleton/README.md) | 4, 21, 22, 23 | `docker compose up` yields a running, empty app; CI green |
| 01 | [m1-identity-revisions](01-m1-identity-revisions/README.md) | 5–9, 10, 20 | Property-based revision invariants pass; login→project→folder works |
| 02 | [m2-templates-rendering](02-m2-templates-rendering/README.md) | 12–14, 16 | Golden-file render suite green; a page renders end-to-end |
| 03 | [m3-editing-ui](03-m3-editing-ui/README.md) | 10, 11, 19, 23, 24 | Playwright journeys 1–3 pass |
| 04 | [m4-generation](04-m4-generation/README.md) | 18 | 5,000-page fixture builds within target; rollback works |
| 05 | [m5-channels-navigation](05-m5-channels-navigation/README.md) | 15, 17 | Journey 4 passes; two channels from one content set |
| 06 | [m6-revision-ux](06-m6-revision-ux/README.md) | 17, 24 | Journeys 5–8 pass |
| 07 | [m7-hardening](07-m7-hardening/README.md) | 2, 25, 26 | Quality gates (§25.7) met; pen-test findings closed |

### Post-roadmap feature epics (M16–M31)

Inserted after the §27 roadmap the same way `M8`–`M15` were. Decisions and the binding
feature/task ID skeleton live in [`todo.md`](todo.md) ("Feature roadmap M16–M24").

| # | Epic | Spec (§) | Exit criterion |
|---|---|---|---|
| 16 | [m16-render-reference-foundations](16-m16-render-reference-foundations/README.md) | 5.4, 16, 18 | Cross-asset values render; references current on save; compile cache; channel path settings honored |
| 17 | [m17-global-store](17-m17-global-store/README.md) | 5, 14, 16 | Property sets editable and readable via `$CMS_GLOBAL$` / `global:` |
| 18 | [m18-parsable-text-media](18-m18-parsable-text-media/README.md) | 11, 16, 18 | Flagged text media rendered through OCTL in preview and generation |
| 19 | [m19-content-store](19-m19-content-store/README.md) | 5, 14, 16 | Dataset records editable and iterable with where/sort/limit |
| 20 | [m20-template-inheritance](20-m20-template-inheritance/README.md) | 13, 16 | Multi-level `$CMS_EXTENDS$`/`$CMS_BLOCK$` with inherited CDL |
| 21 | [m21-pagination](21-m21-pagination/README.md) | 14, 18 | One page generates N paginated outputs from nav or dataset |
| 22 | [m22-build-insight](22-m22-build-insight/README.md) | 18 | Dry-run plan + stored rebuild reasons per run |
| 23 | [m23-global-search](23-m23-global-search/README.md) | 20, 24 | Ctrl+K search across all stores backed by Lucene |
| 24 | [m24-multi-language](24-m24-multi-language/README.md) | 2.2, 14–18 | Localizable editors, per-locale output + hreflang |
| 25 | [m25-record-sets](25-m25-record-sets/README.md) | 5, 14, 16, 26.5 | Records live in typed, queryable record sets rendered via `$CMS_VALUE(recordset:uid)$` / reference editors |
| 26 | [m26-user-management](26-m26-user-management/README.md) | 8, 9, 20, 23, 24, 26 | Instance admins manage users/projects/audit, project admins manage members, archived projects read-only |
| 27 | [m27-release-and-scheduling](27-m27-release-and-scheduling/README.md) | 7, 10, 11, 18, 19, 20, 24, 26.5 | Editorial content is released per asset and locale; builds render the released state; scheduled release/unpublish/generation run |
| 28 | [m28-editor-publishing](28-m28-editor-publishing/README.md) | 8.3, 18.1, 20, 24 | Per-project publish policy lets editors release, schedule and build; UI gated by effective permissions |
| 29 | [m29-housekeeping-jobs](29-m29-housekeeping-jobs/README.md) | 7.7, 11.2, 18, 26 | Housekeeping jobs (blob sweep, purges, recovery, retention, compaction) run on schedule and are managed on the admin Jobs page |
| 30 | [m30-quality-checks-and-redirects](30-m30-quality-checks-and-redirects/README.md) | 16, 18, 24 | Builds check links/SEO/accessibility per configurable rule; moved pages get automatic redirects in per-target formats |
| 31 | [m31-folder-start-pages](31-m31-folder-start-pages/README.md) | 10.2, 15.2, 16.4, 17, 18, 20.2, 24, 26.5 | Every pages folder, the site root included, can name a start page that renders as its index file |

Epics are sequential **hard** dependencies. Within an epic, features and tasks declare
their own `depends` graph; anything with no dependencies can be parallelised across
agents.

## Working principles

- **Split the code like the spec.** Sub-projects follow §4.3 (backend Gradle modules)
  and §23.2 (Angular features). See [`project-structure.md`](project-structure.md).
- **Spec-first.** When a task and the spec disagree, the spec wins; if the spec has a
  gap, note it and resolve via the corresponding open question in Appendix C.
- **The checklist is a living document.** As implementation reveals new sub-work, add
  task files (next free ID in that feature) rather than open-ended comments in code.
- **Never write code inside `tasks/`.** Snippets in a task file are illustrative only
  and may be intentionally incomplete.

## Progress view

To see the state of the whole plan at a glance:

- `grep -rl "status: todo"` → pending tasks
- `grep -rl "status: done"` → completed tasks
- Count per epic: `grep -rc "status: done" NN-*/ -n`
