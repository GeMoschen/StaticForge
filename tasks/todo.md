# M24 implementation — Plan

Branch `m24-multi-language` (off `master` at `05639f8`). Baseline verified: `./gradlew build -x test` green.

## Approach

Sequential, in the epic's dependency order. Each task is implemented, then its module tests are run before the
next starts. One shared value helper (`L10nValues`) and one config value type (`LocaleConfig`) are introduced
first so nothing pokes at L10N JSON ad hoc.

## Design (from reading the code)

- **`LocaleConfig`** — immutable record in `sf-domain` `project` package: `List<ProjectLocale(code,label)> locales`,
  `String defaultLocale`, `Map<String,List<String>> fallbacks`, `boolean defaultWithoutPrefix`. `EMPTY`,
  `isLocalized()`, `effectiveChain(locale)`, `normalize()`/`validate()` returning field errors. Stored on
  `Project` as a JSON column `locale_config` (`@JdbcTypeCode(SqlTypes.JSON) JsonNode`), precedent
  `output_channel.settings` (changelog `010`, dbms-paired postgresql JSONB / h2 JSON). Next free changelog: `017`.
- **`L10nValues`** — in `sf-common` (depended on by template, domain, generate, api): `isL10n`, `get`,
  `resolve(node, chain)`, `with`, `wrap`, `unwrap`, `locales(node)`. Wrapper shape
  `{"type":"L10N","values":{...}}`, mirroring the existing typed-value convention.
- **Render locale** stays primitive in `sf-template` (`String locale`, `List<String> localeChain`) so
  `sf-template` keeps not depending on `sf-domain`.
- Project settings are not versioned rows (epic Notes) — `updateLocales` overwrites in place and allocates one
  `UPDATE` revision, exactly like `ProjectServiceImpl.update`.

## Steps

- [x] M24.1.1 `LocaleConfig`, `locale_config` column + changelog 017, `ProjectService.updateLocales/locales`,
      `GET/PUT /projects/{key}/locales`, OpenAPI + `schema.d.ts`
- [x] M24.1.2 Project Settings → Languages tab, `LocalesStore`, URL-change confirmation
- [x] M24.2.1 `localizable` CDL attribute + `SF-CDL-0107`, `L10nValues`, per-locale `ContentValidator`,
      reference materialization through `values`
- [x] M24.2.2 localizable toggle migration (template-driven + project-driven), localizable media metadata and
      navigation labels
- [x] M24.3.1 locale in `RenderContext`, fallback resolution, `$CMS_META(locale|language)$`, locale-aware
      `date`/`number`/`upper`/`lower`, `CMS_LOCALES` iterable, golden tests
- [x] M24.3.2 plan fan-out page × channel × locale, `{locale}` placeholder + `SF-GEN-0111`, URL registry
      `locale_key`, hreflang, locale-narrowed incremental, preview/share locale
- [x] M24.3.3 locale-aware globals, datasets, pagination, search
- [x] M24.4.1 editing-locale switcher, form engine L10N binding, fallback display, preview locale, diff labels
- [x] M24.4.2 `TranslationStatusService` + missing-translation indicators
- [x] M24.5.1 locale settings in archives, protocol bump, locale conflict analysis
- [x] M24.6.1 docs, `m24-journeys.spec.ts`, regression pass

## Review

**Branch:** `m24-multi-language` (off `master` at `05639f8`). Not committed.

### What shipped

Locale is a content dimension of one project, opt-in per project:

- **Configuration** — `LocaleConfig` on `project.locale_config` (changelog `017`), `GET/PUT
  /projects/{key}/locales`, and a **Languages** settings tab that warns with a real before/after path of
  one of the project's own pages before an edit that moves every URL.
- **Storage** — the CDL flag `localizable` (`SF-CDL-0112` on containers), the
  `{"type":"L10N","values":{…}}` wrapper behind the single `L10nValues` helper, per-language validation
  (`required` on the default language only, an undeclared language is a warning), and one normalizing
  migration for all four triggers, in one compound revision, refusing to discard translations unconfirmed.
- **Rendering** — render locale + fallback chain in `RenderContext`, resolution done once at value lookup,
  `$CMS_META(locale|language)$`, the `CMS_LOCALES` switcher, and language-aware `date`/`number`/`upper`/`lower`.
- **Generation** — plan fan-out page × channel × language, the `{locale}` path placeholder with
  "default language without prefix", `SF-GEN-0111`, per-language URL registry rows, `hreflang` +
  `x-default` in the sitemap, and incremental runs narrowed to the language that actually changed.
- **Stores** — dataset `where`/`sort` on resolved values with language collation, per-language search
  fields and `?locale=`, globals and pagination following automatically.
- **UI** — one editing-language switcher driving every content form, the preview, share links, media alt
  text, navigation labels, the search palette and the diff labels; fallback hints with *Copy from …*;
  missing-translation counts.
- **Export/import** — protocol 6 carries the configuration, translations round-trip, mismatches are warnings.

### Verification

- `./gradlew build` green (compile, Spotless, ~410 backend tests, frontend bundle).
- `npm run build` green.
- New backend coverage: `LocaleConfigTest`, `L10nValuesTest`, `LocalizableCdlTest`,
  `LocalizableContentValidatorTest`, `LocalizationMigratorTest`, `LocaleRenderTest`,
  `LocalizedDatasetQueryTest`, `ProjectLocalesApiTest`, `LocalizationMigrationIntegrationTest`,
  `LocalizedGenerationIntegrationTest` (incl. a link check over the generated output),
  `TranslationStatusIntegrationTest`, `LocalizedExportImportIntegrationTest`, plus three golden render cases.
- UI unit tests, measured both ways against `master` at the same commit: `npx vitest run` is
  **85 failed / 236 passed of 321** here and **85 failed / 222 passed of 307** on `master` — the same 85
  files fail before and after (the pre-existing `templateUrl` / `resolveComponentResources()` runner
  issue), and all 14 new specs pass. `project-settings-locales.util.spec.ts` runs for real because the
  pure logic lives outside the component. One file I broke on the way — `search.service.spec.ts`, from
  injecting a store into `SearchService` and so dragging `ApiClient` into its injector — is fixed: the
  palette passes the language with the query instead.
- `ui/e2e/m24-journeys.spec.ts` collects; **not executed** (no seeded dev backend here), as for every
  journey since M5.

### Deviations from the task files

- The container diagnostic is **`SF-CDL-0112`**, not the proposed `SF-CDL-0107` (taken by M17).
- Export protocol version is **6**, not 4 (M17/M19 had already bumped it).
- `date` in a project without languages now formats with `Locale.ROOT` instead of the JVM default, so
  `MMMM` renders `Oct` rather than the server's spelled-out month. This is the determinism fix the task
  asked for; `date("d. MMMM yyyy", "en")` restores the long form. Documented in the developer guide.
- Generating a **past** revision uses the **current** language configuration, because project settings
  aren't versioned rows — the limitation the epic Notes called for rather than versioning settings here.

### Defects found and fixed while building this

- `default` interface methods bypass Spring's transactional proxy, so an unconfirmed save that threw to
  roll itself back had already committed. All five affected services now declare both overloads abstract.
- `CarryForward` keyed page outputs without the language, so an incremental run of a localized project
  carried forward one language per page and silently dropped the others.
- Two integration tests compared `Long` ids with `==`; that only worked while ids stayed inside the
  `Long` cache, and the new fixtures broke it. Both are in `tasks/lessons.md`.
