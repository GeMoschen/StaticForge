# Feature: Locale editing UI

**Spec:** Extends §23.5 (dynamic form engine), §23.6 (page editor layout), §24.5 (core
screens), §24.7 (accessibility), §19.3 (preview affordances), §7.6 (diff view).

## Goal

Let editors work in one locale at a time everywhere content is edited — pages and
sections, global sets, dataset records, media metadata, navigation labels — see which
values are inherited through fallback, preview a locale, and find missing translations.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-editor-locale-switcher.md](001-editor-locale-switcher.md) | M24.1.2, M24.2.2, M24.3.2, M17.4.1, M19.4.2 |
| 2 | [002-missing-translation-indicators.md](002-missing-translation-indicators.md) | 1 |

## Feature exit criteria

- [ ] A global editing-locale switcher drives every content form; localizable fields show
      the locale and fallback state; non-localizable fields are marked "all languages".
- [ ] Preview and share links use the editing locale; the revision diff labels locale
      paths.
- [ ] Missing translations are visible per field, per page and in the page tree.

## Dependencies

`M24.1.2` (`LocalesStore`), `M24.2.2` (migration confirm flows), `M24.3.2` (preview
locale), `M17.4.1` (globals UI), `M19.4.2` (record editor), `M3` form engine
(`sf-content-form`, `FormBuilderService`, `EDITOR_REGISTRY`), `M15.5` time-travel
read-only.
