# Feature: CDL `localizable` + L10N storage

**Spec:** Extends §14.4 (common editor attributes), §14.7 (compiler), §5.3 (payload
strategy), §11.3 (media payload), §17 (navigation labels), §12.3 (migration on CDL change).

## Goal

Let a template developer mark leaf editors `localizable`, store their values as a typed
L10N wrapper, validate them per locale, and migrate existing content when the flag is
toggled — in one compound revision.

```
editor text headline { label "Headline" localizable }
```

Stored value (typed wrapper, consistent with `ASSET_REF` and `CATALOG` values):

```json
"headline": { "type": "L10N", "values": { "de": "Die Parka", "en": "The parka" } }
```

A missing key in `values` means "not translated" and resolves through the fallback chain
at render time. A localizable editor's value is **always** the wrapper (never a bare value)
once migrated, so readers never guess.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-localizable-attribute-and-l10n-value.md](001-localizable-attribute-and-l10n-value.md) | M24.1.1 |
| 2 | [002-toggle-migration-media-nav.md](002-toggle-migration-media-nav.md) | 1 |

## Feature exit criteria

- [ ] `EditorDefinition` has `localizable`; the CDL compiler accepts it on leaf editors
      and rejects it on `group`/`list`/`catalog` with a diagnostic.
- [ ] `ContentValidator` validates each locale's value against the editor rules; required
      applies to the default locale only.
- [ ] Toggling `localizable` migrates all affected content in one compound revision.
- [ ] Media `altText`/`caption` and PageReference `label` accept L10N values.

## Dependencies

`M24.1.1` (locale config), `M16.5.2` (server-side content validation on save), `M15`
(compound revisions), the §12.3 rename migration precedent (`renamedFrom` in
`TemplateServiceImpl`).
