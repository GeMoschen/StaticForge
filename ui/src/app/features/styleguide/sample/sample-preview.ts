import { SampleCard } from './sample-catalog';
import { SampleArticleText, SampleLang, SampleSectionKind } from './sample-data';

/** What the fake website page is built from: the editor's current values, sections in outline order. */
export interface SamplePreviewInput {
  readonly lang: SampleLang;
  readonly text: SampleArticleText;
  readonly title: string;
  readonly teaser: string;
  readonly headline: string;
  readonly cta: string;
  readonly body: string;
  readonly quote: string;
  readonly attribution: string;
  readonly alt: string;
  readonly dateLabel: string;
  readonly showPrice: boolean;
  readonly sections: readonly SampleSectionKind[];
  /** The "Product teasers" catalog, in order. */
  readonly teasers: readonly SampleCard[];
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

/**
 * The website's own stylesheet. This is the previewed *site*, rendered inside a sandboxed `srcdoc` iframe — not app
 * styling — so it has its own palette and does not follow the app tokens or theme.
 */
const SITE_CSS = `
  *{box-sizing:border-box}
  body{margin:0;font:16px/1.6 Georgia,'Times New Roman',serif;color:#2d2621;background:#fbf7f2}
  a{color:inherit}
  .bar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 32px;background:#fff;border-bottom:1px solid #eadfd3;font:600 14px/1.4 system-ui,sans-serif}
  .brand{display:flex;align-items:center;gap:8px;letter-spacing:.02em}
  .brand i{display:inline-block;width:22px;height:22px;border-radius:50%;background:#b5652b;box-shadow:inset -6px 0 0 #8a4a1d}
  nav{display:flex;gap:20px;font-weight:500;color:#6b5b4e}
  nav span.on{color:#b5652b}
  main{max-width:760px;margin:0 auto;padding:40px 32px 24px}
  .kicker{margin:0 0 8px;font:600 12px/1.4 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#b5652b}
  h1{margin:0 0 12px;font-size:40px;line-height:1.15;font-weight:normal}
  .lead{margin:0 0 28px;font-size:19px;color:#5a4c41}
  figure{margin:0 0 28px}
  figure svg{display:block;width:100%;height:auto;border-radius:10px}
  figcaption{margin-top:6px;font:13px/1.4 system-ui,sans-serif;color:#8a7a6c}
  h2{margin:32px 0 8px;font-size:26px;font-weight:normal}
  .cta{display:inline-block;margin-top:4px;padding:10px 18px;border-radius:999px;background:#2d2621;color:#fbf7f2;font:600 14px/1.2 system-ui,sans-serif;text-decoration:none}
  ul{padding-left:20px}
  li{margin:4px 0}
  .product{display:flex;align-items:center;gap:16px;margin:28px 0;padding:16px;border:1px solid #eadfd3;border-radius:10px;background:#fff;font-family:system-ui,sans-serif}
  .bag{width:56px;height:72px;border-radius:6px 6px 10px 10px;background:linear-gradient(#c98a55,#9c5a2a)}
  .product b{display:block;font-size:15px}
  .product span{color:#b5652b;font-weight:600}
  blockquote{margin:32px 0;padding:4px 0 4px 20px;border-left:3px solid #b5652b;font-size:21px;font-style:italic;color:#4a3d33}
  cite{display:block;margin-top:6px;font:normal 13px/1.4 system-ui,sans-serif;color:#8a7a6c}
  footer{margin-top:40px;padding:20px 32px;border-top:1px solid #eadfd3;font:13px/1.5 system-ui,sans-serif;color:#8a7a6c;text-align:center}
  .teasers{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin:32px 0 0;font-family:system-ui,sans-serif}
  .teaser{display:flex;flex-direction:column;gap:6px;padding:16px;border:1px solid #eadfd3;border-radius:10px;background:#fff}
  .teaser .bag{width:44px;height:56px}
  .teaser b{font-size:15px}
  .teaser p{margin:0;font-size:14px;line-height:1.5;color:#5a4c41}
  .teaser .price{color:#b5652b;font-weight:600}
  .teaser blockquote{margin:0;padding:0 0 0 12px;font-size:17px}
  .pills{display:flex;flex-wrap:wrap;gap:6px}
  .pill{display:inline-block;padding:2px 10px;border-radius:999px;background:#f3e7da;color:#6b5b4e;font:600 12px/1.6 system-ui,sans-serif}
  .pill--accent{background:#b5652b;color:#fff}
  .pill--success{background:#dcebd3;color:#355a2a}
  .pill--warning{background:#f6dfb8;color:#7a4d10}
  @media (max-width:520px){.bar{padding:12px 16px}nav{display:none}main{padding:24px 16px}h1{font-size:30px}}
`;

/** The hero image: drawn inline (highlands at dawn, drying beds), so the preview needs no external file. */
export const HERO_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 340" aria-hidden="true">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6d8b8"/><stop offset="1" stop-color="#f3e7da"/></linearGradient>
      <linearGradient id="hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f8f5a"/><stop offset="1" stop-color="#4c6b3d"/></linearGradient>
    </defs>
    <rect width="760" height="340" fill="url(#sky)"/>
    <circle cx="590" cy="110" r="44" fill="#f2b880"/>
    <path d="M0 210 C120 150 220 170 330 200 S560 150 760 190 V340 H0Z" fill="#9db27f"/>
    <path d="M0 250 C160 200 300 230 420 250 S640 220 760 240 V340 H0Z" fill="url(#hill)"/>
    <g fill="#8a4a1d">
      <rect x="70" y="270" width="250" height="14" rx="3"/><rect x="380" y="282" width="300" height="14" rx="3"/>
    </g>
    <g fill="#c0392b">
      <circle cx="95" cy="266" r="5"/><circle cx="120" cy="265" r="5"/><circle cx="150" cy="267" r="5"/><circle cx="182" cy="265" r="5"/>
      <circle cx="214" cy="266" r="5"/><circle cx="246" cy="265" r="5"/><circle cx="280" cy="266" r="5"/><circle cx="405" cy="278" r="5"/>
      <circle cx="440" cy="277" r="5"/><circle cx="478" cy="278" r="5"/><circle cx="515" cy="277" r="5"/><circle cx="552" cy="278" r="5"/>
      <circle cx="590" cy="277" r="5"/><circle cx="628" cy="278" r="5"/><circle cx="660" cy="277" r="5"/>
    </g>
  </svg>`;

function section(kind: SampleSectionKind, input: SamplePreviewInput): string {
  const { text } = input;
  switch (kind) {
    case 'hero':
      return `
        <figure>${HERO_SVG}<figcaption>${escape(input.alt)}</figcaption></figure>
        <h2>${escape(input.headline)}</h2>
        <a class="cta" href="#">${escape(input.cta)}</a>`;
    case 'text':
      return `
        <p>${escape(input.body)}</p>
        <h2>${escape(text.listTitle)}</h2>
        <ul>${text.listItems.map((item) => `<li>${escape(item)}</li>`).join('')}</ul>`;
    case 'product':
      return `
        <div class="product"><div class="bag"></div><div><b>${escape(text.productName)}</b>${
          input.showPrice ? `<span>${escape(text.price)}</span>` : ''
        }</div></div>`;
    case 'quote':
      return `<blockquote>${escape(input.quote)}<cite>— ${escape(input.attribution)}</cite></blockquote>`;
  }
}

function pill(badge: SampleCard): string {
  const label = badge.fields['label']?.trim();
  return label ? `<span class="pill pill--${escape(badge.fields['tone'] ?? '')}">${escape(label)}</span>` : '';
}

/** One card of the "Product teasers" catalog as the site renders it. */
function teaser(card: SampleCard): string {
  const f = card.fields;
  switch (card.type) {
    case 'product': {
      const pills = (card.badges ?? []).map(pill).join('');
      return `<div class="teaser"><div class="bag"></div>${pills ? `<div class="pills">${pills}</div>` : ''}<b>${escape(
        f['name'] ?? '',
      )}</b><p>${escape(f['text'] ?? '')}</p><span class="price">${escape(f['price'] ?? '')}</span></div>`;
    }
    case 'quote':
      return `<div class="teaser"><blockquote>${escape(f['quote'] ?? '')}<cite>— ${escape(f['author'] ?? '')}</cite></blockquote></div>`;
    default:
      return `<div class="teaser"><div class="pills">${pill(card)}</div></div>`;
  }
}

/** The complete `srcdoc` document of the preview. */
export function buildPreviewDocument(input: SamplePreviewInput): string {
  const { text } = input;
  const nav = text.nav.map((item, i) => `<span${i === 2 ? ' class="on"' : ''}>${escape(item)}</span>`).join('');
  return `<!doctype html>
<html lang="${input.lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${SITE_CSS}</style></head>
<body>
  <div class="bar"><span class="brand"><i></i>Lumen Coffee Roasters</span><nav>${nav}</nav></div>
  <main>
    <p class="kicker">${escape(text.kicker)} · ${escape(input.dateLabel)}</p>
    <h1>${escape(input.title)}</h1>
    <p class="lead">${escape(input.teaser)}</p>
    ${input.sections.map((kind) => section(kind, input)).join('\n')}
    ${input.teasers.length ? `<section class="teasers">${input.teasers.map(teaser).join('')}</section>` : ''}
  </main>
  <footer>${escape(text.footer)}</footer>
</body>
</html>`;
}
