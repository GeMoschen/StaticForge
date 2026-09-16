# StaticForge CMS — Template developer guide

For **template developers** (persona *Dev*). Covers the two declarative languages — **CDL** (what editors fill in) and **OCTL** (how it renders) — plus the diagnostic codes you will see in Monaco and at build time.

Normative reference: `cms-specification.md` §14 and §16. This guide is a working reference with the examples from §14.2 and §16.6–§16.7, and it points each diagnostic code at the code that emits it.

## Part 1 — CDL (content definition language)

CDL declares the editors a template exposes. It lives in a section template's or page template's `contentDefinition`. You edit it in the template IDE (Monaco) and can validate it live with `POST /projects/{p}/cdl/validate`.

Full per-type reference — attributes, stored-value shape, and a rendering example for each of the
18 editor types — lives in [`editors/`](editors/README.md), one file per type (`editors/text.md`,
`editors/richtext.md`, `editors/media.md`, `editors/list.md`, `editors/catalog.md`, …); start at
[`editors/README.md`](editors/README.md) for the index, the attributes common to every type,
grouping, validation, and the full worked example (§14.2). Bodies (page templates only, §14.6) and
migration-on-rename (`renamedFrom`, §12.3) are also covered there.

Conditional visibility (§14.4) is a language feature usable on any editor, not type-specific:

```
editor text ctaLabel { label "Button label" visibleWhen "showCta == true" }
```

Grammar is deliberately tiny: `identifier (== | != | > | < | >= | <= | in) literal` with `&&`, `||`, `!`, parentheses. Evaluated by `ExpressionEvaluator` (backend) and the Angular form engine from one shared fixture file, so it behaves identically everywhere.

## Part 2 — OCTL (output channel template language)

OCTL renders content into a channel. One template per (template asset, channel). Design principles (§16.1): **text-first** (paste HTML and it works), **unmistakable `$CMS_…$` delimiters**, **safe by default** (channel escaping), **no arbitrary code** (total language).

### 2.1 Instructions (§16.2)

| Construct | Meaning |
|---|---|
| `$CMS_VALUE(editorName)$` | editor value in scope |
| `$CMS_VALUE(assetType:uid.editorName)$` | value from another asset (see §2.6); without an editor path it warns `SF-TPL-0111` |
| `$CMS_VALUE(CMS_GLOBAL.set.editorName)$` | value from a global property set (see §2.7); same as `global:set.editorName` |
| `$CMS_REF(assetType:uid)$` | resolved URL/href |
| `$CMS_REF(editorName)$` | URL for a link/media/reference value |
| `$CMS_REF(assetType:uid.editorName)$` | URL for a link/media/reference value held by another asset, e.g. `$CMS_REF(CMS_GLOBAL.site.logo)$` |
| `$CMS_BODY(name)$` | render a body (page templates only) |
| `$CMS_INCLUDE(section_template:uid)$` | render a section inline |
| `$CMS_NAVIGATION(nav:uid [, depth=N] [, channel=key])$` | render a navigation folder's tree — see `navigation-template-syntax.md` / `navigation-html-output.md` |
| `$CMS_IF(expr)$ … $CMS_ELSEIF(expr)$ … $CMS_ELSE$ … $CMS_END_IF$` | conditional |
| `$CMS_FOR(item : listEditor)$ … $CMS_END_FOR$` | iteration over lists/nav nodes |
| `$CMS_SET(name = expr)$` | local variable |
| `$CMS_META(key)$` | `uid`, `uuid`, `displayName`, `path`, `revision`, `channel`, `now`, `projectKey` |
| `$CMS_COMMENT$ … $CMS_END_COMMENT$` | not emitted |
| `$$` | literal `$` |

### 2.2 Filters (§16.3)

`$CMS_VALUE(headline | upper | truncate(40) | html)$`

Built-ins: `html`, `attr`, `js`, `url`, `raw`, `upper`, `lower`, `capitalize`, `trim`, `truncate(n[,suffix])`, `default("…")`, `date("pattern")`, `number("pattern")`, `stripTags`, `nl2br`, `md`, `plain`, `json`, `slug`, `join(", ")`, `size`.

Channel `default_escaping` is applied automatically as the final step unless the chain already contains an escaping filter or `raw` (§16.3).

### 2.3 Example — section HTML template (§16.6)

```html
<section class="teaser teaser--$CMS_VALUE(layout)$" id="sec-$CMS_META(instanceId)$">
  $CMS_IF(kicker)$
    <p class="teaser__kicker">$CMS_VALUE(kicker)$</p>
  $CMS_END_IF$

  <h2 class="teaser__headline">$CMS_VALUE(headline)$</h2>

  $CMS_IF(heroImage)$
    <img class="teaser__image"
         src="$CMS_REF(heroImage, variant="w1600")$"
         srcset="$CMS_REF(heroImage, variant="w800")$ 800w,
                 $CMS_REF(heroImage, variant="w1600")$ 1600w"
         sizes="(max-width: 60rem) 100vw, 60rem"
         width="$CMS_VALUE(heroImage.width)$"
         height="$CMS_VALUE(heroImage.height)$"
         alt="$CMS_VALUE(heroImage.altText | attr)$"
         loading="lazy">
  $CMS_END_IF$

  <div class="teaser__body">$CMS_VALUE(body | raw)$</div>

  $CMS_IF(showCta && ctaLabel)$
    <a class="button" href="$CMS_REF(relatedPage)$">$CMS_VALUE(ctaLabel)$</a>
  $CMS_END_IF$

  $CMS_IF(links | size > 0)$
    <ul class="teaser__links">
      $CMS_FOR(link : links)$
        <li class="teaser__link$CMS_IF(link._first)$ is-first$CMS_END_IF$">
          <a href="$CMS_REF(link.target)$">$CMS_VALUE(link.label)$</a>
        </li>
      $CMS_END_FOR$
    </ul>
  $CMS_END_IF$
</section>
```

### 2.4 Example — the same section, Markdown channel (§16.7)

```
$CMS_IF(kicker)$_$CMS_VALUE(kicker)$_

$CMS_END_IF$## $CMS_VALUE(headline)$

$CMS_IF(heroImage)$![$CMS_VALUE(heroImage.altText)$]($CMS_REF(heroImage)$)

$CMS_END_IF$$CMS_VALUE(body | plain)$

$CMS_FOR(link : links)$- [$CMS_VALUE(link.label)$]($CMS_REF(link.target)$)
$CMS_END_FOR$
```

### 2.5 Scopes (§16.5)

`$CMS_PAGE.headline$` inside a section reads the enclosing page's `headline` editor (read-only upward reference). Loop scope exposes `item.<editor>`, `item._index`, `item._first`, `item._last`, `item._count`.

`CMS_GLOBAL.<set>.<editor>` reads a global property set from any template (§2.7). Like `CMS_PAGE` it is an *accessor root* used inside an instruction — `$CMS_VALUE(CMS_GLOBAL.site.title)$`, `$CMS_IF(CMS_GLOBAL.site.showBanner)$` — not an instruction of its own; there is no `$CMS_GLOBAL.site.title$` form.

### 2.6 Reference resolution (§16.4)

`assetType:uid` resolves to a UUID at compile time; saving the template records one `asset_reference` row per resolved reference and use (`OCTL_VALUE`, `OCTL_REF`, `OCTL_INCLUDE`, source path `channelTemplates.<channel>`), so usages of the target list your template immediately. An unresolvable UID is a compile error (`SF-TPL-0110`). A reference to a soft-deleted asset renders empty with a warning, in preview and generation alike: `SF-TPL-0112` for a cross-asset value, `SF-GEN-0220` for a `$CMS_REF`, `$CMS_INCLUDE` or body section target in generation. `$CMS_REF` resolves pages → output path (per URL strategy), media → public path (`?variant=w800`), folders → index page.

Cross-asset values walk the target's *root value object* exactly like a local value, so paths, `$CMS_IF`, `$CMS_SET`, `$CMS_FOR` and filters work unchanged (`$CMS_FOR(link : page:about.links)$`). The root value object is: `page` → the page's editor values (bodies, nav, output and meta are not exposed); `media` → `altText`, `caption`, `copyright`, `fileName`, `mimeType`, `sizeBytes`, `focalPoint`, `width`, `height`, `orientation`, `dominantColor`; `page_reference` → `label`; `global` → the property set's values (never its CDL); template and folder types → no values. Every asset also exposes a reserved `_meta` object with `uid` and `displayName` (`$CMS_VALUE(page:about._meta.displayName)$`). Values are escaped by the channel default like any other value. A target deleted after compile renders empty with a warning (`SF-TPL-0112`). A path-less `$CMS_VALUE(page:about)$` is a warning (`SF-TPL-0111`).

`$CMS_REF` on another asset follows the same rule as a local editor: path-less (`$CMS_REF(page:about)$`) links the asset itself, while a path (`$CMS_REF(page:about.heroImage)$`) links whatever that editor holds — the image, not the page. The media that is linked this way is a dependency of the rendering page, so generation copies the file to the output.

### 2.7 Global property sets (M17)

A **property set** is a named group of site-wide values — the site title, the social links, the footer copyright line, the brand logo — that editors maintain in the **Globals** store instead of each template hardcoding them. A set has a CDL schema and values, like a page has a template and content, but both live in the one set.

**Declaring a set.** A set's CDL is ordinary CDL with two restrictions, both reported as `SF-CDL-0107`:

- no `bodies { … }` — a body holds page sections, and a set has no page;
- no `catalog` editors — catalog cards render through the current page, which a set has none of.

Everything else works: text, media, booleans, lists, groups, `renamedFrom`, `visibleWhen`, validation attributes. Validate a draft with `POST /projects/{p}/cdl/validate?kind=GLOBAL_SET`, which applies the restrictions; without `kind` the same CDL validates as a template.

**Reading a set.** Two spellings, which are exactly the same reference — the compiler turns the first into the second, so they resolve, record usages and render identically:

```
$CMS_VALUE(CMS_GLOBAL.site.title)$     accessor root, like CMS_PAGE — use this one
$CMS_VALUE(global:site.title)$         the general cross-asset form (§2.6)
```

They work everywhere a value does: filters, `$CMS_IF`, `$CMS_SET`, `$CMS_FOR` over a list editor, and `$CMS_REF` on a media or link editor, whose URL is relative to the page being rendered.

**Worked example.** A `site` set and a `social` set:

```
content {
  editor text    title      { label "Site title" required }
  editor media   logo       { label "Logo" }
  editor boolean showBanner { label "Show banner" }
}
```

```
content {
  editor list links {
    label "Social links"
    item {
      editor text label  { label "Label" required }
      editor link target { label "Target" }
    }
  }
}
```

read by a page template's header:

```html
<header>
  <a href="index.html"><img src="$CMS_REF(CMS_GLOBAL.site.logo)$" alt="$CMS_VALUE(CMS_GLOBAL.site.title)$"></a>
  <h1>$CMS_VALUE(CMS_GLOBAL.site.title)$</h1>
  $CMS_IF(CMS_GLOBAL.site.showBanner)$<aside class="banner">$CMS_VALUE(CMS_GLOBAL.site.title | upper)$</aside>$CMS_END_IF$
  <ul>$CMS_FOR(link : CMS_GLOBAL.social.links)$<li>$CMS_VALUE(link.label)$</li>$CMS_END_FOR$</ul>
</header>
```

These snippets are exercised by the `global-value` golden file (`server/sf-template/src/test/resources/render/global-value/`), `GlobalValueRenderTest` and `M17GlobalsJourneyIntegrationTest`.

**Things to know.**

- **Sets are addressed by uid, not by folder.** Folders in the Globals store are for editors' orientation only; moving a set between folders never breaks a template.
- **Renaming a set's uid** leaves your template *source* spelling the old uid (the compiled template keeps working, as for any reference). The uid-change response lists every template that still says `CMS_GLOBAL.<old>` or `global:<old>`.
- **A set read by the page template makes every page depend on it.** Change the site title and the next `INCREMENTAL` generation rebuilds every page whose template reads `site`. That is correct — every one of those pages shows the title — but expect a large run.
- **Unknown sets fail at save time** (`SF-TPL-0110`), a deleted set renders empty with `SF-TPL-0112`, and a set that templates or pages still read cannot be deleted.
- `CMS_GLOBAL` on its own, or `$CMS_REF` on a set without an editor path (`$CMS_REF(CMS_GLOBAL.site)$`), is `SF-TPL-0105`: name the set, and for `$CMS_REF` name the editor that holds the link.

### 2.8 CMS syntax in text media (M18)

A stylesheet, script or data file can use the same OCTL as a template: the brand color from a global
set in `site.css`, the logo URL in a web manifest, page URLs in a JSON config. Processing is
**opt-in per file**: switch on **Process CMS syntax** in the media drawer (or
`PUT /media/{uuid}/process`). A file without the flag is published byte for byte, as before.

**Which files.** Text media only, by the MIME type detected on upload (from the file name):

| Type | Detected for | Published as |
|---|---|---|
| `text/css` | `.css` | `.css` |
| `application/javascript`, `text/javascript` | `.js` | `.js` |
| `application/json` | `.json` | `.json` |
| `application/manifest+json` | `.webmanifest` | `.webmanifest` |
| `image/svg+xml` | `.svg` | `.svg` |
| `application/xml`, `text/xml` | `.xml` | `.xml` |
| `text/plain` | `.txt`, and anything text that has no more specific type (for example `.mjs`) | `.txt` |

Any other file (images, PDFs, fonts) is rejected with `400`. The **Source** tab of the drawer edits
a text file in place; every save is a new revision.

**The render context.** A processed file belongs to no page and is rendered **once per generation**:

- in the project's **default channel**: `$CMS_META(channel)$` is its key, and `$CMS_REF(page:…)$`
  links to the page's path in that channel;
- with **escaping `NONE`**, whatever the channel's default: values are written as stored;
- with `$CMS_META` keys `uid`, `uuid`, `displayName`, `path` (the file's own output path, for
  example `assets/media/site_css.css`), `revision`, `channel`, `projectKey` and `mimeType`;
- with every cross-asset value (`page:`, `media:`, `global:`/`CMS_GLOBAL`) and `nav:` iteration.

The output goes to the file's normal path, `assets/media/{uid}.{ext}`, so every existing
`$CMS_REF(media:…)$` keeps working. Media the file references (a background image, a font, another
processed stylesheet) is published too, even when no page references it; two stylesheets may
reference each other.

**Allowed and forbidden instructions.**

| Allowed | Not available in text media (`SF-TPL-0121`) |
|---|---|
| `$CMS_VALUE`, `$CMS_REF`, `$CMS_IF`, `$CMS_FOR` (also `$CMS_FOR(item : nav:main)$`), `$CMS_SET`, `$CMS_META`, `$CMS_COMMENT`, `$CMS_NAVIGATION(nav:…) as item$ … $CMS_END_NAVIGATION$` | `$CMS_BODY`, `$CMS_INCLUDE`, the leaf form `$CMS_NAVIGATION(nav:…)$` (it emits HTML), `CMS_PAGE` |

A bare name such as `$CMS_VALUE(title)$` is an unknown editor (`SF-TPL-0103`): the file has no
editors of its own, so read values through `global:`, `page:` or `media:`.

**The `$$` rule.** With processing on, `$$` in the file is output as a single `$`, and every
`$CMS_…$` is an instruction. Plenty of JavaScript contains `$$` (DevTools helpers, minified bundles),
which is why processing is off by default. Every `$$` outside a `$CMS_COMMENT$` block is reported as
`SF-TPL-0320` with its line and column when you switch processing on or save, so you see the change
before the next build. Write `$$$$` where the output needs `$$`.

**Escaping in JS and JSON.** Escaping `NONE` is right for CSS and plain text, but in JavaScript or
JSON a value containing a quote breaks the string it is written into. Use a filter:

```
const title = '$CMS_VALUE(global:site.title | js)$';
{ "title": $CMS_VALUE(global:site.title | json)$ }
```

(`| json` writes the quotes itself.) A `$CMS_VALUE` without `js`, `json`, `attr`, `url`, `html` or
`raw` in a JS/JSON file is warned about with `SF-TPL-0321`; use `| raw` when the value is meant to be
code. The warning never blocks a save.

**Relative links.** `$CMS_REF` in a processed file is relative to the **file's own path**, just as a
page's links are relative to the page. That is exactly what CSS needs: `url()` resolves against the
stylesheet. A script is different: a URL the script *uses at runtime* (`fetch`, `location`) resolves
against the **document** that loaded it, not against the script, so a relative URL written into a
script points somewhere else on every page that loads it. Use root-relative or absolute URLs for
those, and keep `$CMS_REF` in scripts for URLs that are resolved relative to the script itself.

**Worked example.**

```
/* site.css — Process CMS syntax: on */
:root { --brand: $CMS_VALUE(global:site.brandColor)$; }
body { background: url($CMS_REF(media:paper_png)$); }
$CMS_COMMENT$ $$ in here is not reported $CMS_END_COMMENT$
```

generates `assets/media/site_css.css`:

```
:root { --brand: #c00; }
body { background: url(paper_png.png); }
```

and copies `assets/media/paper_png.png` next to it.

**When it is checked.** Switching processing on, saving the source and replacing the file of a
processed file all compile it: errors are a `422` with `diagnostics` and nothing changes; warnings
come back with the saved file. The references the source makes are recorded like a template's, so
the usages of `site` list `site.css`, an **incremental** generation re-renders `site.css` when only
`brandColor` changed (without re-rendering pages that merely link it), and renaming the set's uid
lists `site.css` among the sources that still spell the old uid.

**At generation**, a processed file that no longer compiles or hits a render limit is not published:
the run ends `PARTIAL` and the diagnostic keeps its own code with `Media '<uid>': ` in the message.
**In preview**, a page's link to a processed file serves the rendered output at the preview's
revision; a broken file is served as its source with the diagnostic in the `X-SF-Render-Error`
response header, so one bad stylesheet doesn't break the preview. An SVG is sanitized again after
rendering, so a value can't bring back `<script>` or event handlers.

## Part 3 — Diagnostics

### 3.1 OCTL (`SF-TPL-*`) — `template.diagnostic.DiagnosticCodes`

| Code | Severity | Meaning |
|---|---|---|
| `SF-TPL-0101` | error | unknown instruction |
| `SF-TPL-0102` | error | unbalanced block (missing `$CMS_END_IF$`) |
| `SF-TPL-0103` | error | unknown editor name in scope |
| `SF-TPL-0104` | error | unknown filter |
| `SF-TPL-0105` | error | `CMS_GLOBAL` without a property set (`$CMS_VALUE(CMS_GLOBAL)$`), or `$CMS_REF` on a property set without an editor path (`$CMS_REF(CMS_GLOBAL.site)$`) |
| `SF-TPL-0110` | error | unresolvable asset reference |
| `SF-TPL-0120` | error | `$CMS_BODY` used in a section template |
| `SF-TPL-0121` | error | processed text media (§2.8): `$CMS_BODY`, `$CMS_INCLUDE`, the leaf `$CMS_NAVIGATION(nav:…)$` or `CMS_PAGE`, none of which exist outside a page |
| `SF-TPL-0134` | error | `$CMS_NAVIGATION_RECURSE(name)$` references a variable not bound by an enclosing `$CMS_NAVIGATION(...) as name$` |
| `SF-TPL-0130` | error (render) | include depth exceeded: more than 32 nested section/include/catalog-card levels below the page template |
| `SF-TPL-0131` | error (render) | loop iteration limit (100,000) exceeded |
| `SF-TPL-0132` | error (render) | output size limit (32 MB) exceeded |
| `SF-TPL-0133` | error (render) | render time budget (5 s) exceeded |
| `SF-TPL-0135` | error (render) | include cycle: a template is rendered inside itself (`a → b → a`), via `$CMS_INCLUDE`, a body section or a catalog card |
| `SF-TPL-0111` | warning | cross-asset `$CMS_VALUE(assetType:uid)$` without an editor path |
| `SF-TPL-0112` | warning | render time: a cross-asset value's target is missing or soft-deleted (renders empty) |
| `SF-TPL-0201` | warning | body declared but never rendered |
| `SF-TPL-0301` | warning | `raw` filter on a plain-text editor |
| `SF-TPL-0310` | warning | editor declared but never used in any channel template |
| `SF-TPL-0320` | warning | processed text media: `$$` is output as a single `$` (one per occurrence outside `$CMS_COMMENT$`, with its position) |
| `SF-TPL-0321` | warning | processed JavaScript/JSON: `$CMS_VALUE` without an escaping filter (`js`, `json`, `attr`, `url`, `html`, `raw`) |

The render-time limits (`SF-TPL-0130`–`0133`, `0135`) fail only the affected page in generation (the other pages render and are published, the run ends `PARTIAL`, and the diagnostic names the page) and return a `422` problem with the diagnostic's code in preview. They apply to the **whole page render**: loop iterations, output size and time are counted across the page template and every section, include and catalog card rendered inside it, not per nested template.

### 3.2 CDL (`SF-CDL-*`) — `template.diagnostic.DiagnosticCodes`

| Code | Severity | Meaning |
|---|---|---|
| `SF-CDL-0101` | error | duplicate editor name |
| `SF-CDL-0102` | error | reserved editor name |
| `SF-CDL-0103` | error | unknown editor type |
| `SF-CDL-0104` | error | invalid attribute |
| `SF-CDL-0105` | error | invalid `visibleWhen`/validation expression |
| `SF-CDL-0106` | error | invalid editor name |
| `SF-CDL-0107` | error | not allowed in a global property set: a `body` declaration or a `catalog` editor (`POST /cdl/validate?kind=GLOBAL_SET` and property-set saves only) |
| `SF-CDL-0200` | error | CDL syntax error |

### 3.3 Generation (`SF-GEN-*`) — `generate.GenerationDiagnosticCodes` + `generate.GenerationService`

| Code | Severity | Meaning |
|---|---|---|
| `SF-GEN-0110` | error | output path collision |
| `SF-GEN-0120` | error (per page) | content incomplete: the page has `ERROR` completeness findings (an empty required editor, a count or length out of bounds) and is not published; the message lists `path (message)`, other pages are written and the run ends `PARTIAL` |
| `SF-GEN-0210` | warning | no channel template for an enabled channel |
| `SF-GEN-0220` | warning | reference to a deleted asset: a `$CMS_REF`, `$CMS_INCLUDE` or body section target is soft-deleted and renders empty |
| `SF-GEN-0230` | error (per file) | a processed text media file's source blob can't be read; the file is not published and the run ends `PARTIAL`. A processed file that fails to compile or render keeps its own `SF-TPL-*` code, with `Media '<uid>': ` in the message |
| `SF-GEN-0410` | warning | navigation cycle truncated |
| `SF-GEN-0411` | error | `$CMS_NAVIGATION` tree contains a dangling `PAGE_REFERENCE` (target missing/deleted, or an empty folder subtree) |
| `SF-GEN-0500` | 409 | a generation run is already active |

### 3.4 Errors carry the fix

The UI copies this philosophy (§24.6): a diagnostic includes "did you mean?" suggestions and click-to-insert links. When you change a UID, the UID-change response (`UidChangeResult`) lists affected templates, and processed text media files (channel key `source`), whose source still references the old UID literally (§6.4).

## Part 4 — Worked end-to-end

The full `teaser` template, stored page content, and generated HTML + Markdown are worked through in `cms-specification.md` Appendix A. Golden-file triples (`template + content + expected output`) live under `server/sf-template/src/test/resources/render/` (`value-basic`, `value-filters`, `if-elseif-else`, `for-list-nested`, `escaping-xss`, `value-cross-asset`, `global-value`, …) and `render-md/` — adding an OCTL feature is adding a directory there (§25.4).
