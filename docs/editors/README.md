# CDL editors — reference

For **template developers** (persona *Dev*). CDL (content definition language) declares the
editors a section/page template exposes — the fields a content editor fills in in Monaco/the
Angular form engine. Each editor type has its own file in this directory. Normative reference:
`cms-specification.md` §14; this reference points every claim at the code that implements it
(`server/sf-template/src/main/java/com/acme/staticforge/template/cdl/`).

For everything else CDL (bodies, `visibleWhen`, the OCTL language that renders these values, and
diagnostic codes), see `../template-developer-guide.md`.

## Editor types

| Type | File | Stored value |
|---|---|---|
| `text` | [text.md](text.md) | `string` |
| `textarea` | [textarea.md](textarea.md) | `string` |
| `richtext` | [richtext.md](richtext.md) | `{ "format":"html", "value":"…" }` |
| `markdown` | [markdown.md](markdown.md) | `string` |
| `number` | [number.md](number.md) | `number` |
| `boolean` | [boolean.md](boolean.md) | `boolean` |
| `date` | [date.md](date.md) | ISO-8601 `string` (date only) |
| `datetime` | [datetime.md](datetime.md) | ISO-8601 `string` (date + time) |
| `select` | [select.md](select.md) | `string` |
| `multiselect` | [multiselect.md](multiselect.md) | `string[]` |
| `color` | [color.md](color.md) | `#rrggbb` |
| `link` | [link.md](link.md) | `{kind, uuid?, url?, anchor?, target?, title?}` |
| `media` | [media.md](media.md) | `{type:"MEDIA_REF", uuid, variant?, altOverride?}` |
| `reference` | [reference.md](reference.md) | `{type:"ASSET_REF", uuid, assetType}` |
| `list` | [list.md](list.md) | array of item objects |
| `group` | [group.md](group.md) | nested object (transparent wrapper) |
| `json` | [json.md](json.md) | arbitrary JSON |
| `catalog` | [catalog.md](catalog.md) | `{type:"CATALOG", cards:[…]}` |
| `pagination` | [pagination.md](pagination.md) | `{type:"PAGINATION", source:{kind, uuid}, pageSize, sort:{key, direction}}` |

All 19 are `EditorType` enum constants (`template/content/EditorType.java`); the CDL keyword
(lowercase, e.g. `editor text headline { … }`) maps to one via `CdlValidator.TYPES`.

## Attributes common to every editor type

`label`, `help`, `required`, `default`, `readOnly`, `hidden`, `visibleWhen`, `renamedFrom`, `localizable`.

```
editor text ctaLabel {
  label       "Button label"
  help        "Shown on the CTA button."
  required
  default     "Learn more"
  visibleWhen "showCta == true"
}
```

`visibleWhen` grammar is deliberately tiny: `identifier (== | != | > | < | >= | <= | in) literal`
with `&&`, `||`, `!`, parentheses (§14.4). Evaluated by `ExpressionEvaluator` (backend) and the
Angular form engine from one shared fixture file, so it behaves identically everywhere.

`renamedFrom` lets a CDL rename migrate existing stored content in one revision (§12.3):

```
editor richtext body { label "Body", renamedFrom "text" }
```

### `localizable` — one value per language (M24)

`localizable` makes a leaf editor language-dependent in a project that declares languages
(**Project settings → Languages**):

```
editor text headline { label "Headline" localizable }
```

Its stored value is a wrapper holding one value per language instead of a bare value:

```json
"headline": { "type": "L10N", "values": { "de": "Die Parka", "en": "The parka" } }
```

A language missing from `values` is "not translated" and resolves through that language's fallback chain
(the language, its declared fallbacks, then the default language) when the page renders.

**Only leaf editors.** Page structure — bodies, section order, list items, catalog cards — is shared by every
language, so `group`, `list`, `catalog` and `pagination` reject the attribute with `SF-CDL-0112`. Leaf editors
*inside* a list item or group may be localizable; a catalog card's fields follow its own section template's CDL.

**Validation.** Each language's value is checked against the editor's own rules (`maxLength`, `pattern`, `min`/`max`,
…) and the finding names the language: `headline.values.en`. `required` is enforced for the default language only.
A value stored for a language the project no longer declares is a warning, never an error — the value is kept so
re-adding the language restores it.

**Toggling it.** Turning `localizable` on migrates every stored value of that editor into the wrapper, under the
default language, in one revision. Turning it off reduces each wrapper to its default-language value; because that
discards the other translations, the save is refused with a `409` listing what would be lost until it is re-sent
with `confirmDiscard=true`. Enabling or disabling the project's languages migrates the same way.

**In a project without languages** `localizable` is inert: values stay bare, exactly as before M24.

**Accepted but not currently enforced:** the parser also accepts `group`, `order`, `pattern`, and
`message` as bare top-level attributes on any editor (no `SF-CDL-0104` error) — but their values
are parsed and discarded, never carried into the compiled `EditorDefinition`
(`CdlParser.dispatch`'s `skipValue()` branch). If you write these, nothing breaks, but nothing
happens either; don't rely on them for ordering or grouping today (group editors *inside* a
`group "…" { … }` wrapper block instead — that's a real, load-bearing construct; see below).

## Grouping — `group "label" { … }`

Not an editor type, a **wrapper**: groups a set of editors under a section label in the form UI,
transparent for editor-name uniqueness (a name inside a group still can't collide with a sibling
outside it).

```
group "Headline area" {
  editor text headline { label "Headline" required maxLength 80 }
  editor text kicker   { label "Kicker" maxLength 40 }
}
```

## Validation

A `validate` clause on an editor carries one check — `pattern "…" [message "…"]`, or `maxLength N`,
`maxChars N`, `min N`, or `max N`; an editor may have several. Prefer the type-specific attributes
documented on each editor's own page (`maxLength` on `text`, `min`/`max` on `number`/`list`/`catalog`,
etc.) — those are the commonly-used path; `validate` exists for the `pattern`/`message` case, which
has no dedicated attribute.

**Built-in rules and their modifiers (M33).** `required`, `maxLength`, `maxChars`, `min`, `max`,
`mimeTypes` and every `validate` clause are *built-in rules*. Without modifiers each is
`level error scope [edit, release, generation] onGeneration holdBack`: shown while editing, blocking a
release, holding the page back at build, never blocking a save. Trailing modifiers change that for the
attribute they follow:

```
editor text title {
  label "Title"
  required level warning scope [edit, release]
  maxLength 160 level info scope [edit]
  validate pattern "^[A-Z]" message { en "Start with a capital" de "Mit Großbuchstaben beginnen" } level hint
}
```

`level` is `hint`, `info`, `warning` or `error`; `scope` a list of `edit`, `save`, `release`,
`generation`; `onGeneration` `holdBack` or `fail` (only with `level error` and `generation` in the
scope); `message` a map per UI language (a single string is the `en` entry), with the placeholders
`{value}`, `{length}`, `{min}`, `{max}`, `{index}`, `{locale}`. An invalid modifier is `SF-CDL-0119`.
Only the template that declares the editor can set them — a child template can't re-level an inherited
editor.

**Rules across fields.** Checks that involve more than one field, list rows, a page's sections or a
referenced asset — and computed values (`fill`) and conditional `requiredWhen`/`readOnlyWhen` (`state`) —
go into a top-level `rules {}` section of the same CDL: see the template developer guide, §1.1, and
spec §14.8.

### When content is validated (§10.5)

The server validates page, section, catalog-card, record and property-set content against these
definitions (`ContentValidator`, `PageContentValidator`, `RuleEngine`). Every finding (`ContentIssue`) has
a `path` such as `content.headline` or `bodies.main[2].content.links[0].target`, a `severity` (`ERROR`,
`WARNING`, `INFO`, `HINT`), the `scopes` it applies in, and one of two `kind`s:

| Kind | Codes | Effect |
|---|---|---|
| `STRUCTURAL` | `type` (wrong JSON type or malformed `link`/`media`/`reference`/`catalog`/list-item shape), `option` (value outside `options`), `allow` (section or card template outside the body's/editor's `allow` list), `template` (card template not found), `dataset` (a `reference` with `dataset "uid"` pointing outside that dataset, M19 — or at a record set when its `assetTypes` don't name `RECORD_SET`, M25), `pagination` | not a rule: the save is always rejected with `422 SF-API-0422`, listing the findings under `issues` |
| `COMPLETENESS` | built-ins `required`, `min`, `max`, `maxLength`, `maxChars`, `pattern`, `mimeType`; `rule` (a `rules {}` rule); `rule-eval`, `read-only` | an `ERROR` blocks the actions of its scopes: a save (`422 SF-API-0422`), a release (`SF-DOM-0150`), a build (the page language is held back with `SF-GEN-0120`, or the run fails with `SF-GEN-0121` for `onGeneration fail`). A `WARNING` needs confirming at release (`SF-DOM-0156`) and is a build warning (`SF-GEN-0122`); `INFO` and `HINT` never block. With the default scopes the save succeeds and the page view lists the findings under `issues` |

Editors hidden by `visibleWhen` are skipped. An untouched `media`/`reference`/`link` value (no
`uuid`/`url`/`anchor`) counts as empty. The structural check of section, body and content-patch
operations covers only the part of the page they change, so content saved before validation existed
doesn't block them; a full page update (`PUT`, which autosave uses) checks the whole page. Save-scope
rules (only those that name `save`) run on every save, autosave included, after read-only enforcement
and the save fills.

## A complete example (§14.2)

```
content {
  group "Headline area" {
    editor text headline {
      label       "Headline"
      help        "Shown as H1. Keep it under 60 characters."
      required
      maxLength   80
      default     "New headline"
    }
    editor text kicker { label "Kicker" maxLength 40 }
  }

  editor richtext body { label "Body text" features [bold, italic, link, list, h2, h3, quote] maxChars 4000 }

  editor media heroImage {
    label      "Hero image"
    mimeTypes  ["image/jpeg", "image/png", "image/webp"]
    required
  }

  editor reference relatedPage { label "Related page" assetTypes [PAGE] }

  editor select layout {
    label "Layout"
    options [
      { value "left",  label "Image left"  },
      { value "right", label "Image right" },
      { value "full",  label "Full bleed"  }
    ]
    default "left"
  }

  editor boolean showCta { label "Show call to action" default false }

  editor list links {
    label "Link list"
    min 0
    max 8
    item {
      editor text label  { label "Link text" required }
      editor link target { label "Target" }
    }
  }

  editor date publishedOn { label "Published on" }

  editor catalog related { label "Related cards" allow ["teaser", "cta_box"] min 0 max 6 }
}
```

## Bodies — page templates only (§14.6)

Not an editor either, but declared alongside them in a page template's content definition:

```
bodies {
  body main    { label "Main content" allow ["*"] }
  body sidebar { label "Sidebar" allow ["teaser","cta_box"] max 4 }
}
```

`allow` entries are section-template **UIDs** or `"*"`. The compiler cross-checks this against
`$CMS_BODY` occurrences in each channel template — see `../template-developer-guide.md` Part 2.
