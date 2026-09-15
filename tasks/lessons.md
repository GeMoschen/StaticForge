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
