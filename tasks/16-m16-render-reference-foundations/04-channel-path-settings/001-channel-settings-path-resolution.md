---
id: M16.4.1
status: done
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

- [x] `OutputPathExpanderTest` / `OutputPathResolverTest` are migrated to `ChannelOutputSettings` and
      cover RELATIVE vs PRETTY, trailing slash, custom `fileExtension` (`htm`), custom `indexUid`,
      and the markdown fallback extension.
- [x] Generation integration test: a channel with `urlStrategy=PRETTY, trailingSlash=true` writes
      `about/index.html` and emits `about/` hrefs (relative to the current page, per the
      `tasks/lessons.md` rule). The default channel output is byte-identical to before.
- [x] URL registry test: registry URLs for the same channel match generation's hrefs (no drift).
- [x] Channel API test: an invalid `urlStrategy` or extension → 400; unknown settings keys survive
      an update.
- [x] Grep finds no `"DEFAULT"` strategy literal and no `DEFAULT_URL_STRATEGY` constant.
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

### Implementation notes

- **Model.** `channel/ChannelOutputSettings` (record: `extension`, `indexUid`, `indexFileName`,
  `urlStrategy` enum `RELATIVE|PRETTY`, `trailingSlash`) with `defaults(key)`, lenient `of(...)`
  (unusable values fall back to defaults — project import writes channels without going through
  `ChannelService`) and strict `validate(fileExtension, settings)`. `extensionForChannel` moved here.
  An absent `indexFileName` defaults to `index.<extension>` (so `markdown` stays `index.md`, the
  seeded html channel stays `index.html`).
- **Index semantics.** The `indexUid` page's `{uid}` expands to the stem of `indexFileName`
  (default `index`, matching §18.3). The PRETTY directory form writes `about.html` as
  `about/<indexFileName>`; a path whose stem already is the index stem is unchanged. `trailingSlash`
  only has an effect with PRETTY (PRETTY without it is identical to RELATIVE — unchanged behaviour).
- **Deviation / fix.** With directory URLs the site-root index used to resolve to a blank URL (an
  empty `href` points at the current page); it now resolves to `./`, which `relativeUrl` already
  relativizes (`../../../` from a nested page). `OutputPathExpander.urlForPath` is the single
  path→URL rule for generation and the registry.
- **Callers.** `OutputPathResolver.forSnapshot(snapshot, Map<channelKey, settings>)` (missing key →
  defaults); `LiveOutputPathResolver.resolveUrl(..., settings)`; `GenerationService` reads
  `ChannelService.outputSettings(projectId)` (all project channels, not only enabled ones, so an
  explicitly requested disabled channel still uses its own settings) once per run; `RenderPipeline`'s
  hardcoded `execute(snapshot, plan)` overload is removed (it had no callers); `UrlRegistryServiceImpl`
  resolves per channel via `ChannelService.outputSettings(projectId, key)`; its `DEFAULT_*` constants
  and the "gap" Javadoc are gone. `PageRenderService` needed no change: its nav hrefs come from the
  registry's `PREVIEW` area, which now uses the channel settings (asserted in the integration test);
  `$CMS_REF` links in preview are share-token routes, not output paths.
- **Channel settings are live configuration**, not revision-pinned: generating an older revision
  uses the current settings (as before, when the tuple was hardcoded).
- **Validation.** `ChannelServiceImpl.create/update` → 400 `SF-API-0400` with a `fieldErrors`
  extension (`[{field, message}]`, fields `fileExtension`, `settings.urlStrategy`,
  `settings.indexFileName`, `settings.indexUid`, `settings.trailingSlash`); blank values are allowed.
  Unknown keys are stored as sent. `update` with `settings: null` now keeps the stored settings
  (previously it wiped them). No DTO changed, so `schema.d.ts` was not regenerated.
- **URL registry.** When the parsed `ChannelOutputSettings` differ after `update`, the channel's
  non-overridden entries (both areas) are deleted in the same transaction
  (`UrlRegistryRepository.deleteByProjectIdAndChannelKeyAndOverriddenFalse`); overrides are kept.
- **Incremental builds.** Channels are a mutable table (not asset versions), so `BuildPlanner`'s
  version-based change detection cannot see them. `update` now appends a `CHANNEL` entry
  (`uuid: channel-<key>`, changed `fileExtension`/`settings` fields) to its revision summary (create
  already did). `ChannelService.outputSettingsChangedSince(projectId, revision)` scans the summaries
  after the last successful run; if it finds a channel create or extension/settings change,
  `GenerationService` plans the run as FULL (the run row keeps its requested mode). `BuildPlanner`
  itself is unchanged. Channels added by project import carry no summary entry and are not detected.
- **UI.** Channels form: extension (pattern-validated, placeholder shows the fallback), URL strategy
  select, trailing slash (enabled only for PRETTY), index page UID, index file name. Saves merge into
  the channel's existing `settings` so unknown keys survive; update also sends `isDefault`/`position`
  (previously omitted, which reset the default flag). Time travel: the form cannot be opened
  (existing `readOnly` guard). Verified with `npm run build`, not in a browser.
- **Proof.** `ChannelOutputSettingsIntegrationTest` (sf-app) builds a site with pages at three depths,
  a nav store and two linker pages (root and `pf/pf1/`), and runs a link checker that resolves every
  relative href against its own page's file (directory hrefs must contain the index file): default
  channel (all links resolve), PRETTY+trailingSlash+`indexUid=home` (`about/index.html`, hrefs
  `about/`, `../../../about/`, `./`; manual override kept and emitted verbatim; registry
  GENERATED/PREVIEW URL = generation's site path; nav href = `$CMS_REF` href), `htm` +
  `default.htm` + unknown `prettyPrint` key, and INCREMENTAL-after-settings-change building every page.
  Link checker result: 0 broken links in every scenario.
  **Byte identity:** the default-channel scenario was also run against the pre-change sources
  (`93d4fe7`); SHA-256 of every output file (5 pages incl. nav + `$CMS_REF` links, `search-index.json`)
  was identical to the post-change run.
- **Grep.** No `"DEFAULT"` strategy literal or `DEFAULT_URL_STRATEGY`/`DEFAULT_TRAILING_SLASH` in
  `server/` (tests use `"NICE"` as the invalid strategy value).
