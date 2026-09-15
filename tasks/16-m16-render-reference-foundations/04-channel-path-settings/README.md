# Feature: Channel path settings

**Spec:** Implements §15.2 (`output_channel.settings`: `indexFileName`, `urlStrategy`,
`trailingSlash`, and `file_extension`) and §18.3 (output paths), which the code models but never
reads.

## Goal

Give output-path resolution one source of truth: the channel's own configuration.

**Today:**
- `GenerationService.run` (~l.269) calls
  `OutputPathResolver.forSnapshot(snapshot, "index", false, "DEFAULT")`. `"DEFAULT"` is not a
  strategy value; it silently acts as non-PRETTY.
- `RenderPipeline` (~l.105) defaults to `(DEFAULT_INDEX_UID, false, "RELATIVE")`.
- `UrlRegistryServiceImpl` (~l.164) uses its own `DEFAULT_INDEX_UID` / `DEFAULT_TRAILING_SLASH` /
  `DEFAULT_URL_STRATEGY` constants and says in its Javadoc that wiring settings is "a pre-existing gap".
- `OutputPathExpander.extensionForChannel(channel)` maps `markdown → md`, otherwise uses the key
  itself, ignoring `OutputChannel.fileExtension`.
- `ChannelServiceImpl` (~l.304) seeds `{"indexFileName":"index.html","urlStrategy":"RELATIVE"}`, but
  nothing reads it, and `ui/src/app/features/channels/channels.component.*` has no fields for these
  settings.

`M21` (pagination paths) and `M24` (`{locale}` prefix) extend path resolution and need this done
first, so their new placeholders and settings go through one resolver.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-channel-settings-path-resolution.md](001-channel-settings-path-resolution.md) | — |

## Feature exit criteria

- [x] A typed `ChannelOutputSettings` value (parsed and validated from `OutputChannel.settings` +
      `fileExtension`) is the only input for index handling, trailing slash, URL strategy and extension.
      *Proof:* `ChannelOutputSettings` + `ChannelOutputSettingsIntegrationTest`.
- [x] Generation, the URL registry (generated and preview areas) and preview all use it. No hardcoded
      strategy tuple is left (grep proves it).
      *Proof:* `ChannelOutputSettingsIntegrationTest`; grep finds no `"DEFAULT"` strategy literal.
- [x] The channels UI can edit the settings, with validation.
      *Proof:* journey 3 edits urlStrategy/trailingSlash/indexUid in the channels form against a live backend; server-side validation `SF-API-0400` with `fieldErrors`.

## Dependencies

`M5:channels` (`OutputChannel`, `ChannelServiceImpl`, channels UI), `M8` (`OutputPathExpander`,
`UrlRegistryServiceImpl`, `LiveOutputPathResolver`), `M4:generation` (`OutputPathResolver`).
