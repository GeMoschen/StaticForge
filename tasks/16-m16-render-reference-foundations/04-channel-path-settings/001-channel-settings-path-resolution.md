---
id: M16.4.1
status: todo
depends: []
epic: m16-render-reference-foundations
feature: channel-path-settings
area: fullstack
---

# M16.4.1 — Channel settings wired into `OutputPathResolver` / `LiveOutputPathResolver`

## Context

- `server/sf-domain/src/main/java/com/acme/staticforge/channel/OutputPathExpander.java`:
  - `resolvePath(PageContext, channel, indexUid, trailingSlash, urlStrategy)` and `resolveUrl(...)`
    take the three settings as loose parameters.
  - `expand` swaps the `indexUid` page's uid for `DEFAULT_INDEX_UID` ("index").
  - `extensionForChannel` derives the extension from the channel key.
- `sf-generate/.../render/OutputPathResolver.forSnapshot(snapshot, indexUid, trailingSlash, urlStrategy)`
  and `sf-domain/.../urlregistry/LiveOutputPathResolver.resolveUrl(projectId, pageUuid, channel, indexUid, trailingSlash, urlStrategy)`
  wrap it.
- Hardcoded callers:
  - `GenerationService.run` (~l.269): `("index", false, "DEFAULT")`
  - `RenderPipeline` (~l.105): `(DEFAULT_INDEX_UID, false, "RELATIVE")`
  - `UrlRegistryServiceImpl` (~l.164): its own constants
- Spec §15.2's settings example: `indexFileName`, `prettyPrint`, `minify`, `lineEnding`, `charset`,
  `urlStrategy`, `trailingSlash`.
- Both the code and the settings use "index uid" and "index file name" for related but different
  concepts.

## Goals

- Add `channel/ChannelOutputSettings` (record, sf-domain), parsed from `OutputChannel`:
  - `extension`: from `fileExtension`; falls back to `extensionForChannel(key)` when blank
  - `indexUid`: the page UID that becomes the folder index, default `index`
  - `indexFileName`: default `index.html`, used for the PRETTY directory form
  - `urlStrategy`: `RELATIVE | PRETTY`, default `RELATIVE`; unknown values are rejected on save
  - `trailingSlash`: default `false`
  - A static `ChannelOutputSettings.defaults(channelKey)` for tests.
- Change `OutputPathExpander`, `OutputPathResolver` and `LiveOutputPathResolver` to take a
  `ChannelOutputSettings` (or a `Map<channelKey, ChannelOutputSettings>` for multi-channel callers)
  instead of the loose tuple. `{ext}` uses `settings.extension()`.
- Callers resolve settings through `ChannelService`:
  - `GenerationService.run`: one map per run, from the project's enabled channels.
  - `RenderPipeline`: remove the hardcoded default overload, or make it take settings.
  - `UrlRegistryServiceImpl`: per channel key. Remove its three `DEFAULT_*` constants and the "gap"
    paragraph from its Javadoc.
  - `PageRenderService`: preview links.
- Validate on channel create/update (`ChannelServiceImpl.create/update`, `ChannelController`):
  - `urlStrategy` must be in the enum
  - `indexFileName` must match `[A-Za-z0-9._-]{1,64}`
  - `fileExtension` must match `[a-z0-9]{1,10}`
  - Violations → 400 with field errors.
  - Unknown extra keys (`prettyPrint`, `minify`, …) are kept.
- UI `features/channels/channels.component.*`: fields for extension, URL strategy (select),
  trailing slash (checkbox, only enabled for PRETTY), index UID and index file name. Keep unknown
  settings keys on save (same rule as the Targets tab). Read-only in time travel.
- Regenerate `ui/src/app/core/api/generated/schema.d.ts` if DTOs change.

## Acceptance criteria

- [ ] `OutputPathExpanderTest` / `OutputPathResolverTest` are migrated to `ChannelOutputSettings` and
      cover RELATIVE vs PRETTY, trailing slash, custom `fileExtension` (`htm`), custom `indexUid`,
      and the markdown fallback extension.
- [ ] Generation integration test: a channel with `urlStrategy=PRETTY, trailingSlash=true` writes
      `about/index.html` and emits `about/` hrefs (relative to the current page, per the
      `tasks/lessons.md` rule). The default channel output is byte-identical to before.
- [ ] URL registry test: registry URLs for the same channel match generation's hrefs (no drift).
- [ ] Channel API test: an invalid `urlStrategy` or extension → 400; unknown settings keys survive
      an update.
- [ ] Grep finds no `"DEFAULT"` strategy literal and no `DEFAULT_URL_STRATEGY` constant.
- [ ] `./gradlew build` and `ui npm run build` green.

## Out of scope

- `prettyPrint`, `minify`, `lineEnding` and `charset` post-processing. The keys are kept but not
  implemented.
- `{pageNumber}` (`M21.2.1`) and `{locale}` (`M24.3.2`) placeholders.

## Notes / hazards

- Changing a channel's settings changes every page's output path. That is a full rebuild. Make sure
  `BuildPlanner` treats a channel settings revision as "all pages of that channel affected". Channel
  versions are revisioned (`ChannelServiceImpl` ~l.312 closes versions). If the planner can't detect
  this, force FULL mode when the channel's version changed since the last successful run, and
  document it.
- Existing URL registry entries were computed with the hardcoded tuple and are assign-once.
  Decide whether a settings change resets `GENERATED`/`PREVIEW` entries for that channel via
  `UrlRegistryService.reset`. Recommended: reset non-overridden entries in the same revision, and
  keep manual overrides.
- Per `tasks/lessons.md`, verify generated links with a link checker that resolves each href against
  its page, not only by reading HTML.
