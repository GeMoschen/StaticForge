---
id: M30.2.3
status: done
depends: [M30.1.3]
epic: m30-quality-checks-and-redirects
feature: rules
area: backend
---

# M30.2.3 — Accessibility rules (`SF-CHK-0301`–`0308`)

## Context

`generate/quality/` page rules, spec §24.7 (WCAG 2.2 AA baseline for the app; these rules cover the *generated* site),
media `altText` (localizable, `MediaServiceImpl:272`–`:282`) and `altOverride` (shape-validated only,
`ContentValidator:605`). Rule catalogue in the feature README.

## Goals

- `0301` `img` without an `alt` **attribute** (`alt=""` is a valid decorative image and passes); also `input[type=image]`
  without `alt`. The message names the media asset when the `src` resolves to a media output (so the editor knows which
  file lacks alt text).
- `0302` `a[href]` whose accessible name is empty: no text, no `aria-label`/`aria-labelledby` (resolving to non-empty
  text), no `img[alt]` with text inside, no `title`.
- `0303` `button` (and `[role=button]`) with the same test.
- `0304` heading levels must not increase by more than one (`h2` → `h4`); the first heading may be any level.
- `0305` an `id` value used more than once in the document (one finding per duplicate value, listing the count).
- `0306` `input` (not `hidden|submit|button|reset|image`), `select`, `textarea` without `label[for]`, wrapping `label`,
  `aria-label`, `aria-labelledby` or `title`.
- `0307` `iframe` without non-empty `title`.
- `0308` `<html>` without a non-empty `lang`.
- Rule fixtures under `quality/a11y/`.

## Acceptance criteria

- [x] Positive and negative fixture per rule, incl. `aria-labelledby` pointing at a missing id (fails), nested
      `img[alt]` inside a link (passes), `alt=""` (passes `0301`, but a link containing only that image fails `0302`).
- [x] `0301` message names the media uid when resolvable.
- [x] `./gradlew build` green.

## Out of scope

- Colour contrast, focus order, keyboard traps and anything needing computed styles or a browser; ARIA role validity
  beyond the name checks above.

## Notes / hazards

- The rules check the markup the templates produce; a finding may be fixed by content (alt text on the media) or by the
  template (a hard-coded icon link). Say which in each rule's `description` so the UI can hint "fix in content" vs "fix in
  template".
- Done: rules in `generate/quality/rules/a11y/` (`MissingAltRule`, `LinkWithoutTextRule`, `ButtonWithoutTextRule`,
  `SkippedHeadingLevelRule`, `DuplicateIdRule`, `UnlabelledFormControlRule`, `IframeWithoutTitleRule`,
  `MissingDocumentLangRule`), shared name test `AccessibleNames`; fixtures in `quality/a11y/`; tests
  `AccessibilityRulesTest` (harness) and `AccessibilityRulesIntegrationTest` (real build: media uid, hold-back).
- Deviation: "fix in content" vs "fix in template" is also machine-readable: `QualityRule.fixHint()` returns
  `QualityFixHint` (`CONTENT`, `TEMPLATE`, `CONTENT_OR_TEMPLATE`; default `TEMPLATE`), exposed as `fixHint` in
  `GET /quality-rules`. `SF-CHK-0001` is `TEMPLATE`. The description still says it in words.
- Hidden elements (`hidden`, `aria-hidden="true"` on it or an ancestor) are skipped by `0302`/`0303`/`0306`/`0307`
  (they need no name); `0301` is not (HTML requires `alt` regardless). `a[role=button]` is left to `0303`.
