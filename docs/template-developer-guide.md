# StaticForge CMS — Template developer guide

For **template developers** (persona *Dev*). Covers the two declarative languages — **CDL** (what editors fill in) and **OCTL** (how it renders) — plus the diagnostic codes you will see in Monaco and at build time.

Normative reference: `cms-specification.md` §14 and §16. This guide is a working reference with the examples from §14.2 and §16.6–§16.7, and it points each diagnostic code at the code that emits it.

## Part 1 — CDL (content definition language)

CDL declares the editors a template exposes. It lives in a section template's or page template's `contentDefinition`. You edit it in the template IDE (Monaco) and can validate it live with `POST /projects/{p}/cdl/validate`.

Full per-type reference — attributes, stored-value shape, and a rendering example for each of the
19 editor types — lives in [`editors/`](editors/README.md), one file per type (`editors/text.md`,
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
| `$CMS_META(key)$` | `uid`, `uuid`, `displayName`, `path`, `revision`, `channel`, `now`, `projectKey`; `pageNumber`, `totalPages` on a paginated page (§2.11) |
| `$CMS_COMMENT$ … $CMS_END_COMMENT$` | not emitted |
| `$CMS_EXTENDS(page_template:uid)$` | this template extends a layout (page templates, first instruction; see §2.10) |
| `$CMS_BLOCK(name)$ … $CMS_END_BLOCK$` | a named, overridable region (§2.10) |
| `$CMS_PARENT$` | inside a block override: the parent's definition of that block (§2.10) |
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

`CMS_PAGINATION.*` reads the current page of a paginated page: its items and page links (§2.11).

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

**Which files.** Text media only, by the MIME type detected on upload (from the file name and its content):
every `text/*` type, every `+json` or `+xml` type, and `application/javascript`, `application/json`,
`application/xml`, `application/yaml`. For example:

| Type | Detected for | Published as |
|---|---|---|
| `text/css` | `.css` | `.css` |
| `application/javascript`, `text/javascript` | `.js` | `.js` |
| `application/json` | `.json` | `.json` |
| `application/manifest+json` | `.webmanifest` | `.webmanifest` |
| `image/svg+xml` | `.svg` | `.svg` |
| `application/xml`, `text/xml` | `.xml` | `.xml` |
| `text/html` | `.html`, `.htm` | `.html` |
| `text/x-web-markdown` | `.md` | `.md` |
| `text/csv` | `.csv` | `.csv` |
| `text/x-yaml` | `.yaml`, `.yml` | `.yaml` |
| `application/rss+xml`, `application/atom+xml` | `.rss`, `.atom` | `.rss`, `.atom` |
| `text/x-robots` | `robots.txt` whose content starts with `User-agent:` | `.txt` |
| `text/plain` | `.txt`, and anything text that has no more specific type (for example `.mjs`) | `.txt` |

Any other `text/*` type publishes as `.txt`, any other `+json`/`+xml` type as `.json`/`.xml`. Other files (images,
PDFs, fonts) are rejected with `400`. The **Source** tab of the drawer edits
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

### 2.9 Datasets and records (M19)

A **dataset** is a list of structured entries that many pages show: team members, products, FAQs,
locations. A developer declares the fields once as a **dataset schema** (Templates store, fixed
**Datasets** folder); editors add one **record** per entry in the **Content** store. Records have no
page of their own — templates loop over them, read single ones, or follow a `reference` to one.

**Declaring a dataset.** A schema is ordinary CDL with one restriction: no `bodies { … }` (records have
values only, `SF-CDL-0108`). Every editor type works, `renamedFrom` included: renaming a field rewrites
that key in every record of the dataset, and the schema change plus all rewritten records are **one
revision**. Removed fields keep their stored values, exactly as on pages. Validate a draft with
`POST /projects/{p}/cdl/validate?kind=DATASET`. A schema can name a **title field** (a `text` editor):
a record's display name then follows that field.

**Looping a dataset.**

```
$CMS_FOR(member : dataset:team, where="member.role == 'lead'", sort="-joined,name", limit=6, offset=0, folder="staff")$
  <li>$CMS_VALUE(member.name)$</li>
$CMS_END_FOR$
```

| Argument | Meaning |
|---|---|
| `where` | an OCTL expression — the `$CMS_IF` grammar (§16.9) — that a record must satisfy |
| `sort` | comma-separated fields, `-` for descending; after them records order by `_displayName`, then `_uid` |
| `limit`, `offset` | non-negative integers |
| `folder` | a Content folder path prefix: `staff` or `/staff/leads/` |

They apply in the order `folder` → `where` → `sort` → `offset` → `limit`, and are parsed when the
template is saved: a malformed argument is `SF-TPL-0140`, and a field the dataset doesn't declare is
`SF-TPL-0141` (`SF-TPL-0142` for sorting by a list, rich text, media or reference field, which have no
order). An unknown dataset uid is `SF-TPL-0110`. Loops count toward the 100,000 iteration limit
(`SF-TPL-0131`) like any other.

- **Fields are read through the loop variable** (`member.role`). Any other name in `where` is the
  render scope, so a loop can depend on the page it renders on:
  `where="member.team == CMS_PAGE.team"`, or a `$CMS_SET` variable. There are no bare field names.
- **Comparisons.** Numbers compare numerically; strings that are both ISO dates or date-times
  (`2024-05-01`, `2024-05-01T10:00:00Z`) chronologically (a date is the start of its day, UTC); other
  strings case-sensitively. A `reference` or `media` value compares as its uuid. A missing field is
  `null`: `member.joined == null` tests absence; `<`/`>` against a missing value, or across types
  (`member.level > 'x'`), are simply false. `in` tests membership: `member.role in ['lead', 'cto']`,
  `'vip' in member.tags`, or a substring: `'Love' in member.name`. Filters work: `member.name | lower == 'ada'`.
- **Sorting** is stable; missing values sort last in both directions; strings sort case-insensitively
  with a fixed, locale-independent order, so output is identical on every server.
- **Loop scope.** Each item has the record's fields plus `_uuid`, `_uid`, `_displayName`,
  `_folderPath` (relative to the Content store: `/staff/leads/`), `_changedAt` (ISO instant) and the
  usual `_index`, `_first`, `_last`, `_count`. A record's list fields loop like any list:
  `$CMS_FOR(tag : member.tags)$`.
- **Deleted records** never appear. Preview in time travel loops the records as they were then.

**Reading one record.** `record:<uid>` is a cross-asset value (§2.6) whose root is the same item a loop
binds: `$CMS_VALUE(record:dee.name)$`, `$CMS_VALUE(record:dee._folderPath)$`. `$CMS_REF(record:dee)$`
has no URL and is `SF-TPL-0105`; `$CMS_REF(record:dee.website)$` links what the field holds.

**Following a reference.** A `reference` editor value pointing at a record can be walked into:
`$CMS_VALUE(author.name)$` reads the referenced record's `name`, and `$CMS_VALUE(r.person.mentor.name)$`
follows references through records. Only segments the reference value itself lacks dereference, so
`author.uuid` is still the stored uuid. Restrict a reference to one dataset with `dataset "uid"`
(see [`editors/reference.md`](editors/reference.md)).

**Worked example: a team page.** The records (from the golden-file fixture, as `records.json`):

<!-- golden: render/for-dataset-where-sort/records.json -->
```json
{
  "team": {
    "uuid": "d0000000-0000-0000-0000-000000000001",
    "records": [
      { "uuid": "e0000000-0000-0000-0000-00000000000a", "uid": "ada", "displayName": "Ada", "folderPath": "/team/leads/",
        "content": { "name": "Ada", "role": "lead", "level": 3, "joined": "2021-03-01", "tags": ["vip", "founder"] } },
      { "uuid": "e0000000-0000-0000-0000-00000000000b", "uid": "bob", "displayName": "bob", "folderPath": "/team/",
        "content": { "name": "bob <b>", "role": "dev", "level": 1.5, "joined": "2023-07-15", "tags": [] } },
      { "uuid": "e0000000-0000-0000-0000-00000000000c", "uid": "cy", "displayName": "Cy", "folderPath": "/team/",
        "content": { "name": "Cy", "role": "dev", "level": 2, "joined": "2022-11-30",
                     "mentor": { "type": "ASSET_REF", "uuid": "e0000000-0000-0000-0000-00000000000a", "assetType": "RECORD" } } },
      { "uuid": "e0000000-0000-0000-0000-00000000000d", "uid": "dee", "displayName": "Dee", "folderPath": "/alumni/",
        "content": { "name": "Dee", "role": "lead", "joined": "2019-05-05" } }
    ]
  }
}
```

The HTML channel:

<!-- golden: render/for-dataset-where-sort/template.octl -->
```
$CMS_SET(minLevel = 2)$<ul>
$CMS_FOR(member : dataset:team, where="member.role == 'lead' || member.level >= minLevel", sort="-joined,name", limit=3)$<li data-i="$CMS_VALUE(member._index)$">$CMS_VALUE(member.name)$ ($CMS_VALUE(member.role)$, $CMS_VALUE(member.joined)$)</li>
$CMS_END_FOR$</ul>
<p>$CMS_FOR(m : dataset:team, folder="alumni")$$CMS_VALUE(m._displayName)$ in $CMS_VALUE(m._folderPath)$$CMS_END_FOR$</p>
<p>$CMS_FOR(m : dataset:team, sort="_uid", offset=1, limit=2)$[$CMS_VALUE(m.name)$]$CMS_END_FOR$</p>
<p>$CMS_FOR(m : dataset:team, where="m.nope == 1")$never$CMS_END_FOR$</p>
```

renders:

<!-- golden: render/for-dataset-where-sort/expected.html -->
```html
<ul>
<li data-i="0">Cy (dev, 2022-11-30)</li>
<li data-i="1">Ada (lead, 2021-03-01)</li>
<li data-i="2">Dee (lead, 2019-05-05)</li>
</ul>
<p>Dee in /alumni/</p>
<p>[bob &lt;b&gt;][Cy]</p>
<p></p>
```

(The last loop compiles here because the golden runner knows no schema; saved against the `team`
schema it is `SF-TPL-0141`.) The Markdown channel of the same data:

<!-- golden: render-md/for-dataset-markdown/template.octl -->
```
# Team

$CMS_FOR(member : dataset:team, where="member.role == 'lead'", sort="name")$- **$CMS_VALUE(member.name)$** — joined $CMS_VALUE(member.joined)$
$CMS_END_FOR$
Mentor of Cy: $CMS_VALUE(record:cy.mentor.name)$
```

<!-- golden: render-md/for-dataset-markdown/expected.md -->
```markdown
# Team

- **Ada** — joined 2021-03-01
- **Dee** — joined 2019-05-05

Mentor of Cy: Ada
```

Record values and references, with a page whose `author` and `reviewers[].person` are `reference`
editors pointing at records (and `related` pointing at a page, which is not dereferenced):

<!-- golden: render/record-value-and-reference/template.octl -->
```
<p>$CMS_VALUE(record:dee.name)$ ($CMS_VALUE(record:dee._folderPath)$, $CMS_VALUE(record:dee._meta.displayName)$)</p>
<p>By $CMS_VALUE(author.name)$, $CMS_VALUE(author.role | upper)$ [$CMS_VALUE(author.uuid)$]</p>
<ul>$CMS_FOR(r : reviewers)$<li>$CMS_VALUE(r.person.name)$$CMS_IF(r.person.mentor.name)$ mentored by $CMS_VALUE(r.person.mentor.name)$$CMS_END_IF$</li>$CMS_END_FOR$</ul>
<p>[$CMS_VALUE(related.name)$][$CMS_VALUE(missing.name)$]</p>
```

<!-- golden: render/record-value-and-reference/expected.html -->
```html
<p>Dee (/alumni/, Dee)</p>
<p>By Ada, LEAD [e0000000-0000-0000-0000-00000000000a]</p>
<ul><li>Cy mentored by Ada</li><li>bob &lt;b&gt;</li><li></li></ul>
<p>[][]</p>
```

Every snippet in this section is checked against its golden file by `DocsGoldenSnippetsTest`.

**Rebuilds.** An `INCREMENTAL` generation rebuilds a page that loops `dataset:team` when a team record
is created, edited, moved or deleted **and the loop's `folder` and `where` select that record before or
after the change**. A record the loop filters out both times can't change its output — sorting,
`offset`, `limit` and `_count` all apply after the filter — so, with the example above, editing a `dev`
record doesn't rebuild the leads page, while promoting one to `lead` (or demoting a lead) does. A loop
without `folder`/`where` selects every record, so every change rebuilds it. A `where` that reads the
render scope (`CMS_PAGE.team`, a `$CMS_SET` variable, an outer loop, another asset) can't be decided
before rendering: the page rebuilds for every record in the loop's folder. Items a loop dereferences
count too: if a selected record references a record that changes (`member.mentor.name`), the page
rebuilds. A page that reads one record — by `record:` or through a `reference` — depends on that record
only; editing a sibling record does not rebuild it. Changing the schema rebuilds every page that loops
the dataset. A 5,000-record dataset looped
by 500 pages generates in about 2.6 s (full) on the development machine.

**Not the `visibleWhen` grammar.** `where` is the OCTL expression grammar `$CMS_IF` uses. The CDL
`visibleWhen` attribute has its own, deliberately tiny grammar shared with the editor UI (§14.4) — no
filters, no `in`, no dates — and the two are not interchangeable.

### 2.10 Layouts and inheritance (M20)

A page template can extend another page template and replace only the regions that differ. Put the
site chrome (`<html>`, `<head>`, header, footer, navigation) in one **layout** and let every page template
extend it, instead of copying the skeleton into each.

| Instruction | Where | Meaning |
|---|---|---|
| `$CMS_EXTENDS(page_template:uid)$` | the first instruction of a channel source | this channel renders the parent's layout |
| `$CMS_BLOCK(name)$ … $CMS_END_BLOCK$` | anywhere; top level in a template that extends | a named region: its default content in a layout, a replacement in a template that extends |
| `$CMS_PARENT$` | inside a block, in a template that extends | the next less-derived definition of the enclosing block |

**How it renders.** Rendering starts at the **root** layout's source. Each `$CMS_BLOCK(name)$` renders the
most-derived definition of `name` along the chain; inside it, `$CMS_PARENT$` renders the definition one level
up, and at the root it renders nothing. Blocks are found by name wherever they appear, so overriding an inner
block works even when the outer block around it isn't overridden, and an override may declare new inner blocks
for its own descendants. A template with blocks that doesn't extend anything renders each block in place, so a
layout is still an ordinary template. Chains may be up to 8 templates deep above the page's template
(`SF-TPL-0155`); a template can't extend itself, directly or through others (`SF-TPL-0154`).

**Rules for a template that extends.**

- `$CMS_EXTENDS` comes first; only whitespace and `$CMS_COMMENT$` may precede it, and it appears once
  (`SF-TPL-0150`). The target must be a `page_template:` (`SF-TPL-0156`). Section templates can't extend.
- Outside its top-level blocks it may contain only `$CMS_SET` and `$CMS_COMMENT$` (`SF-TPL-0151`): text there
  would have no place in the layout.
- Overriding a block no ancestor defines is a warning with a suggestion (`SF-TPL-0157`); the override never
  renders.
- Block names follow the editor naming rule and are unique within a template, nested blocks included
  (`SF-TPL-0152`). Block names and editor names are separate namespaces.
- `$CMS_SET` outside blocks sets a variable before the layout renders. The chain's sets run root-most first,
  so the most-derived template's value wins, and every block definition along the chain sees it. A `$CMS_SET`
  inside the layout itself runs where it stands, after them.

**Abstract templates.** Tick **Abstract** on a page template that only exists to be extended. Pages can't use
it (`SF-DOM-0123`), and it isn't offered when creating a page. A template that pages already use can't become
abstract until they move to another template (`SF-DOM-0122` lists them). Any page template may be extended,
abstract or not.

**Editors and bodies are inherited.** A template's *effective* content definition is its ancestors' editors
and bodies followed by its own. The page form, content validation and the editor-name checks all use it, so an
article's channel source can read `$CMS_VALUE(title)$` that only the layout declares. Declaring an editor or
body with a name an ancestor already uses is `SF-CDL-0109`. The template screen lists inherited editors
read-only, grouped by the ancestor that declares them; change them on that ancestor.

**Channels.** Every channel is its own chain: if `article`'s `html` source extends `docs_layout`, then
`docs_layout` needs an `html` source too (`SF-TPL-0158`). All channels of a template that extend must name the
same parent (`SF-TPL-0159`), which the template records as `parentTemplateRef` on save. A channel source that
doesn't extend renders standalone but still uses the inherited editors.

**Changing a layout.** Saving a template recompiles every template that extends it, at any depth, against the
new version first. If one would break (a new editor name one of them already declares, a removed channel), the
save is rejected (`SF-DOM-0124`) and names each broken template with its diagnostics; nothing is written.
Warnings (an override whose block the layout removed) don't block the save and are shown after it. A
`renamedFrom` on a layout's editor migrates the stored content of the pages of the layout and of every template
that extends it, in one revision. An incremental build rebuilds every page of every template that extends a
changed layout. A layout that other templates extend can't be deleted (`SF-DOM-0120` names them), and exporting
a template brings its ancestors along.

**Worked example.** `base` holds the page frame and a header block reading the inherited `title` editor:

<!-- golden: render/extends-multilevel/parents/base.octl -->
```html
<body>$CMS_BLOCK(header)$<h1>$CMS_VALUE(title)$</h1>$CMS_END_BLOCK$
$CMS_BLOCK(content)$<p>base</p>$CMS_END_BLOCK$</body>
```

`docs_layout` extends it, sets a child-level variable, adds navigation above the header and wraps the content:

<!-- golden: render/extends-multilevel/parents/docs_layout.octl -->
```html
$CMS_EXTENDS(page_template:base)$
$CMS_SET(crumb = "Guides")$
$CMS_BLOCK(header)$<nav>$CMS_VALUE(crumb)$</nav>$CMS_PARENT$$CMS_END_BLOCK$
$CMS_BLOCK(content)$<div class="docs">$CMS_PARENT$</div>$CMS_END_BLOCK$
```

`article` extends `docs_layout`, overrides the variable and wraps the content once more. It declares no editors
of its own: `section` comes from `docs_layout` and `title` from `base`.

<!-- golden: render/extends-multilevel/template.octl -->
```html
$CMS_EXTENDS(page_template:docs_layout)$
$CMS_SET(crumb = "Articles")$
$CMS_BLOCK(content)$<article>$CMS_PARENT$<em>$CMS_VALUE(section)$ / $CMS_VALUE(crumb)$</em></article>$CMS_END_BLOCK$
```

A page on `article` with `title = "Levels"` and `section = "Intro"` renders:

<!-- golden: render/extends-multilevel/expected.html -->
```html
<body><nav>Articles</nav><h1>Levels</h1>
<article><div class="docs"><p>base</p></div><em>Intro / Articles</em></article></body>
```

`$CMS_VALUE(crumb)$` in `docs_layout`'s header block prints `Articles`: `article`'s set ran last. The golden
cases `extends-default-blocks`, `extends-override-parent`, `extends-nested-blocks` and
`render-md/extends-markdown` show the other rules.

### 2.11 Pagination (M21)

A page template with a [`pagination`](editors/pagination.md) editor turns each of its pages into a listing over
several output files. The editor picks a source (a Navigation folder or a dataset), a page size and a sort; the page
count is known before rendering, so every page is planned, collision-checked, listed in the sitemap and search index
and rebuilt incrementally like any page. Page 1 keeps the page's own path; pages 2..N sit next to it
(`news/blog.html`, `news/blog-2.html`, …) unless the page template sets a pattern under **Pagination paths** on the Templates screen (`paginationPath`)
(`{pagePath}/page/{pageNumber}/index.{ext}`, see the editor reference).

Every page of it reads the read-only `CMS_PAGINATION` root, and so do the sections, catalog cards and includes rendered
inside it. On any other page it is missing: `$CMS_IF(CMS_PAGINATION)$` is false and its accessors render empty. A
`$CMS_SET` or loop variable named `CMS_PAGINATION` is `SF-TPL-0163`; text media can't use it (`SF-TPL-0121`).

| Accessor | Meaning |
|---|---|
| `CMS_PAGINATION.items` | this page's items, in order |
| `CMS_PAGINATION.current` / `.total` | 1-based page number / page count (at least 1: an empty source is one empty page) |
| `CMS_PAGINATION.pageSize` / `.itemCount` | the page size / all eligible items |
| `CMS_PAGINATION.firstHref` / `.prevHref` / `.nextHref` / `.lastHref` | page links; `prevHref` is empty on the first page, `nextHref` on the last |
| `CMS_PAGINATION.canonicalHref` | this page's own link |
| `CMS_PAGINATION.pages` | `{number, href, current}` for a numbered pager |

A navigation item is `{uuid, uid, displayName, label, href, date?, position, content}`: the target page's identity,
its navigation label, a link to it, its `nav.date`/`publishedOn`, `nav.position`, and its editor values under
`content` (`post.content.teaser`). A dataset item is the record's fields, exactly as a dataset loop sees them, plus
`uuid` and `uid`. `$CMS_META(pageNumber)$` and `$CMS_META(totalPages)$` repeat `current` and `total` (empty on other
pages).

Every href is relative to the page being rendered, like any generated link: from `news/blog-2.html`, page 1 is
`blog.html` and a post in `posts/` is `../posts/post-3.html`. In the editor's preview they point at the preview's
own pages instead.

Pages 2..N are **self-canonical**: `canonicalHref` is the page itself, not page 1, which is what search engines
recommend for paginated listings (canonicalising everything to page 1 hides the items further back). The CMS injects
no markup; emit the `<link rel>` tags yourself.

**Worked example: a blog index.** Five posts, two per page; page 2 of the golden case `render/pagination-middle`
(its `pagination.json` is the `CMS_PAGINATION` value):

<!-- golden: render/pagination-middle/template.octl -->
```html
<ul>
$CMS_FOR(post : CMS_PAGINATION.items)$<li><a href="$CMS_VALUE(post.href)$">$CMS_VALUE(post.label)$</a> $CMS_VALUE(post.content.teaser)$</li>
$CMS_END_FOR$</ul>
<p>Page $CMS_VALUE(CMS_PAGINATION.current)$ of $CMS_VALUE(CMS_PAGINATION.total)$, $CMS_VALUE(CMS_PAGINATION.itemCount)$ posts, $CMS_VALUE(CMS_PAGINATION.pageSize)$ per page</p>
<link rel="canonical" href="$CMS_VALUE(CMS_PAGINATION.canonicalHref)$">
$CMS_IF(CMS_PAGINATION.prevHref)$<a rel="prev" href="$CMS_VALUE(CMS_PAGINATION.prevHref)$">Previous</a>
$CMS_END_IF$$CMS_FOR(p : CMS_PAGINATION.pages)$$CMS_IF(p.current)$<strong>$CMS_VALUE(p.number)$</strong>$CMS_ELSE$<a href="$CMS_VALUE(p.href)$">$CMS_VALUE(p.number)$</a>$CMS_END_IF$
$CMS_END_FOR$$CMS_IF(CMS_PAGINATION.nextHref)$<a rel="next" href="$CMS_VALUE(CMS_PAGINATION.nextHref)$">Next</a>
$CMS_END_IF$<a href="$CMS_VALUE(CMS_PAGINATION.firstHref)$">First</a> <a href="$CMS_VALUE(CMS_PAGINATION.lastHref)$">Last</a>
```

renders:

<!-- golden: render/pagination-middle/expected.html -->
```html
<ul>
<li><a href="posts/gamma.html">Gamma</a> Third</li>
<li><a href="posts/delta.html">Delta</a> Fourth</li>
</ul>
<p>Page 2 of 3, 5 posts, 2 per page</p>
<link rel="canonical" href="blog-2.html">
<a rel="prev" href="blog.html">Previous</a>
<a href="blog.html">1</a>
<strong>2</strong>
<a href="blog-3.html">3</a>
<a rel="next" href="blog-3.html">Next</a>
<a href="blog.html">First</a> <a href="blog-3.html">Last</a>
```

The cases `pagination-first`, `pagination-last`, `pagination-single`, `pagination-empty` and
`render-md/pagination-markdown` show the other pages.

### 2.12 Several languages (M24)

A project can declare a list of **languages** (BCP 47 tags such as `de`, `en`, `de-CH`), one of them the default, in
**Project settings → Languages**. A project that declares none is single-language and everything below is inactive:
its templates, payloads, output paths and URLs are exactly what they were before M24.

#### Marking an editor language-dependent

A leaf editor opts in with `localizable`:

```
content {
  editor text headline { label "Headline" localizable }
  editor text sku      { label "SKU" }
}
```

Its stored value becomes one value per language:

```json
"headline": { "type": "L10N", "values": { "de": "Die Parka", "en": "The parka" } }
```

Page structure is shared by every language, so `group`, `list`, `catalog` and `pagination` reject the attribute
(`SF-CDL-0112`) — mark the leaf editors *inside* them instead. `required` is checked in the default language only;
every other language may be empty and falls back.

Templates never see the wrapper. A value is resolved once, when the template reads it, through the render language's
fallback chain (the language, its declared fallbacks, then the default language), so filters, `$CMS_IF`, loops and
`| json` all see a plain value:

```
$CMS_VALUE(headline)$        <!-- "Die Parka" on a German page, "The parka" on an English one -->
$CMS_IF(headline)$…          <!-- false when no language in the chain has a value -->
```

Media alt text and captions, and navigation labels, follow the same rule.

#### The render language in a template

| Accessor | Meaning |
|---|---|
| `$CMS_META(locale)$` | the full tag of the page being rendered, e.g. `de-CH` (empty without languages) |
| `$CMS_META(language)$` | its language subtag, e.g. `de` — what `<html lang="…">` wants |
| `$CMS_FOR(l : CMS_LOCALES)$` | the language switcher: one item per declared language |

A `CMS_LOCALES` item is `{code, language, label, current, href}`; `href` is *this* page in that language, relative to
the page being rendered, and empty in a preview or where the page has no URL in that language. `CMS_LOCALES` is
read-only: a `$CMS_SET` or loop variable of that name is `SF-TPL-0163`.

```
<html lang="$CMS_META(language)$">
<ul class="languages">
  $CMS_FOR(l : CMS_LOCALES)$
    <li><a href="$CMS_VALUE(l.href)$" hreflang="$CMS_VALUE(l.code)$">$CMS_VALUE(l.label)$</a></li>
  $CMS_END_FOR$
</ul>
```

Renders, on `de/about.html` of a project with `de` and `en`:

```html
<html lang="de">
<ul class="languages">
    <li><a href="../de/about.html" hreflang="de">Deutsch</a></li>
    <li><a href="../en/about.html" hreflang="en">English</a></li>
</ul>
```

#### Language-aware filters

`date` and `number` format in the render language, and `upper`/`lower`/`capitalize` case-fold in it:

| Expression | `de` | `en` |
|---|---|---|
| `publishedOn \| date("d. MMMM yyyy")` | `3. Oktober 2026` | `3. October 2026` |
| `price \| number("#,##0.00")` | `1.234,50` | `1,234.50` |

A second argument overrides the language: `date("d. MMMM yyyy", "en")`.

> **Changed in M24.** `date` used to format with the *server's* JVM default language, so the same template produced
> `3. Oktober 2026` on a German machine and `3. October 2026` on an English one. It is now deterministic: the render
> language, or the neutral root language in a project without languages. The root language abbreviates month names
> (`MMMM` → `Oct`), so a single-language site that wants a spelled-out month names it explicitly:
> `date("d. MMMM yyyy", "en")`.

#### Output paths and links

Generation writes every page once per channel **per language**. The `{locale}` placeholder is where the language goes,
and in a project with languages the default path expression is `{locale}/{folder}{uid}.{ext}`:

| Page | Path |
|---|---|
| `about` | `de/about.html`, `en/about.html` |
| `p2` in folder `pf` | `de/pf/p2.html`, `en/pf/p2.html` |

Switching on **Default language without URL prefix** puts the default language back at the site root
(`about.html`, `en/about.html`) — the migration path for a site that already has URLs people link to.

Every page's effective path expression must contain `{locale}` once the project has languages, or two languages would
write the same file; generation refuses the run with `SF-GEN-0111` before writing anything.

`$CMS_REF(page:about)$` links to the target **in the render language**, relative to the page holding the link, so
`en/pf/p2.html` links to `../about.html`. To cross languages deliberately, name one:
`$CMS_REF(page:about, locale="en")$`.

The sitemap lists every output and marks translations as alternates of one another, with `x-default` pointing at the
default language:

```xml
<url>
  <loc>https://example.com/de/about.html</loc>
  <xhtml:link rel="alternate" hreflang="de" href="https://example.com/de/about.html"/>
  <xhtml:link rel="alternate" hreflang="en" href="https://example.com/en/about.html"/>
  <xhtml:link rel="alternate" hreflang="x-default" href="https://example.com/de/about.html"/>
</url>
```

#### Incremental builds

Translating one language of one page rebuilds that language's outputs only. Anything else — structure, a
non-language-dependent value, the template, the UID, the folder, a media file — rebuilds every language, and the
build-insight plan says which languages a narrowed entry covers.

## Part 3 — Diagnostics

### 3.1 OCTL (`SF-TPL-*`) — `template.diagnostic.DiagnosticCodes`

| Code | Severity | Meaning |
|---|---|---|
| `SF-TPL-0101` | error | unknown instruction |
| `SF-TPL-0102` | error | unbalanced block (missing `$CMS_END_IF$`) |
| `SF-TPL-0103` | error | unknown editor name in scope |
| `SF-TPL-0104` | error | unknown filter |
| `SF-TPL-0105` | error | `CMS_GLOBAL` without a property set (`$CMS_VALUE(CMS_GLOBAL)$`), or `$CMS_REF` without an editor path on a property set (`$CMS_REF(CMS_GLOBAL.site)$`), a record (`$CMS_REF(record:dee)$`) or a dataset — none has a URL |
| `SF-TPL-0110` | error | unresolvable asset reference |
| `SF-TPL-0120` | error | `$CMS_BODY` used in a section template |
| `SF-TPL-0121` | error | processed text media (§2.8): `$CMS_BODY`, `$CMS_INCLUDE`, the leaf `$CMS_NAVIGATION(nav:…)$` or `CMS_PAGE`, none of which exist outside a page |
| `SF-TPL-0140` | error | dataset loop (§2.9): a malformed `where`, `sort`, `limit`, `offset` or `folder`, an unknown loop argument, or a path after `dataset:uid`; the message carries the column inside the argument |
| `SF-TPL-0141` | error | dataset loop: `where` or `sort` names a field the dataset's schema doesn't declare (checked when the template is saved) |
| `SF-TPL-0142` | error | dataset loop: `sort` by a field with no order — `list`, `richtext`, `media`, `reference` and other structured editors |
| `SF-TPL-0134` | error | `$CMS_NAVIGATION_RECURSE(name)$` references a variable not bound by an enclosing `$CMS_NAVIGATION(...) as name$` |
| `SF-TPL-0150` | error | inheritance (§2.10): `$CMS_EXTENDS` is not the first instruction, is nested in another instruction, or appears twice |
| `SF-TPL-0151` | error | text or an instruction other than `$CMS_BLOCK`, `$CMS_SET` or `$CMS_COMMENT$` outside the top-level blocks of a template that extends |
| `SF-TPL-0152` | error | a block name that isn't an identifier, or a block name declared twice in one template (nested blocks included) |
| `SF-TPL-0153` | error | `$CMS_PARENT$` outside a block, in a template that doesn't extend, or with arguments |
| `SF-TPL-0154` | error | inheritance cycle; the message lists the chain (`a → b → a`) |
| `SF-TPL-0155` | error | inheritance chain deeper than 8 templates |
| `SF-TPL-0156` | error | `$CMS_EXTENDS` names something other than a `page_template:uid`, or is used in a section template |
| `SF-TPL-0158` | error | an ancestor has no template for the channel being compiled |
| `SF-TPL-0159` | error | a page template's channels extend different parents |
| `SF-TPL-0160` | error | an ancestor's own source doesn't compile for this channel; reported once, with the ancestor's uid and its first error |
| `SF-TPL-0161` | error | the parent can't be loaded: it isn't a live page template, or the source was compiled without templates to load (for example `POST /octl/validate` without `templateUuid`) |
| `SF-TPL-0162` | error | a block contains itself through nested blocks or overrides along the chain |
| `SF-TPL-0163` | error | `CMS_PAGINATION` is read-only: a `$CMS_SET` or loop variable can't take its name (§2.11) |
| `SF-TPL-0130` | error (render) | include depth exceeded: more than 32 nested section/include/catalog-card levels below the page template |
| `SF-TPL-0131` | error (render) | loop iteration limit (100,000) exceeded |
| `SF-TPL-0132` | error (render) | output size limit (32 MB) exceeded |
| `SF-TPL-0133` | error (render) | render time budget (5 s) exceeded |
| `SF-TPL-0135` | error (render) | include cycle: a template is `$CMS_INCLUDE`d while it is already rendering (`a → b → a`). Body sections and catalog cards nest by content and are not cycles: a card may hold cards of its own template, as deep as the content goes, bounded by `SF-TPL-0130` |
| `SF-TPL-0111` | warning | cross-asset `$CMS_VALUE(assetType:uid)$` without an editor path |
| `SF-TPL-0112` | warning | render time: a cross-asset value's target is missing or soft-deleted (renders empty) |
| `SF-TPL-0157` | warning | a template overrides a block no ancestor defines, so the override never renders; carries a "did you mean" suggestion |
| `SF-TPL-0201` | warning | body declared but never rendered |
| `SF-TPL-0301` | warning | `raw` filter on a plain-text editor |
| `SF-TPL-0310` | warning | editor declared but never used in any channel template |
| `SF-TPL-0320` | warning | processed text media: `$$` is output as a single `$` (one per occurrence outside `$CMS_COMMENT$`, with its position) |
| `SF-TPL-0321` | warning | processed JavaScript/JSON: `$CMS_VALUE` without an escaping filter (`js`, `json`, `attr`, `url`, `html`, `raw`) |

The M20 numbers start at `0150` because `0140`–`0142` were already taken by dataset loops. `SF-TPL-0130` and `0131` are `DiagnosticCodes` constants like every other code.

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
| `SF-CDL-0108` | error | not allowed in a dataset schema: a `body` declaration (`POST /cdl/validate?kind=DATASET` and dataset saves only) |
| `SF-CDL-0109` | error | a page template's own editor or body name is already declared by an ancestor (§2.10); the message names the ancestor |
| `SF-CDL-0110` | error | a `pagination` editor inside a `list` or `group`, or in a section template, property set or dataset schema (§2.11) |
| `SF-CDL-0111` | error | more than one `pagination` editor in a page template, counting inherited ones (§2.11) |
| `SF-CDL-0112` | error | `localizable` on a `group`, `list`, `catalog` or `pagination` editor — structure is shared by all languages, so mark the leaf editors inside it instead (§2.12) |
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
| `SF-GEN-0412` | warning | a paginated page's navigation source holds a `PAGE_REFERENCE` that resolves to no page; the item is skipped and the page still renders (§2.11) |
| `SF-GEN-0500` | 409 | a generation run is already active |

### 3.4 Errors carry the fix

The UI copies this philosophy (§24.6): a diagnostic includes "did you mean?" suggestions and click-to-insert links. When you change a UID, the UID-change response (`UidChangeResult`) lists affected templates, and processed text media files (channel key `source`), whose source still references the old UID literally (§6.4).

## Part 4 — Worked end-to-end

The full `teaser` template, stored page content, and generated HTML + Markdown are worked through in `cms-specification.md` Appendix A. Golden-file triples (`template + content + expected output`) live under `server/sf-template/src/test/resources/render/` (`value-basic`, `value-filters`, `if-elseif-else`, `for-list-nested`, `escaping-xss`, `value-cross-asset`, `global-value`, …) and `render-md/` — adding an OCTL feature is adding a directory there (§25.4).
