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
