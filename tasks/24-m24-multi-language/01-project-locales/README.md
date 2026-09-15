# Feature: Project locales

**Spec:** Extends §8.1 (project), §20.2 (project endpoints), §24.5 (project settings
screens).

## Goal

Give a project an explicit, validated locale configuration that everything else in this
epic reads: the ordered locale list, the default locale, per-locale fallback chains, and
the "default locale without prefix" output setting. No locales configured means the
project is single-language, exactly as today.

Shape (stored on `Project`, same precedent as `allowedMimeTypes` added by changelog
`012-project-media-settings.xml`):

```json
{
  "locales": [ {"code": "de", "label": "Deutsch"}, {"code": "en", "label": "English"} ],
  "defaultLocale": "de",
  "fallbacks": { "de-CH": ["de"], "en": [] },
  "defaultWithoutPrefix": false
}
```

The effective fallback chain for a locale is its declared chain followed by the default
locale (deduplicated, cycle-free).

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-project-locale-config.md](001-project-locale-config.md) | — |
| 2 | [002-locale-settings-tab.md](002-locale-settings-tab.md) | 1 |

## Feature exit criteria

- [ ] `Project` carries a validated locale configuration, exposed via `GET/PUT` on the
      project and a pure `LocaleConfig` value type with `effectiveChain(locale)`.
- [ ] Updating it allocates one `UPDATE` revision like other `ProjectServiceImpl` updates.
- [ ] A Project Settings → **Languages** tab edits it, warns before URL-changing edits and
      is read-only in time travel.

## Dependencies

`M15` (`RevisionContext` on `ProjectServiceImpl`), `M5`/`M12` project settings shell.
