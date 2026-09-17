---
id: M23.1.2
status: done
depends: [M23.1.1]
epic: m23-global-search
feature: index-core
area: backend
---

# M23.1.2 — Text extraction per asset type

## Context

- **Pages.** Payloads are `{templateRef, content:{<editor>:value}, bodies:{<body>:[{instanceId,
  templateRef, content}]}, nav, output, meta}` (`PageServiceImpl.create`). Editor value shapes
  are documented per type in `docs/editors/*.md`:
  - richtext/markdown are strings;
  - `list` is an array of item objects;
  - `catalog` is `{type:"CATALOG", cards:[{instanceId, templateRef, content}]}`;
  - `reference` is `{type:"ASSET_REF", …}`;
  - links, media and so on have their own shapes.
- **Media.** The payload has `fileName, mimeType, altText, caption, copyright` (`MediaServiceImpl.buildPayload`).
- **Templates.** The payload has `contentDefinition` (CDL source) and `channelTemplates.<ch>.source`
  (`TemplateServiceImpl.buildPayload`).
- **Navigation.** `PAGE_REFERENCE` payloads carry `label`.
- **Folders.** Folders carry a display name plus `scope`/`protected`.
- `HtmlBlockSplitter` (revision diff) and the `stripTags`/`plain` filters (`Filters.java`) already
  turn HTML into text. Reuse one of them rather than adding a third HTML-to-text implementation.

## Goals

- `SearchTextExtractor` interface: `boolean supports(AssetType)` +
  `SearchDocument extract(IndexableAsset asset, ExtractionContext ctx)`.
  - `IndexableAsset` carries uuid, type, uid, displayName, folderPath, templateUuid, revision and
    payload. It is built from the current `AssetVersion`, so there is no dependency on sf-generate's
    `Snapshot`.
  - `ExtractionContext` gives lazy access to a template's `ContentDefinition` by UUID (through the
    `M16.1.1` cache) and to blob text (for `M18` processed media).
- `SearchTextExtractorRegistry` (Spring bean) collects every extractor. An unsupported type logs
  once and yields no document; it must not fail the indexing batch.
- **Extractors for current types:**
  - `PageTextExtractor`:
    - Walks `content` and every `bodies.*[].content` using the owning template's / section
      template's `ContentDefinition`.
    - `text`, `textarea`, `markdown`, `richtext`: plain text (tags stripped, entities decoded).
    - `select`/`multiselect`: option labels.
    - `list`: recurses into `items`.
    - `catalog`: recurses into each card with the card template's definition.
    - `group`: recurses.
    - `link`: label only.
    - Skips `reference`, `media`, `color`, `boolean`, `number`, `date`, `datetime`, `json`.
    - Title is display name + uid. Also includes navigation-relevant `meta` title/description if
      present.
  - `MediaTextExtractor`: fileName, altText, caption, copyright.
  - `TemplateTextExtractor` (page and section templates): display name, uid, CDL source, every
    channel's OCTL source. These go to the neutral `text` field only; no German/English stemming
    on code.
  - `PageReferenceTextExtractor`: label + display name.
  - `FolderTextExtractor`: display name only. Hidden root and protected store roots are excluded
    from the index.
- **Plug-in extractors for types added by earlier epics.** Implement each one if its type exists
  when this task is picked up:
  - `GLOBAL_SET` (`M17.1.1`): walk `content` with the set's own definition.
  - `MEDIA` with `processCms` + text content (`M18.1.2`): include decoded file text, capped by
    `sf.search.max-text-chars`.
  - `DATASET` (schema: display name, uid, CDL) and `RECORD` (`M19.1.1`): walk `content` with the
    dataset's definition.

  If a type is missing, add a follow-up task in that epic's feature rather than silently skipping it.
- Cap total extracted text per document at `sf.search.max-text-chars`; truncate at a word
  boundary.

## Acceptance criteria

- [x] Unit tests per extractor on representative payloads:
      - a page with a rich-text editor containing `<p>Hello <strong>world</strong></p>` extracts
        `Hello world`;
      - a page with a nested list inside a catalog card extracts the inner text;
      - a section instance's content is included;
      - reference/media/json values are not included;
      - a media item's alt text and caption are included;
      - a template's CDL and OCTL sources are included, OCTL in the neutral field only;
      - a page reference's label is included;
      - store root folders produce no document.
- [x] An unknown editor name in `content` (stale value after a CDL change) is ignored, not an
      exception. A missing template definition falls back to "index every string leaf" with a
      debug log.
- [x] The HTML-to-text conversion reuses an existing utility (`HtmlBlockSplitter`,
      `Filters` stripTags/plain, or a shared helper extracted into `sf-common`). There are no
      duplicated regexes.
- [x] Extractors for `GLOBAL_SET`, processed text media and `DATASET`/`RECORD` exist with tests,
      or the missing type is recorded as a follow-up task in the relevant epic.
- [x] `./gradlew :server:sf-domain:test` is green.

## Out of scope

- Writing extracted documents to the index on save (`M23.2.1`).
- Locale-keyed (`L10N`) values. Once `M24.2.1` lands, `M24.3.3` changes page, global set and record
  extraction to emit per-locale fields.
- OCR or PDF text extraction for binary media.

## Notes / hazards

- **Extraction must be pure and fast.** It reads one current version and at most a cached
  `ContentDefinition`. A 5,000-page rebuild must not recompile CDL 5,000 times; that is why this
  depends on `M16.1.1`.
- Do not index secrets. Channel `settings` and target `config` are not assets and are not
  indexed. Nothing outside asset payloads is extracted.
- Rich-text values are sanitized HTML from the editor, but treat them as untrusted anyway: parse,
  don't render. Snippets returned by `M23.3.1` are built from the extracted plain text, never from
  the raw HTML.
