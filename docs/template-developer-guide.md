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
| `$CMS_VALUE(assetType:uid.editorName)$` | value from another asset (see §2.6) |
| `$CMS_REF(assetType:uid)$` | resolved URL/href |
| `$CMS_REF(editorName)$` | URL for a link/media/reference value |
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

### 2.6 Reference resolution (§16.4)

`assetType:uid` resolves to a UUID at compile time and records an `asset_reference` row. An unresolvable UID is a compile error (`SF-TPL-0110`); a soft-deleted target degrades to an empty render with a warning. `$CMS_REF` resolves pages → output path (per URL strategy), media → public path (`?variant=w800`), folders → index page.

Cross-asset values walk the target's *root value object* exactly like a local value, so paths, `$CMS_IF`, `$CMS_SET`, `$CMS_FOR` and filters work unchanged (`$CMS_FOR(link : page:about.links)$`). The root value object is: `page` → the page's editor values (bodies are not exposed); `media` → `altText`, `caption`, `copyright`, `fileName`, `mimeType`, `width`, `height`, …; `page_reference` → `label`, …; template and folder types → no values. Every asset also exposes a reserved `_meta` object with `uid` and `displayName` (`$CMS_VALUE(page:about._meta.displayName)$`). Values are escaped by the channel default like any other value. A target deleted after compile renders empty with a warning (`SF-TPL-0112`); the dependency on it is still recorded. A path-less `$CMS_VALUE(page:about)$` is a warning (`SF-TPL-0111`).

## Part 3 — Diagnostics

### 3.1 OCTL (`SF-TPL-*`) — `template.diagnostic.DiagnosticCodes`

| Code | Severity | Meaning |
|---|---|---|
| `SF-TPL-0101` | error | unknown instruction |
| `SF-TPL-0102` | error | unbalanced block (missing `$CMS_END_IF$`) |
| `SF-TPL-0103` | error | unknown editor name in scope |
| `SF-TPL-0104` | error | unknown filter |
| `SF-TPL-0110` | error | unresolvable asset reference |
| `SF-TPL-0120` | error | `$CMS_BODY` used in a section template |
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

The render-time limits (`SF-TPL-0130`–`0133`, `0135`) fail only the affected file in generation and return a `422` problem in preview. They apply to the **whole page render**: loop iterations, output size and time are counted across the page template and every section, include and catalog card rendered inside it, not per nested template.

### 3.2 CDL (`SF-CDL-*`) — `template.diagnostic.DiagnosticCodes`

| Code | Severity | Meaning |
|---|---|---|
| `SF-CDL-0101` | error | duplicate editor name |
| `SF-CDL-0102` | error | reserved editor name |
| `SF-CDL-0103` | error | unknown editor type |
| `SF-CDL-0104` | error | invalid attribute |
| `SF-CDL-0105` | error | invalid `visibleWhen`/validation expression |
| `SF-CDL-0106` | error | invalid editor name |
| `SF-CDL-0200` | error | CDL syntax error |

### 3.3 Generation (`SF-GEN-*`) — `generate.GenerationDiagnosticCodes` + `generate.GenerationService`

| Code | Severity | Meaning |
|---|---|---|
| `SF-GEN-0110` | error | output path collision |
| `SF-GEN-0210` | warning | no channel template for an enabled channel |
| `SF-GEN-0410` | warning | navigation cycle truncated |
| `SF-GEN-0411` | error | `$CMS_NAVIGATION` tree contains a dangling `PAGE_REFERENCE` (target missing/deleted, or an empty folder subtree) |
| `SF-GEN-0500` | 409 | a generation run is already active |

### 3.4 Errors carry the fix

The UI copies this philosophy (§24.6): a diagnostic includes "did you mean?" suggestions and click-to-insert links. When you change a UID, the UID-change response (`UidChangeResult`) lists affected templates whose source still references the old UID literally (§6.4).

## Part 4 — Worked end-to-end

The full `teaser` template, stored page content, and generated HTML + Markdown are worked through in `cms-specification.md` Appendix A. Golden-file triples (`template + content + expected output`) live under `server/sf-template/src/test/resources/render/` (`value-basic`, `value-filters`, `if-elseif-else`, `for-list-nested`, `escaping-xss`, …) and `render-md/` — adding an OCTL feature is adding a directory there (§25.4).
