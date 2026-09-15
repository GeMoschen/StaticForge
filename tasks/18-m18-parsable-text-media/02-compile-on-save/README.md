# Feature: Compile on save

**Spec:** Extends §16.10/§16.11 (OCTL engine and diagnostics) to a new compile context, "text
media", and §5.4 (reference integrity) to references made from processed media.

## Goal

Processed text media gets the same "errors are caught when you save, not at build time"
guarantee that templates already have (`TemplateServiceImpl.compileChannel` throws 422
`SF-API-0422` with diagnostics). Every save that affects the OCTL source of a processed file
compiles it:

- switching `processCms` on
- a text write while the flag is on
- a `replace` while the flag is on

References the source makes (`global:`, `page:`, `media:`, `nav:` …) are recorded as
`asset_reference` rows in the same revision. That makes usages accurate and gives the
incremental planner (`M18.3.1`) the edges it needs.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-validate-and-materialize-references.md](001-validate-and-materialize-references.md) | `M18.1.2`, `M16.3.1` |

## Feature exit criteria

- [ ] Saves that produce OCTL errors return 422 with diagnostics and create no revision.
- [ ] Warnings (`$$` occurrences, `$CMS_VALUE` in JS/JSON without an escaping filter) are
      returned on a successful save.
- [ ] Instructions that make no sense outside a page (`$CMS_BODY`, `$CMS_INCLUDE`, the HTML
      leaf form of `$CMS_NAVIGATION`) are compile errors in the text media context.
- [ ] Each processed media save writes its outgoing reference rows and closes the previous
      ones, in the same revision. Switching the flag off closes them all.

## Dependencies

`M18.1.2` (the text write path this hooks into). `M16.3.1` (reference rows written on save and
closed on change: the shared mechanism, not a media-only copy). `M16.1.1` is recommended so
the compile result can be cached, but it doesn't block this feature.
