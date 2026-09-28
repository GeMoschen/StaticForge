# Feature: Docs and journey

**Spec:** §15.2, §16.4, §18.2, §18.4, §18.5, new §18.7 (quality checks) and §18.8 (redirects), §19, §20.2, §24, §26.3,
Appendix B.

## Goal

Spec, API, user, template-developer and operator docs describe the implemented behaviour; one Playwright journey
proves checks and redirects end to end.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-docs-and-spec.md](001-docs-and-spec.md) | `M30.1.*`–`M30.5.*` |
| 2 | [002-quality-and-redirects-journey.md](002-quality-and-redirects-journey.md) | `M30.3.2`, `M30.6.*` |

## Feature exit criteria

- [x] Every new endpoint, code, stage, fallback cause, target key and project setting documented.
- [ ] Journey green twice in a row on a clean dev stack.
  — **Deferred by the user on 2026-09-27**: the unfinished journey is parked on branch `m30-d-journey`.
- [x] Full `./gradlew build` (`test --rerun`), `npm run build`, `npx vitest run` green.

## Dependencies

Features 1–6.
