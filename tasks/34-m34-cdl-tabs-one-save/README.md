# M34 — CDL tabs and one save (sections stored separately, one revision per save)

**Spec:** Extends §12.1 / §13.2 (payloads), §14 (new §14.9 "Sections as stored and edited"), §20.2 (endpoints), §23.7
(Template IDE), §24.5. Not part of the original §27 roadmap — inserted the same way `M8`–`M33` were.

## Goal

The CDL of a template was one text holding `content {}`, `bodies {}` and `rules {}`, edited in one code editor, and a
template had two save buttons: *Save template* (CDL and metadata) and *Save channel* (one channel's OCTL), each its own
revision. After M34 every holder's CDL is stored and edited as its sections, each in its own tab; channels are tabs
too; and one Save writes everything as one revision.

## User decisions (2026-09-30)

1. **Separate stored fields.** The payload and the API carry `contentCdl`, `bodiesCdl` and `rulesCdl` instead of
   `contentDefinition`; each holds the text *inside* its section's braces (the server adds keyword and braces).
2. **No migration of stored data.** There is no real data yet; `contentDefinition` is removed, not kept or converted.
   **Amended 2026-10-04:** an *import* of an archive written before M34 now splits the old `contentDefinition` text into the three
   sections (`LegacyCdlMigration`, silently, for current and release payloads of templates, datasets and global sets). M34 did
   not raise the archive protocol, so an old payload is recognised by its fields (`contentDefinition` and no `contentCdl` / `bodiesCdl` / `rulesCdl`).
3. **Scope.** Page templates: Content | Bodies | Rules. Section templates: Content | Rules. Datasets and global sets:
   Content | Rules too.
4. **Layout.** Two panels side by side — CDL tabs left, OCTL tabs (one per channel) right — stacking on narrow panes.
   Inherited editors/bodies read-only on their tab; metadata and pagination paths above the panels; Save in the header.
5. **One save, one revision.** The template save sends the CDL and every channel (`channelSources`) in the existing
   `PUT`; adding/removing a channel is staged until that save. Global sets: one Save for values and schema (a schema
   change carries the edited values, one version). Datasets already saved schema and record templates together.
6. **Per-field diagnostics.** Every diagnostic names its source in `field` (`content`, `bodies`, `rules`,
   `channel:<key>`) with a line relative to it; every tab shows an error count and an unsaved dot; buffers survive tab
   switches; a failed save opens the first failing tab; `Ctrl/Cmd+S` saves.

## Tasks

| id | title | status |
|---|---|---|
| M34.1 | [CDL sections in the compiler](001-cdl-sections-compiler.md) | done |
| M34.2 | [Payload, API and domain on sections](002-sections-api.md) | done |
| M34.3 | [Global set: schema and values in one save](003-global-set-one-save.md) | done |
| M34.4 | [UI: tabs, split view and one save](004-ui.md) | done |
| M34.5 | [Spec, docs and journeys](005-docs-journeys.md) | done |
