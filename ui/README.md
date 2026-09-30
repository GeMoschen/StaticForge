# StaticForge UI

Angular (zoneless, signals) frontend. `npm start` serves it with the API proxy, `npm test` runs vitest, `npm run build`
builds it.

## Translations (Transloco, M35.4)

Every user-visible text lives in `src/assets/i18n/en.json` (loaded at runtime from `assets/i18n/<lang>.json`). Only English
ships; `availableLangs` is in `src/app/core/i18n/i18n.config.ts`.

- **Keys:** `<feature>.<screen>.<element>` (for example `pages.editor.save`), plus `common.*` (Save, Cancel, Loading…,
  relative-time wording, counts), `enum.<enumName>.<VALUE>` (human labels of roles, statuses, audit actions, job states,
  asset types…), `shared.<component>.*` (shared components) and `shell.*` (app frame, palette, toasts).
- **Templates:** `{{ 'common.save' | transloco }}`, `[attr.aria-label]="'common.close' | transloco"`. Import `TranslocoPipe`.
  Parameters: `{{ 'shell.palette.noResults' | transloco: { query: q } }}`.
- **TypeScript:** `inject(TranslocoService).translate('key', params)`. Keep keys (not translated text) in constants and
  translate where they are shown, so a language switch re-renders.
- **Plurals and interpolation** use ICU messageformat: `"items": "{count, plural, one {# item} other {# items}}"`.
  Never write "item(s)". Apostrophes are fine; a literal `{` or `}` must be quoted as `'{`.
- **Dates, times, numbers:** `sfDateTime` (`'dateTime' | 'date' | 'time'`), `sfNumber` and `sfRelativeTime` in
  `shared/pipes`, backed by `core/i18n/i18n-format.service.ts`. They follow the active language and the browser's region
  (en-GB shows 24 h, en-US 12 h); `SF_HOUR_CYCLE` will carry a per-user 12 h / 24 h choice.
- **Missing keys:** dev builds `console.warn` and show the key; specs throw.
- **Adding a language:** add `assets/i18n/<lang>.json` and list the language in `AVAILABLE_LANGS`.

### Specs

`src/test-setup.ts` gives every TestBed Transloco with the real `en.json`, loaded synchronously, and the throwing
missing-key handler (`core/i18n/transloco-testing.ts`). A spec needs nothing extra, and asserts the English text as
before. A spec that calls `TestBed.resetTestingModule()` itself, or wants its own texts, adds
`provideTranslocoTesting()` / `provideTranslocoTesting({ common: { save: 'Sichern' } })` to its providers. Helpers that
take a `Translator` (for example `recordCountLabel(count, translate)`) get
`(key, params) => TestBed.inject(TranslocoService).translate(key, params)` in specs.

### Literal check (`npm run lint` / `npm run lint:i18n`)

`scripts/check-i18n-literals.mjs` flags English literals in templates (`*.html` and inline `template:`): text nodes,
`title` / `aria-label` / `placeholder` / `alt` (and `label` / `hint` / `description` of `sf-*` components), static or
bound, and string literals inside `{{ }}` that do not go through `transloco`. Text in `<kbd>`, `<code>` and `<pre>` is
ignored; `<!-- i18n-ignore -->` excuses the next tag or text node.

- `shared/**`, `core/ui/**` and the app shell must be clean, always.
- Screens that are not migrated yet are listed in `scripts/i18n-literals.baseline.json` (file -> number of findings). A
  baselined file may not get more findings, a new file may have none. When you migrate a screen, run
  `npm run lint:i18n -- --update-baseline`: the baseline only ever shrinks, and the screen is done when its entry is gone.
- The screen definition of done (M35.16 to M35.29) includes "every string goes through Transloco", which this check
  enforces.
