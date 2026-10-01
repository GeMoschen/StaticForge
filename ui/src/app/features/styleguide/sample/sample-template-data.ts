/**
 * The two templates the sample's template view opens (M35.9, decisions 15–18): the page template "Article" and the
 * section template "Product teaser" (the card type of the page's catalog) — their CDL sections, channel templates in
 * OCTL, output settings and one deliberate problem each side. Source code and schema data, not UI text.
 */
import type { CodeDiagnostic } from '../../../shared/code-editor/code-editor.types';
import type { CodeFormat } from '../../../shared/code-editor/code-format';

export type SampleCdlSection = 'content' | 'bodies' | 'rules';
export const CDL_SECTIONS: readonly SampleCdlSection[] = ['content', 'bodies', 'rules'];
export type SampleTemplateChannel = 'html' | 'rss';
/** The `template` query values. */
export type SampleTemplateKey = 'article' | 'teaser';

/** A problem a source has while it contains `find` (fixing the text removes it). */
interface SampleProblem {
  readonly find: string;
  readonly severity: 'ERROR' | 'WARNING';
  readonly code: string;
  readonly message: string;
}

export interface SampleChannelSource {
  readonly id: SampleTemplateChannel;
  readonly format: CodeFormat;
  readonly source: string;
  readonly problems?: readonly SampleProblem[];
}

export interface SampleTemplateSettings {
  readonly outputPath: string;
  /** Page templates only. */
  readonly paginationPath: string | null;
  readonly channels: Readonly<Record<string, boolean>>;
}

export interface SampleTemplateDef {
  /** The id in the templates tree. */
  readonly id: string;
  readonly key: SampleTemplateKey;
  readonly kind: 'page' | 'section';
  readonly uid: string;
  /** Tree ids of the ancestors, outermost first. */
  readonly inherits: readonly string[];
  readonly cdl: Readonly<Partial<Record<SampleCdlSection, string>>>;
  readonly cdlProblems?: Readonly<Partial<Record<SampleCdlSection, readonly SampleProblem[]>>>;
  readonly channels: readonly SampleChannelSource[];
  readonly settings: SampleTemplateSettings;
}

const ARTICLE: SampleTemplateDef = {
  id: 't-page-article',
  key: 'article',
  kind: 'page',
  uid: 'article',
  inherits: ['t-page-base_page', 't-page-content_page'],
  cdl: {
    content: `editor text title {
  label "Title"
  localizable
  required
  maxLength 90
}

editor text teaser {
  label "Teaser"
  localizable
  multiline
  maxLenght 240
}

editor date publishedOn { label "Publication date" required }

editor select category {
  label "Category"
  options [
    { value "news"     label "News" },
    { value "events"   label "Events" },
    { value "products" label "Products" }
  ]
}

editor media image {
  label "Image"
  mimeTypes ["image/*"]
}

editor catalog teasers {
  label "Product teasers"
  allow ["product_teaser", "quote", "badge"]
  max 6
}`,
    bodies: `body main {
  label "Main content"
  allow ["hero", "text", "product_teaser", "quote"]
}`,
    rules: `rule "teaser-length" on teaser {
  level warning
  scope [edit, release]
  when "!isEmpty(teaser)"
  assert "length(value) <= 200"
  message { en "Teasers over 200 characters are cut in lists" de "Teaser über 200 Zeichen werden in Listen gekürzt" }
}

rule "one-hero" on page {
  level error
  scope [save, release]
  assert "count(sections(body.main, 'hero')) == 1"
  message { en "An article needs exactly one hero" de "Ein Artikel braucht genau einen Hero" }
}`,
  },
  cdlProblems: {
    content: [{ find: 'maxLenght', severity: 'ERROR', code: 'SF-CDL-0104', message: "Unknown attribute 'maxLenght' — did you mean 'maxLength'?" }],
  },
  channels: [
    {
      id: 'html',
      format: 'HTML',
      source: `$CMS_EXTENDS(page_template:content_page)$
$CMS_BLOCK(content)$
<article class="article">
  <p class="kicker">$CMS_VALUE(category)$ · $CMS_VALUE(publishedOn | date("d MMMM yyyy"))$</p>
  <h1>$CMS_VALUE(title)$</h1>
  <p class="lead">$CMS_VALUE(teaser)$</p>
  $CMS_IF(image)$
    <img src="$CMS_REF(image)$" alt="$CMS_VALUE(image.alt)$">
  $CMS_END_IF$
  $CMS_BODY(main)$
  $CMS_IF(teasers)$
    <section class="teasers">$CMS_VALUE(teasers)$</section>
  $CMS_END_IF$
  <p class="more">$CMS_VALUE(page:shop)$</p>
</article>
$CMS_END_BLOCK$`,
      problems: [
        {
          find: '$CMS_VALUE(page:shop)$',
          severity: 'WARNING',
          code: 'SF-TPL-0111',
          message: 'Cross-asset value without an editor path: page:shop renders as its name only.',
        },
      ],
    },
    {
      id: 'rss',
      format: 'XML',
      source: `<item>
  <title>$CMS_VALUE(title)$</title>
  <link>$CMS_META(path)$</link>
  <pubDate>$CMS_VALUE(publishedOn | date("EEE, dd MMM yyyy", "en"))$</pubDate>
  <category>$CMS_VALUE(category)$</category>
  <description>$CMS_VALUE(teaser)$</description>
  <guid isPermaLink="false">$CMS_META(uuid)$</guid>
</item>`,
    },
  ],
  settings: {
    outputPath: '{locale}/{folder}{uid}.{ext}',
    paginationPath: '{pagePath}/page/{pageNumber}/index.{ext}',
    channels: { html: true, rss: true },
  },
};

const TEASER: SampleTemplateDef = {
  id: 't-section-product_teaser',
  key: 'teaser',
  kind: 'section',
  uid: 'product_teaser',
  inherits: [],
  cdl: {
    content: `editor text name {
  label "Product name"
  required
}

editor text text {
  label "Teaser text"
  multiline
  maxLength 160
}

editor text price { label "Price" }

editor link link { label "Link" }

editor catalog badges {
  label "Badges"
  allow ["badge"]
  max 3
}`,
    rules: `rule "priced-teaser-links" on link {
  level warning
  scope [edit, release]
  when "!isEmpty(price)"
  assert "!isEmpty(link)"
  message { en "A teaser with a price should link to its product" de "Ein Teaser mit Preis sollte auf das Produkt verlinken" }
}`,
  },
  channels: [
    {
      id: 'html',
      format: 'HTML',
      source: `<div class="teaser">
  <div class="bag"></div>
  $CMS_IF(badges)$
    <div class="pills">$CMS_VALUE(badges)$</div>
  $CMS_END_IF$
  <b>$CMS_VALUE(name)$</b>
  <p>$CMS_VALUE(text)$</p>
  $CMS_IF(price)$
    <a class="price" href="$CMS_REF(link)$">$CMS_VALUE(price)$</a>
  $CMS_END_IF$
</div>`,
    },
  ],
  settings: { outputPath: '', paginationPath: null, channels: { html: true } },
};

export const TEMPLATE_DEFS: readonly SampleTemplateDef[] = [ARTICLE, TEASER];

export function templateDefById(id: string | null): SampleTemplateDef | null {
  return TEMPLATE_DEFS.find((def) => def.id === id) ?? null;
}

export function templateDefByKey(key: string | null): SampleTemplateDef | null {
  return TEMPLATE_DEFS.find((def) => def.key === key) ?? null;
}

/** The problems of a source at their current positions (1-based); a problem whose text is gone is fixed. */
export function diagnosticsOf(source: string, problems: readonly SampleProblem[] | undefined): CodeDiagnostic[] {
  const lines = source.split('\n');
  return (problems ?? []).flatMap((problem) => {
    const line = lines.findIndex((text) => text.includes(problem.find));
    if (line < 0) {
      return [];
    }
    const { severity, code, message } = problem;
    return [{ severity, code, message, line: line + 1, column: lines[line].indexOf(problem.find) + 1 }];
  });
}
