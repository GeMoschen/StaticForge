---
id: M24.2.1
status: done
depends: [M24.1.1, M16.5.2]
epic: m24-multi-language
feature: cdl-storage
area: backend
---

# M24.2.1 — `localizable` CDL attribute, L10N value shape, per-locale validation

## Context

`EditorDefinition` (`server/sf-template/.../template/content/EditorDefinition.java`) is a
record of `name, type, label, help, required, readOnly, hidden, defaultValue, min, max,
maxLength, maxChars, pattern, patternMessage, mimeTypes, assetTypes, options, features,
allow, visibleWhen, renamedFrom, items` — no locale concept. `CdlParser`/`CdlCompiler`
(`template/cdl`) build it; `CdlValidator` emits `SF-CDL-*` diagnostics
(`template/diagnostic/DiagnosticCodes`). `ContentValidator.validate(def, content)`
(`sf-domain/.../asset/content`) is wired into saves by `M16.5.2`. Values live in
`payload.content.<editor>` (pages), `bodies.<body>[].content` (sections), and — after
M17/M19 — global set and record payloads.

## Goals

- CDL: new flag attribute `localizable` (no value) on any editor.
  - Allowed on leaf types: `text, textarea, richtext, markdown, number, boolean, date,
    datetime, select, multiselect, color, link, media, reference, json` (confirm against
    `EditorType` at implementation time).
  - Rejected on `group`, `list`, `catalog`, and the `pagination` type from M21 (a
    pagination source is structural) with a new `SF-CDL-0107` "container editor cannot be
    localizable" error; leaf editors inside a `list` item or `group` may be localizable.
  - `EditorDefinition` gains `boolean localizable`; the compiled-definition JSON the UI
    reads (`compiledDefinition`) includes it.
- Value shape: `{type:"L10N", values:{<localeCode>: <leaf value>}}`; a shared helper
  `L10nValues` in `sf-common` or `sf-template` (`isL10n(node)`, `get(node, locale)`,
  `resolve(node, chain)`, `with(node, locale, value)`, `wrap(value, defaultLocale)`,
  `unwrap(node, defaultLocale)`) used by validator, renderer, migration and search
  extraction — one implementation, no ad-hoc JSON poking.
- `ContentValidator`:
  - for a localizable editor, require the wrapper shape; validate each present locale's
    value with the existing type rules (`maxLength`, `pattern`, `min`/`max`, …);
  - `required` is enforced for the **default locale only**; other locales may be empty
    (they fall back);
  - keys that aren't declared project locales are a **warning** issue, not an error
    (values survive locale removal, see M24.1.1);
  - a non-localizable editor holding a wrapper, or a localizable editor holding a bare
    value, is an error (the migration in M24.2.2 guarantees neither exists after save).
- `ContentReferenceService.materialize` (and its M16.3 save-time replacement) recurses into
  `values` so `MEDIA_REF`/`CONTENT_REF` edges from every locale are recorded; the
  `source_path` includes the locale segment (e.g. `content.hero.values.en`).
- Diagnostics documented in `docs/template-developer-guide.md` §3.2 table (doc update is
  M24.6.1, but add the constant + message here).

## Acceptance criteria

- [x] CDL unit tests: `localizable` parsed on `text`; `SF-CDL-0107` on `list`, `group`,
      `catalog`; accepted on a `text` inside a `list` item.
- [x] `L10nValues` unit tests: resolve via chain, missing locale → next in chain → `null`,
      `wrap`/`unwrap` round-trip.
- [x] `ContentValidator` tests: per-locale `maxLength` violation reports the locale in the
      issue path; required only checked on default locale; unknown locale key → warning.
- [x] Reference materialization records a media reference that exists only in the `en`
      value.
- [x] Projects without locales: a template using `localizable` still compiles, values stay
      bare, and the validator treats `localizable` as inactive while
      `!LocaleConfig.isLocalized()` (no wrapper required, a wrapper is an error). Test
      covers this.
- [x] `./gradlew :server:sf-template:test :server:sf-domain:test` green.

## Out of scope

- Migrating existing content when the flag or project locales change (M24.2.2).
- Rendering (M24.3.1), UI (M24.4.1).

## Notes / hazards

- The "inactive in non-localized projects" rule means enabling project locales must also
  wrap existing values of already-`localizable` editors — M24.2.2 owns that trigger too.
- `visibleWhen` expressions (`ExpressionEvaluator`, shared fixture with the Angular form
  engine) that reference a localizable editor must evaluate against the **current editing
  locale's resolved value** in the UI and the **default locale** on the server; add a
  shared fixture case so both sides agree.
- `JsonDiffer` needs no change (it diffs paths generically, e.g.
  `content.headline.values.de`), but verify the diff output with one test so the UI task
  can rely on the path shape.

## Implementation notes (2026-09-17)

- Diagnostic code is **`SF-CDL-0112`**, not the proposed `SF-CDL-0107` (taken by
  `CDL_NOT_ALLOWED_IN_GLOBAL_SET` in M17). Catalogued in
  `docs/template-developer-guide.md` §2 diagnostics table.
- `L10nValues` lives in `sf-common` (every other module already depends on it) and also
  carries `resolveDeep`/`containsL10n`, which M24.3.1 and M24.4.2 need.
- The project's locale configuration reaches the validator as
  `asset/content/LocalizationContext`, built in `RecordDatasets.validator(projectId)` from
  the new `ProjectLocales` component — no `ProjectService` dependency, so the bean graph
  stays acyclic.
- `ContentReferenceService.extract` needed **no change**: its generic object walk already
  descends into `values`, producing `content.hero.values.en`. Locked in by two new tests.
