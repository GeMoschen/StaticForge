# Feature: Docs and journey

**Spec:** §2.2, §5, §7, §10.4, §11, §16.4, §17, §18.1–§18.2, §19, §20.2, §23, §24, §26.5, Appendix B.

## Goal

The spec, API reference, user guide, template developer guide and operator docs describe release state, localized
media and the scheduler as implemented; one Playwright journey proves the editorial flow end to end.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-docs-and-spec.md](001-docs-and-spec.md) | `M27.1`–`M27.6` |
| 2 | [002-release-and-scheduling-journey.md](002-release-and-scheduling-journey.md) | `M27.6.*`, `M27.5.2` |

## Feature exit criteria

- [ ] Spec sections and Appendix B updated; deviations between plan and code recorded in the task notes.
- [ ] Journey green twice in a row on a clean dev stack.
- [ ] Full `./gradlew build` (`test --rerun`), `npm run build`, `npx vitest run` green.

## Dependencies

Every other M27 feature.
