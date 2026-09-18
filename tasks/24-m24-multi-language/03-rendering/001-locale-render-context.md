---
id: M24.3.1
status: done
depends: [M24.2.1, M16.2.2]
epic: m24-multi-language
feature: rendering
area: backend
---

# M24.3.1 — Locale in `RenderContext`: fallback resolution, meta keys, filters, `CMS_LOCALES`

## Context

`RenderContext.builder()` (`server/sf-template/.../template/render/RenderContext.java`)
holds `channel, escaping, values, pageValues, meta, urlResolver, blockResolver` (+ the
`AssetValueResolver` from `M16.2.1`). `OctlRenderer.resolve` looks up `CMS_PAGE` →
loop vars → `$CMS_SET` vars → `context.values()`. Meta keys are set in
`GenerationRenderer` (~l.154–160) and `PageRenderService` (~l.167–173): `uid, uuid,
displayName, path, revision, channel, projectKey`. `Filters.java`: `date` uses
`DateTimeFormatter.ofPattern(pattern).withZone(UTC)` (JVM default locale — output
depends on the server), `number` uses `DecimalFormatSymbols.getInstance(Locale.ROOT)`,
`upper`/`lower`/`capitalize` use `Locale.ROOT`. Spec §16.8 shows
`<html lang="$CMS_META(language)$">` which renders empty today.

## Goals

- `RenderContext` gains `locale` (`String`, nullable = non-localized) and `localeChain`
  (`List<String>`), propagated into nested section/include/catalog/navigation contexts
  built by `GenerationRenderer.renderSection` and `PageRenderService`.
- **Value resolution:** wherever `OctlRenderer` obtains an editor value (`values`,
  `pageValues`/`CMS_PAGE`, loop items, cross-asset `AssetValueResolver`), an L10N wrapper
  is resolved via `L10nValues.resolve(node, localeChain)` **before** accessor traversal
  and filters — so `$CMS_VALUE(heroImage.altText)$`, `$CMS_IF(headline)$`,
  `$CMS_FOR(link : links)$` with localizable leaves, and `| size` all see the resolved
  value. Truthiness of an unresolvable localizable value is `false`.
- **Meta:** `$CMS_META(locale)$` → the BCP 47 tag (`de-CH`), `$CMS_META(language)$` →
  the language subtag (`de`); both empty for non-localized projects. Add both to the
  compiler's known meta keys.
- **Filters:** `date` and `number` use the render locale when present, `Locale.ROOT`
  otherwise (fixes the JVM-default nondeterminism in both cases); `upper`/`lower` use the
  render locale (Turkish `i` correctness) when present. Optional second arg on `date`
  (`date("d. MMMM yyyy", "en")`) overrides the locale explicitly.
- **Language switcher:** new reserved iterable `CMS_LOCALES` for `$CMS_FOR`, items
  `{code, language, label, current, href}` where `href` is the **current page** in that
  locale via the `urlResolver` (relative, per `GenerationRenderer.relativeUrl` — see
  `tasks/lessons.md`); `href` empty in preview when that locale has no URL. Whitelist the
  root in `OctlCompiler.checkAccessorRoot`.
- **Media + navigation:** media metadata and nav labels (`NavigationTreeJson`,
  `NavigationHtmlRenderer`) resolve per render locale (M24.2.2 made them L10N-capable).
- Golden tests: `render/l10n-fallback`, `render/l10n-filters`, `render/l10n-locales-loop`
  (content with L10N values + a render locale supplied by the runner; extend
  `GoldenFileRenderTest` to read an optional `context.json` with `locale`/`localeChain`).

## Acceptance criteria

- [x] `de-CH` render of a value `{de:"Strasse", en:"Street"}` with chain `[de-CH, de, en]`
      outputs `Strasse`; a value only in `en` outputs `Street`; no value → empty and
      `$CMS_IF$` false.
- [x] `date("d. MMMM yyyy")` on `2026-10-03` renders `3. Oktober 2026` for `de` and
      `3. October 2026` for `en`; `number("#,##0.00")` renders `1.234,50` for `de` and
      `1,234.50` for `en`; results are identical regardless of the JVM default locale
      (test sets `Locale.setDefault` to something else).
- [x] `$CMS_META(language)$` in the §16.8 example renders `de`.
- [x] `CMS_LOCALES` loop renders a switcher with `current` set on the active locale.
- [x] Non-localized project: all existing golden tests unchanged; new filters behavior
      with no locale matches previous output for `number` and, for `date`, uses
      `Locale.ROOT` (document the change if any existing golden depends on JVM locale).
- [x] `./gradlew :server:sf-template:test :server:sf-generate:test :server:sf-domain:test`
      green.

## Out of scope

- Planning/fan-out and output paths (M24.3.2) — here `CMS_LOCALES.href` uses whatever
  URL resolver the caller provides.
- Locale-aware globals/datasets/pagination/search (M24.3.3).

## Notes / hazards

- Resolve L10N **once** at value lookup, not inside each filter — otherwise `json` / `raw`
  filters would leak the wrapper into output.
- The `json` filter on a whole content object containing localizable leaves must emit
  resolved values, not wrappers (templates exporting data for JS).

## Implementation notes (2026-09-17)

- `RenderContext` carries `locale`, `localeChain` and the `CMS_LOCALES` scope. The chain stays a
  plain `List<String>` so `sf-template` still does not depend on `sf-domain`.
- Resolution happens **once**, in `OctlRenderer.resolve` (and at each step of `resolveSub`, so
  `heroImage.altText` walks *through* a wrapper). A container value handed to `| json` is resolved
  deeply, so no wrapper can reach the output.
- Filters gained an optional locale: `Filter.apply(value, args, locale)`, with `date`, `number`,
  `upper`, `lower` and `capitalize` overriding it. **Behaviour change:** `date` used to format with
  the JVM default language and is now deterministic (render language, else `Locale.ROOT`).
  `Locale.ROOT` abbreviates month names, so a single-language project's `MMMM` renders `Oct`
  instead of the server's spelled-out month; `date("d. MMMM yyyy", "en")` restores it. Documented
  in `docs/template-developer-guide.md` §2.12.
- `LocaleRenderScope` (sf-domain `project`) builds the locale meta + `CMS_LOCALES` items once for
  both generation and preview.
- Golden cases `l10n-fallback`, `l10n-filters`, `l10n-locales-loop`; `GoldenFileRenderTest` reads
  an optional `context.json`. Unit tests in `LocaleRenderTest`, including a JVM-default-independence
  check.
