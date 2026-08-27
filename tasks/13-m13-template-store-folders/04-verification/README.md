# Feature: Verification

**Spec:** Proves M13's exit criteria end-to-end, the way `M8`'s
`03-verification` feature proved the navigation rewrite.

## Goal

Confirm the whole milestone holds together as one flow, not just per-task
unit/integration coverage: a project's template folders exist and are
protected correctly, templates can be organized and moved, export/import
round-trips the whole store including the fixed folders' identity, and the
UI exercises all of it — plus prove the pre-existing-project migration
(`M13.1.4`) against realistic data.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-migration-and-journey-verification.md](001-migration-and-journey-verification.md) | M13.1, M13.2, M13.3 |

## Feature exit criteria

- [ ] A single end-to-end integration test (or Playwright journey, matching
      this codebase's existing `ui/e2e/*.spec.ts` journey-numbering
      convention) covers: create folders under both fixed roots → create
      templates in them → move a template between folders → export the
      whole `TEMPLATES` store → import into a fresh project → verify the
      fixed folders weren't duplicated and every template/folder landed
      correctly.
- [ ] The `M13.1.4` migration is proven against a fixture project seeded
      with pre-migration (flat, hidden-root-parented) templates that have
      multiple revisions and at least one channel-template edit — confirm
      revision history and channel data survive the reparent untouched.
- [ ] `./gradlew clean build` and `ui`'s `npm run build`/`npm test` are
      green with no new failures.

## Dependencies

Everything in `M13.1`–`M13.3` must be done first — this feature only
verifies, it introduces no new product behavior.
