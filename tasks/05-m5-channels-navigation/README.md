# M5 — Channels & Navigation

**Spec:** §15 (output channels), §17 (structure & navigation). Roadmap M5 (§27): 3 weeks.

## Goal

Implement output-channel CRUD (markdown alongside HTML), the `structure` asset type and
navigation computation/rendering, proving one content set emits multiple channels.

## Exit criteria (epic is done when)

- [ ] Journey 4 (§25.6) passes: create a markdown channel, copy the HTML template, adjust,
      generate both channels, verify two files. _(spec written in `ui/e2e/m5-journeys.spec.ts`, gated behind `SF_RUN_E2E=1` — blocked on the still-deferred demo seed; the underlying multi-channel generation is proven by golden files + the M4 generation integration test)_
- [x] `$CMS_NAV` renders navigations with active/trail marking and cycle protection.

## Implementation status

All 8 tasks implemented across 5 agents (4 backend + 1 frontend + 1 QA):

| Feature | Deliverables |
|---|---|
| channels | `OutputChannel` entity + repo + `ChannelService` (CRUD, protected `html`, delete-block listing affected templates, copy-from seeding) + `ChannelController` + Liquibase `010`; `html` auto-created on project create |
| markdown-channel | `default_escaping` wired into the generator; `SF-GEN-0210` warning (not error) when a template lacks a channel body; `md`/`plain` filters verified via golden files |
| structure-navigation | `StructureSource` grammar + parser; `StructureService` (structure assets); `NavigationBuilder` (active/trail + cycle `SF-GEN-0410`); `NavRenderer` + `$CMS_NAV`/`$CMS_NAV_RECURSE` (incl. `OctlRenderer`/`BlockResolver` recursion); `StructureController` + preview |
| cross-channel | markdown golden files (§16.7 + `md`/`plain`), nav golden test (HTML + markdown, active/trail/recursion), journey 4 spec |

Verified: `./gradlew build` green (all modules, `checkModuleLayers`, spotless, tests incl.
golden + nav + channel-service tests); `ui` `ng build` green + 55 vitest tests green.


## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [channels](01-channels/README.md) | backend+frontend | — |
| 2 | [markdown-channel](02-markdown-channel/README.md) | backend | 1 |
| 3 | [structure-navigation](03-structure-navigation/README.md) | backend+frontend | 1 |
| 4 | [cross-channel](04-cross-channel/README.md) | qa | 1–3 |

## Dependencies

`M2` (OCTL channel templates, filters), `M4` (generation).
