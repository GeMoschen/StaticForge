# Lessons

## Generated links: relative to the current page (2026-09-15)
- **Mistake:** when page links broke on nested pages, I offered "relative" vs "root-absolute", the user first picked
  root-absolute, and I changed every generated link to `/…`. The user then corrected it: links inside a page must
  always be resolved relative to the current page.
- **Rule:** generated output links (navigation, `$CMS_REF` page/folder/media) are relative to the rendering page's
  output path (`GenerationRenderer.relativeUrl`). Don't switch to root-absolute or site-root-relative forms.
- **Rule:** for output-format choices that users will see in every generated page, show a concrete rendered
  example from *their* site structure (e.g. what `pf/pf1/p3.html` would contain) before implementing, and
  verify the generated site with a link checker (resolve each href against its page), not only by reading HTML.

## Don't ship known gaps as "limits" (2026-09-16)
- **Mistake:** at the end of M21 I reported three things as deviations/limits instead of fixing them: `paginationPath`
  only settable through the API, the page editor overflowing a 1280 px window ("pre-existing"), and a plain dropdown
  source picker with the "N items → M pages" hint dropped because it "would need a new endpoint". The user asked for
  all three to be fixed.
- **Rule:** a task-file goal I can't meet the cheap way is still a goal: build what it needs (a small endpoint, an
  extension of the shared picker) or ask before dropping it. Never trade a stated feature for a "limit" line.
- **Rule:** a layout defect that I observe in my own screenshots and that affects the feature I'm shipping gets fixed
  (root cause, e.g. a flex item missing `min-width: 0`), even when it predates the milestone. Assert it in the journey
  (elements in viewport at the target width) so it can't come back.

## A `default` interface method is not behind the Spring proxy (2026-09-17)
- **Mistake:** adding `confirmDiscard` overloads to `TemplateService`/`GlobalSetService`/`DatasetService`/
  `PageReferenceService`/`UrlRegistryService`, I kept the old signature as a `default` method delegating to the new
  `@Transactional` one. A default method calls the implementation directly (self-invocation), so the transactional
  proxy is bypassed: an unconfirmed save that *threw* to roll itself back had already committed its writes. Caught by
  a test asserting the revision counter was unchanged.
- **Rule:** when adding an overload to a Spring service interface, declare **both** overloads abstract and implement
  both in the impl with `@Transactional`. Never a `default` method that delegates into annotated behaviour — same for
  `@Cacheable`, `@PreAuthorize` and every other proxy-based annotation.
- **Rule:** "throw to roll back" only works when a transaction is actually open. Assert the rollback (revision count,
  stored value) in the test, don't assume it.

## Compare boxed ids with `equals`, not `==` (2026-09-17)
- **Mistake:** two integration tests filtered with `asset.getProjectId() == project.getId()` (both `Long`). That is an
  identity comparison; it only worked because the ids stayed inside the `Long` cache (−128..127). Adding one more test
  class pushed project ids past 127 and the filters silently matched nothing, failing a test that had nothing to do
  with my change.
- **Rule:** never `==` on boxed types. `Objects.equals(a, b)`, or compare primitives. When an unrelated test starts
  failing after adding fixtures, suspect a latent boxed comparison or another test-order dependency before suspecting
  the feature.

## Don't run Gradle while a Gradle build is in flight (2026-09-17)
- **Mistake:** I started a long `./gradlew test` in the background and kept compiling in the foreground. The
  concurrent build rewrote `sf-api.jar` mid-run, and the suite reported ~10 unrelated "Failed to load
  ApplicationContext" failures that did not exist.
- **Rule:** while a background Gradle task runs, do non-Gradle work (docs, UI, reading). Re-run the suite cleanly
  before believing any failure list.

## A `<select>` that shows an option the model never chose (2026-09-18)
- **Mistake:** the Languages tab kept `defaultLocale` in a signal that only the select's `(change)` handler ever
  wrote. After adding the first language the select *displayed* it (a browser's fallback for an unmatched `[value]`),
  but the signal was still empty, so validation kept reporting "Pick the default language." and the save button never
  enabled. The M24 journey hid this by calling `selectOption('de')` explicitly — a step no real user performs.
- **Rule:** when a control renders an implicit default, model that default explicitly (a `computed` that falls back to
  the first option) instead of waiting for a change event that will never fire. And never let an e2e journey click
  something a real user would not: that click is the bug's hiding place.
- **Rule:** a Save button must be gated on *dirty* state as well as validity — "enabled with nothing to save" and
  "disabled with real edits" are the same missing comparison against the last server response.

## `$index` is shadowed by a nested `@for` (2026-09-18)
- **Mistake:** the Languages tab passed `$index` to `toggleFallback(...)` from *inside* the nested candidate loop,
  so Angular resolved it to the candidate's index, not the row's. Ticking "DE" as a fallback for EN wrote the
  fallback onto row 0 (de), which then reported "'de' cannot fall back to itself." — an error pointing at the wrong
  row and the wrong cause.
- **Rule:** the moment a `@for` is nested inside another, alias the outer index (`let rowIndex = $index`) and use the
  alias throughout the outer block. Implicit contextual variables are the first suspect whenever an action lands on
  the wrong item of a list.
