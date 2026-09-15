# M24 — Multi-language (locale as a content dimension)

**Spec:** Reverses the v1 non-goal in §2.2 ("No multi-language content variants as a
first-class dimension") and resolves Appendix C **Q2** (deferred to v2) as a first-class
content dimension. Touches §8.1 (project), §14 (CDL — new `localizable` attribute), §11.3
(media metadata), §16 (OCTL — locale scope, `$CMS_META(language)$` already shown in the
§16.8 example but never implemented), §17 (navigation labels), §18 (generation fan-out,
output paths, §18.6 performance), §19 (preview), §20 (REST), §24 (editor UX), §26.5
(export/import). Not part of the original §27 roadmap — inserted after `M16`–`M23` because
it cuts across every feature they add (global store, content store, pagination, search).

## Goal

Today a project has exactly one language. Every editor value is a single JSON value in
`payload.content.<editor>`, `Filters.date` formats with the JVM default locale,
`Filters.number` with `Locale.ROOT`, and the only way to publish two languages is a second
project or a folder convention (§2.2).

This milestone makes **locale** a first-class dimension using the per-editor model
(FirstSpirit-style "language-dependent" editors), decided by the user on 2026-09-15:

- A project declares an ordered list of **locales** (BCP 47 tags, e.g. `de`, `en`,
  `de-CH`), one **default locale**, and a per-locale **fallback chain**
  (`de-CH → de → default`).
- A CDL editor opts in with the `localizable` attribute. Its stored value becomes
  `{type:"L10N", values:{de:…, en:…}}` inside the **same** page (or section, global set,
  record). Page structure — bodies, section order, catalog cards, list items — is shared by
  all locales; only leaf values vary.
- Generation fans out **page × channel × locale**. A new `{locale}` output-path
  placeholder is available; when locales are enabled the default path pattern prefixes
  every locale (`de/about.html`, `en/about.html`), and a project setting **"default locale
  without prefix"** puts the default locale at the root. `hreflang` alternates are emitted
  automatically.
- Media `altText`/`caption` and navigation `PageReference` labels become localizable.
- Editors switch locale in the page editor (and globals, records, media), see which values
  fall back, and see which pages have missing translations.

**Invariant:** a project with **no locales configured** behaves byte-for-byte as today —
same payloads, same output paths, same URL registry rows, same plan size. Locales are
opt-in per project.

## Exit criteria (epic is done when)

- [ ] A project admin can configure locales, default locale, fallback chains and "default
      locale without prefix" in Project Settings; the change produces a revision and is
      read-only in time travel.
- [ ] A developer can mark any leaf editor `localizable` in CDL; container editors
      (`group`, `list`, `catalog`) reject the attribute with a CDL diagnostic, while leaf
      editors inside them may use it.
- [ ] Toggling `localizable` on/off on a template migrates every affected page/section
      value in **one** compound revision (M15 batch mechanism) without data loss.
- [ ] An editor can switch locale in the page editor, fill in translations, see fallback
      values marked as such, and see missing-translation indicators in the page tree.
- [ ] A generation run with locales `de, en` writes every page once per channel per
      locale to `{locale}`-prefixed paths (or root for the default locale when the setting
      is on), with correct relative links between same-locale pages and `hreflang`
      alternates in the page head helper and sitemap.
- [ ] `$CMS_META(locale)$`, `$CMS_META(language)$` and `$CMS_FOR(l : CMS_LOCALES)$` (a
      language switcher) work in generation and preview; `date`/`number` filters format
      per render locale.
- [ ] Preview and share links carry a locale.
- [ ] Global sets (M17), dataset records (M19), pagination (M21) and search (M23) resolve
      localizable values for the render/query locale.
- [ ] An incremental run after changing only the `en` value of one page rebuilds only
      that page's `en` entries (per channel), not every locale.
- [ ] A project with no locales produces identical output and plan to a pre-M24 build
      (golden comparison on the existing generation integration fixtures).
- [ ] The 5,000-page benchmark with 2 locales stays within the §18.6 full-build target
      scaled per plan entry (documented result).
- [ ] Export/import round-trips locale settings and L10N values; importing into a project
      with a different locale configuration reports a conflict instead of silently
      dropping values.
- [ ] `./gradlew build` and `ui` `npm run build` green; `npm test` status reported honestly
      (pre-existing `templateUrl` spec issue, see M15 exit criteria).

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [project-locales](01-project-locales/README.md) | fullstack | — |
| 2 | [cdl-storage](02-cdl-storage/README.md) | backend | 1 |
| 3 | [rendering](03-rendering/README.md) | backend | 1, 2 |
| 4 | [ui](04-ui/README.md) | frontend | 1, 2 (3 for preview locale) |
| 5 | [export-import](05-export-import/README.md) | backend | 1, 2 |
| 6 | [docs-e2e](06-docs-e2e/README.md) | qa | 1–5 |

## Dependencies

- `M15` compound revisions (`RevisionService.beginBatch`/`allocateOrJoin`) — localizable
  toggle migration.
- `M16` foundations: server-side content validation (`M16.5.2`), cross-asset values
  (`M16.2.2`), channel path settings wired into generation (`M16.4.1`), revision-aware
  references (`M16.3.3`).
- `M17` global store (`M17.3.1`), `M19` content store (`M19.3.2`, `M19.4.2`), `M21`
  pagination (`M21.3.1`), `M22` build insight (`M22.1.1` reason chains), `M23` global
  search (`M23.1.2`) — made locale-aware in `M24.3.3` / `M24.4.1`.

## Notes

- **Documentation follow-up (not tracked as a task here):** spec §2.2 non-goal and
  Appendix C Q2 ("Deferred to v2") become wrong once this ships; §14.4 (common
  attributes), §16.2 `$CMS_META` key list, §18.3 placeholders and §18.6 (targets measured
  per plan entry) need updating — the same "doc follow-up later" convention as
  `M8`/`M15`.
- **Container vs. leaf (decided in planning):** `group`, `list` and `catalog` are **not**
  localizable — structure is shared across locales. Leaf editors (text, textarea,
  richtext, markdown, link, media, reference, select, …) may be, including leaves inside
  a list item or group. A catalog card's fields come from its section template's CDL and
  follow that template's `localizable` flags. Per-locale structure ("this body only
  exists in German") is out of scope (the "hybrid" option the user did not pick).
- **Identity is locale-independent.** UID, UUID, display name, folder, template and
  navigation position stay single-valued. URL uniqueness per locale comes from the
  `{locale}` path segment, not from localized UIDs. Localized path segments (a German
  slug for an English page) are out of scope.
- **Project settings aren't versioned rows.** `Project` columns (like `allowedMimeTypes`)
  are overwritten in place, with `ProjectServiceImpl.update` allocating an `UPDATE`
  revision for attribution only. Locale config follows that precedent, so generating a
  **past** revision uses the **current** locale configuration — record this as a known
  limitation rather than versioning project settings in this epic.
- Enabling locales on an existing project changes every output URL (default pattern
  prefixes all locales). The settings UI must warn about this, and "default locale without
  prefix" is the migration path for existing single-language sites.
