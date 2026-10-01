import type { CodeDiagnostic } from '../../shared/code-editor/code-editor.types';

/**
 * Sample sources of the style guide's code editor section (M35.9, decisions 16–18): sample content, kept as data like
 * `styleguide.demo.ts` (in a file of its own, so the long sources stay apart from the component labels).
 */

/** The page template "Article": content, bodies and rules, with one deliberate error (an unknown editor type). */
const CDL = `// Article — page template
content {
  editor text title { label "Title" required maxLength 120 }
  editor date published { label "Published" }
  editor txt teaser { label "Teaser" }
  group seo {
    editor text description { label "Description" visibleWhen "title != ''" }
  }
}
bodies {
  body main { label "Main" allow ["product_teaser", "text_block"] }
}
rules {
  rule "teaser-length" on teaser {
    level warning
    scope [edit, save]
    assert "length(teaser) <= 280"
    message "Keep the teaser under 280 characters"
  }
}
`;

/** The Article's HTML channel in OCTL, with one warning (a path-less cross-asset value). */
const OCTL_HTML = `<article class="article">
  <h1>$CMS_VALUE(title)$</h1>
  $CMS_IF(!isEmpty(published))$
    <time datetime="$CMS_VALUE(published)$">$CMS_VALUE(published)$</time>
  $CMS_END_IF$
  <p class="teaser">$CMS_VALUE(teaser)$</p>
  <aside>$CMS_VALUE(page:about)$</aside>
  <!-- the main body: product teasers and text blocks -->
  $CMS_BODY(main)$
  <script>
    const words = document.querySelectorAll('.article p').length;
  </script>
</article>
`;

/** A JSON document, compact so Format has something to do. */
const JSON_SOURCE = `{"uid":"article","displayName":"Article","channels":["html","rss"],
"settings":{"outputPath":"/news/{uid}.html","pagination":{"pageSize":10,"enabled":false}}}
`;

export const CODE_DEMO = {
  cdl: {
    fileName: 'article.cdl',
    languageLabel: 'CDL',
    label: 'Article template, content definition',
    source: CDL,
    diagnostics: [
      {
        severity: 'ERROR',
        code: 'SF-CDL-0101',
        message: "Unknown editor type 'txt'. Did you mean 'text'?",
        line: 5,
        column: 10,
      },
      {
        severity: 'INFO',
        code: 'SF-CDL-0130',
        message: 'The rule checks an editor that is not required.',
        line: 14,
        column: 3,
      },
    ] satisfies CodeDiagnostic[],
  },
  octl: {
    fileName: 'html.octl',
    languageLabel: 'OCTL · HTML',
    label: 'Article template, HTML channel',
    source: OCTL_HTML,
    diagnostics: [
      {
        severity: 'WARNING',
        code: 'SF-TPL-0111',
        message: 'A path-less value of another asset renders its UID. Name a field, e.g. page:about.title.',
        line: 7,
        column: 10,
      },
    ] satisfies CodeDiagnostic[],
  },
  json: {
    fileName: 'article.json',
    languageLabel: 'JSON',
    label: 'Article template settings',
    source: JSON_SOURCE,
  },
  readOnly: {
    fileName: 'rss.octl',
    languageLabel: 'OCTL · XML',
    label: 'Article template, RSS channel (read-only)',
    source: `<item>
  <title>$CMS_VALUE(title)$</title>
  <link>$CMS_REF(CMS_PAGE)$</link>
  <pubDate>$CMS_VALUE(published)$</pubDate>
  <description><![CDATA[$CMS_VALUE(teaser)$]]></description>
</item>
`,
  },
  where: {
    label: 'Record set filter',
    source: `category == "news" && !isEmpty(teaser) && published >= "2026-01-01"`,
  },
  /** The word the swatch table shows in each syntax colour. */
  sample: 'content',
} as const;
