# M33 — Editor rules (template-defined filling and validation rules with scopes and levels)

**Spec:** Extends §10.5 (validation rules), §13.3 (inheritance), §14 (CDL: new `rules {}` section, §14.4 attributes,
§14.7 compiler), §5.5 / §20.2 (release), §18.2 / §18.5 (VALIDATE stage, run record), §19.4 (draft checks), §23.5
(form engine), §24.5 (screens), Appendix B. Not part of the original §27 roadmap — inserted the same way `M8`–`M32`
were.

## Goal

Today validation is a fixed set of editor attributes (`required`, `min`/`max`, `maxLength`, `maxChars`, one
`pattern`, `mimeTypes`, `options`) checked by `ContentValidator`. Scope and severity are hard-wired: STRUCTURAL
findings reject a save; COMPLETENESS findings of severity ERROR block a release (`SF-DOM-0150`) and hold the page back
at generation (`SF-GEN-0120`); WARNING blocks nothing. Templates can neither say *when* a check applies nor *how
severe* it is, cannot express cross-field or cross-asset checks, and cannot fill values.

After M33 a template developer writes **rules** for the editors of a content definition (page, section, dataset,
global set):

- **Validation rules** (`rule`): an assertion with a **level** (`hint`, `info`, `warning`, `error`) and one or more
  **scopes** (`edit`, `save`, `release`, `generation`) in which it runs.
- **State rules** (`state`): conditional `requiredWhen` / `readOnlyWhen` for an editor.
- **Fill rules** (`fill`): computed values written live while editing, on save and/or on release, either only into
  empty fields or always (then the field is computed and read-only).

The existing attributes stay and become **built-in rules** with today's behavior; their level and scope can be
overridden inline on the attribute. One server-side rule engine evaluates everything in every scope, including live
while editing.

## User decisions (2026-09-29)

1. **"Filling"** covers conditional required/readOnly, fill hints/guidance and auto-fill (computed values).
2. **Scopes:** `edit`, `save`, `release`, `generation`. A rule runs in exactly the scopes it names.
3. **Levels:** `hint`, `info`, `warning`, `error`.
4. **Existing attributes** (`required`, `maxLength`, `maxChars`, `pattern`, `min`/`max`, list/catalog cardinality,
   `mimeTypes`) are shorthand built-in rules with today's scope/level; their level/scope is overridable.
5. **Syntax:** custom rules live in a **separate top-level `rules {}` section** next to `content {}` / `bodies {}`.
6. **Expressions** gain functions, arithmetic and non-boolean (value) results, and a wider context (the editor's
   `value`, list row `item`/`index`, page meta, locale, template, release state, `global:` values).
7. **Fill timing:** live in the editor, on save (server) and on release. No generation-time (unstored) fill.
8. **Fill overwrite:** per rule — `mode empty` (only fills empty fields) or `mode always` (computed, read-only in the UI).
9. **Autosave:** a save-scope `error` rejects every save, **including autosave** (like STRUCTURAL today); the UI keeps
   the unsaved state locally.
10. **No override:** errors always block their scope's action; to get past one, the template developer changes the
    rule.
11. **Generation error:** chosen **per rule** — `onGeneration holdBack` (page/locale held back, run `PARTIAL`) or
    `onGeneration fail`.
12. **Inheritance:** a child template inherits all rules of the chain, can **add** rules and can **override an
    inherited rule by name** (or switch it `off`). Rules are available in page and section templates, **dataset
    schemas** (records) and **global set** CDL.
13. **Built-in overrides are inline on the attribute** (`required level warning scope [release]`), and only where the
    editor is declared — a child template cannot re-level an inherited editor's built-ins.
14. **Reach:** rules can target **list rows** (per row, `item`/`index`), page rules can check **sections and
    bodies**, and rules can read **referenced assets** (media, linked pages, records, …).
15. **Languages:** rules run **per locale** with `locale` in context; a rule restricts itself with `locales [default]`
    / `locales all` (default `all` for custom rules). Release and generation evaluate the locale being released/built.
16. **Messages:** a map per UI language, `message { en "…" de "…" }`, falling back to the first entry; placeholders
    like `{value}`, `{length}`, `{min}`, `{max}` are allowed.
17. **Edit scope is evaluated on the server only** — including live fills and `requiredWhen`/`readOnlyWhen`: the form
    sends the draft debounced and gets back findings, fill values and field states. `visibleWhen` stays client-side.
18. **Release warnings:** the plan lists them; the release dialog requires an explicit "Release with warnings"
    confirmation; scheduled releases proceed and record the warnings.
19. **Visibility:** `hint` only inline in the editor; `info` everywhere (editor, Issues panel, release plan, build
    results) but not counted as a problem; `warning`/`error` as today.
20. **Referenced assets:** `edit`/`save` read the referenced **draft**, `release`/`generation` the **released**
    version; a change to a referenced asset re-validates the referencing asset at the next incremental build (new
    planner edge).
21. **No defaults:** a custom `rule` must state `level` and `scope`; a missing one is a CDL error.
22. **`onGeneration fail`:** the build still validates **every** page (all failures reported in one run), then stops
    after VALIDATE with the run `FAILED` — nothing is published.
23. **Release fill** creates a new draft version with the filled values and releases that version, **in the same
    revision** (draft and released state stay equal).
24. **Read-only on save:** a changed value for a field whose `readOnlyWhen` holds, or that a `mode always` fill
    computes, is ignored — the server keeps the stored/computed value and returns an `info` finding; the save never
    fails for this reason.

## Findings from planning

1. **CDL.** `CdlParser` (top-level `content {}` / `bodies {}`, :97-110; attribute dispatch :202-261; `parseValidate`
   :279-304 is sugar for `pattern`/`maxLength`/`maxChars`/`min`/`max`, unknown kinds skipped silently),
   `CdlValidator`, `CdlCompiler` → `ContentDefinition` + `Diagnostic[]`. `EditorDefinition` holds `pattern` +
   `patternMessage` (the only author message). Last CDL code `SF-CDL-0112` (`DiagnosticCodes.java:100-121`);
   `SF-CDL-0113` onwards is free. Overlays `DatasetCdlRules` / `GlobalSetCdlRules`.
2. **Expressions.** `ExpressionEvaluator` (sf-template, 309 lines) is boolean-only: `or`/`and`/`!`, comparisons, `in`
   (substring for strings), literals; identifiers are dotted paths into the content JSON, missing → `null`. A single
   `=` is read as `==`. `ExpressionEvaluator.identifiers()` exists but is unused. UI port
   `ui/src/app/features/forms/expression-evaluator.ts` + `expression.fixtures.json` (only the UI test reads the
   fixtures, although §14.4/§23.5 say both sides do).
3. **Validation.** `ContentValidator` (sf-domain, 710 lines, pure) → `ContentIssue(path, code, Severity, message,
   Kind)`; Kind is derived from the code (STRUCTURAL = `type`, `option`, `allow`, `template`, `dataset`,
   `pagination`). `Severity` (sf-template) has only `ERROR`/`WARNING`. `visibleWhen`-hidden editors are skipped.
   List items are evaluated with the root scope, not the row. `required` on localizable editors applies to the
   default locale only. `PageContentValidator` adds bodies/sections; `PageContentValidation` uses the effective
   (inherited) definition and rejects STRUCTURAL only (`requireValid*`, :177-187).
4. **Save paths.** `PageServiceImpl` :91 (PUT, also autosave), :106/:110 (PATCH content/body), :127/:180/:205
   (sections); `RecordServiceImpl` :152-164; `GlobalSetServiceImpl` :125/:137/:214-224. Rejection is
   `422 SF-API-0422` with `issues` (`ProblemFactory` :95-103). `PageView.issues` / `RecordDetailView.issues` carry
   all findings (advisory).
5. **Release.** `ReleaseCompleteness` (:66-83; pages, records, global sets; other types count as complete) →
   `ReleaseServiceImpl` :115-131 (plan `Incomplete`), :143-163 (`422 SF-DOM-0150`); scheduled
   `ReleaseActionHandler` :161-206 (LATEST pin skips incomplete items). `SF-DOM-0156` onwards is free.
6. **Generation.** `RenderPipeline.incompletePages` (:132-165, called :250) builds `new PageContentValidator()`
   without `LocalizationContext`, dataset or pagination-source lookups — the M24 "required in the default locale"
   check is therefore not applied the same way at build as at release (fix on the way). A run can today never
   `FAILED` from content, only `PARTIAL`. `SF-GEN-0121` is free. Planner edge kinds: `RebuildEdgeKind`
   (`PAGE_TEMPLATE`, `SECTION_TEMPLATE`, `PARENT_TEMPLATE`, `REFERENCE`, `NAVIGATION`, …).
7. **Draft checks.** `POST …/preview/pages/{uuid}/checks` (`DraftCheckService`, rate-limited) returns
   `completeness` + quality `findings`; the page Issues panel (`page-issues-panel.component.ts`) re-checks after
   each autosave with a debounce.
8. **Frontend.** `form-builder.service.ts` mirrors some validators client-side (`required`, `maxLength`, `pattern`,
   `min`/`max`, JSON, list length, richtext `maxChars`) with fixed English messages (`errorMessageFor`). Server
   issues are folded onto the top-level editor (`sf-content-form.component.ts` `issuesFor`), severity not shown.
9. **Inheritance.** `EffectiveDefinition` = union of the chain root-first; a redeclared editor name is `SF-CDL-0109`
   and the ancestor wins. Nothing merges by name today.
10. **Quality checks (M30)** are a separate framework on rendered HTML with a project-level severity config
    (`QualitySeverity OFF/WARNING/ERROR`). They stay separate (decision 11).
11. Rules live in the template/dataset/global-set CDL, which already travels with export/import — **no export
    protocol change**, no Liquibase schema for rules.

## Decisions (binding for all tasks — revisit only with the user)

1. **CDL shape.** New top-level section `rules { … }` in a CDL source (page template, section template, dataset
   schema, global set). Entries:

   ```
   rules {
     rule "title-length" on title {
       level warning
       scope [edit, save]
       when "type == 'news'"                        // optional precondition
       assert "length(value) <= 70"
       message { en "Keep titles under 70 characters ({length})" de "Titel unter 70 Zeichen halten ({length})" }
       locales all                                   // or [default] or [de, en]
     }
     rule "caption-per-image" on gallery[] {        // per list row: item, index
       level error  scope [release, generation]  onGeneration holdBack
       assert "!isEmpty(item.caption)"
       message { en "Image {index} needs a caption" }
     }
     rule "one-hero" on page {                      // whole definition (page: bodies/sections)
       level error  scope [save, release]
       assert "count(sections(body.main, 'hero')) == 1"
       message { en "Exactly one hero section" }
     }
     rule "alt-text" on image {                     // referenced asset
       level warning  scope [edit, release]
       assert "!isEmpty(ref(value).meta.alt)"
       message { en "The selected image has no alt text" }
     }
     state teaser { requiredWhen "type == 'news'"  readOnlyWhen "release.status == 'PUBLISHED'" }
     fill slug { value "slugify(title)"  mode empty  on [edit, save] }
     fill publishDate { value "today()"  mode empty  on [release] }
     rule "legacy-check" off                         // switch off an inherited rule
   }
   ```

   - `on <path>`: an editor path (`a.b` through groups, `list[]` for rows, nested `list[].inner[]`), or `page` / `record`
     / `global` / `section` for the whole definition (the keyword matching the CDL kind).
   - `rule` requires `level`, `scope` and `assert` (decision 21) and a unique name within the effective chain;
     `message` is required too (fallback message would be meaningless for a custom assertion).
   - `onGeneration holdBack | fail` is allowed only when `scope` contains `generation` and `level` is `error`; default
     `holdBack` (today's behavior).
   - `state <path> { requiredWhen "…"; readOnlyWhen "…"; level …; scope […] }`: `requiredWhen` produces a built-in
     `required` finding with the stated level/scope (defaults = those of the editor's `required` built-in);
     `readOnlyWhen` makes the field read-only in the UI and triggers decision 24 on save.
   - `fill <path> { value "<expr>"; mode empty|always; on [edit, save, release] }` (no `level`; `on` must be a
     non-empty subset of `edit`, `save`, `release`). `mode always` makes the field read-only in the UI. Two fills on the
     same path, or a fill cycle (a fill reading a field another fill writes, transitively reaching itself), is a CDL
     error.

2. **Built-in rules and inline overrides.** `required`, `maxLength`, `maxChars`, `pattern`, `min`, `max`, `mimeTypes`
   and list/catalog cardinality accept trailing modifiers `level <l>`, `scope [<s>…]`, `onGeneration <g>`,
   `message {…}` (e.g. `required level warning scope [release]`, `maxLength 160 level info scope [edit]`). The
   `validate …` clause accepts the same modifiers. Without modifiers the built-in keeps today's behavior, expressed as
   rules: completeness built-ins = `level error scope [edit, release, generation] onGeneration holdBack` (edit makes
   them visible while typing as `PageView.issues` does today); a `pattern`'s `message "…"` becomes `{ en "…" }`.
   STRUCTURAL checks (`type`, `option`, `allow`, `template`, `dataset`, `pagination`) are **not** rules and not
   overridable — they reject every save as today. `patternMessage` is migrated to the message map. Built-in overrides
   are allowed only on the declaring template (decision 13); a child's `rules {}` cannot name a built-in.
3. **Inheritance merge.** `EffectiveDefinition` gains the effective rule set: rules/states/fills of the chain
   root-first; a child entry with the same rule name (or same `state`/`fill` path) **replaces** the ancestor's; `rule
   "x" off` removes it. Overriding or switching off a name that no ancestor defines is `SF-CDL-0118`. Section
   templates, dataset schemas and global sets have no chain — their `rules {}` is used as is.
4. **Expression language v2** (sf-template `ExpressionEvaluator`, one evaluator for every scope):
   - Values: string, number (decimal), boolean, null, list, object, date/datetime; results may be any value (for
     `fill`) — `assert`, `when`, `requiredWhen`, `readOnlyWhen` must yield boolean (else a runtime `warning` finding
     `rule-eval`, the rule counts as passed).
   - Operators: `+ - * / %` (`+` concatenates when either side is a string), comparisons, `and`/`or`/`!`, `in`,
     ternary `c ? a : b`, `??` (null-coalesce), parentheses, list literals. The single-`=` quirk becomes a parse error
     in `rules {}` (kept for `visibleWhen` for compatibility).
   - Functions (initial set, extensible registry): `length`, `isEmpty`, `count`, `matches(s, re)`, `lower`, `upper`,
     `trim`, `substring`, `concat`, `slugify`, `stripTags`, `wordCount`, `now`, `today`, `date(s)`, `daysBetween`,
     `min`, `max`, `sum`, `any(list, expr)`, `all(list, expr)`, `sections(body, templateUid?)`, `ref(value)`.
   - Context (identifiers): the definition's editor values at the root (as today); `value` (the rule's target),
     `item` / `index` (list rows), `parent` (enclosing row), `locale`, `defaultLocale`, `page` (uid, name, path,
     template uid) / `record` / `global`, `release` (status of the current locale), `global:<set>.<field>` (as in
     OCTL), `body.<name>` (page rules: list of section instances with `template` and `content`), `section.page`
     (section rules: the enclosing page's content and meta). Localizable values resolve to the evaluated locale.
   - `ref(value)` resolves a media/link/reference value to a read-only view (`meta`, `content`, `name`, `uid`,
     `path`, `mimeType`, `release`) of the referenced asset — draft for `edit`/`save`, released for `release`/
     `generation` (decision 20). Limits: `ref` depth 1 (a referenced asset's references are not followed), at most
     200 `ref` lookups per evaluation (`rule-eval` warning beyond), evaluation timeout per definition 200 ms.
   - `visibleWhen` keeps the v1 boolean subset so the client-side TS evaluator stays as it is; v2-only syntax in
     `visibleWhen` is `SF-CDL-0105`.
   - Identifiers are checked at compile time via `identifiers()`: an unknown editor path is `SF-CDL-0115`.
5. **Rule engine.** A new pure `RuleEngine` (sf-domain, next to `ContentValidator`) takes the effective definition,
   the content, a `RuleScope`, a locale set and a `RuleContextProvider` (page meta, release state, globals, `ref`
   resolution for the scope's snapshot view) and returns `RuleOutcome { findings, fills, fieldStates }`.
   `ContentValidator` keeps the STRUCTURAL checks and delegates every built-in completeness check to the engine, so
   there is one code path. Editors hidden by `visibleWhen` are skipped (as today); `locales` filters the locales a
   rule runs for (built-in `required` keeps "default locale only"). Fills are applied in dependency order before the
   findings are evaluated, so assertions see filled values.
6. **Finding model.** `Severity` becomes `HINT | INFO | WARNING | ERROR` (existing `ERROR`/`WARNING` keep their
   meaning; CDL/OCTL diagnostics keep using only those two). `ContentIssue` gains `rule` (name, or the built-in code
   such as `required`), `scopes`, `messages` (map; `message` = the resolved text for the request's UI language,
   `Accept-Language` → first entry), `locale` and `onGeneration`. `Kind` stays (STRUCTURAL vs COMPLETENESS; custom
   rules are COMPLETENESS). A finding "blocks" in a scope iff `severity == ERROR` and the scope is among its scopes.
7. **Save scope.** Every save path (Finding 4; PUT/autosave, PATCH, section add/move, records, global sets) runs the
   engine in `save`: first read-only enforcement for `readOnlyWhen` paths (decision 24: restore the stored value,
   `info` finding `read-only`), then `save` fills (`mode empty` only into empty fields, `mode always` overwrite, again
   `info` `read-only` when the incoming value differed), then rules; a
   save-scope `error` rejects with `422 SF-API-0422` (`issues` carry the new fields) — autosave included (decision
   9). `PageView.issues` / `RecordDetailView.issues` return the `edit`-scope outcome of the stored draft.
8. **Edit scope.** New endpoint `POST /projects/{p}/rules/evaluate` (VIEWER+write role of the asset kind; nothing
   stored; rate-limited like draft checks, `429 SF-API-0429`) with `{ assetUuid?, kind: PAGE|SECTION|RECORD|GLOBAL_SET,
   templateUid|datasetUid|globalSetUid, content, bodies?, locale?, changedPaths? }` → `{ findings, fills: [{path,
   locale, value, mode}], fieldStates: [{path, locale, required, readOnly}] }`. It runs `edit` fills, states and rules
   on the unsaved form value. The page Issues panel's draft check (`DraftCheckView.completeness`) switches to the
   engine's `edit` outcome.
9. **Release scope.** `ReleaseCompleteness` becomes `ReleaseRuleCheck`: for each asset and released locale, apply
   `release` fills — when any value changes, the release writes a new draft version with the fills and releases that
   version, both in the release revision (decision 23) — then run `release` rules against the released-view context.
   `error` → `422 SF-DOM-0150` as today (assets[{uuid, locale, issues}]). `warning` → `422 SF-DOM-0156` unless the
   request carries `acceptWarnings: true` (the plan lists warnings and infos per asset, `ReleasePlanView` gains
   `warnings`/`infos`). Scheduled releases always pass `acceptWarnings` and record the warnings in the job result;
   the LATEST-pin skip rule for errors is unchanged. Release fills run for every releasable type that has a content
   definition (pages, records, global sets); a PAGE release also runs the section instances' rules.
10. **Generation scope.** The VALIDATE stage (`RenderPipeline.incompletePages`) runs the engine in `generation` per
    page and locale against the snapshot (released view) with a proper `LocalizationContext` and lookups (fixes
    Finding 6). `error` + `holdBack` → page/locale held back, one `SF-GEN-0120` diagnostic naming the rules, run
    `PARTIAL` (as today). `error` + `fail` → the stage keeps validating all pages, then the run ends `FAILED` with one
    `SF-GEN-0121` diagnostic per failing page/locale/rule and nothing is published (decision 22). `warning` / `info`
    findings are stored as run diagnostics (counted in `warning_count`; infos not counted) and listed with the build
    findings. The dry-run plan (M22) still runs no checks.
11. **Planner edge.** `RebuildEdgeKind.RULE_REFERENCE`: when a generation-scope rule of a page's effective
    definition (or of one of its section instances) calls `ref(...)`, the resolved asset is recorded as a rule
    dependency; a change to that asset makes the page a rebuild target (re-validate + re-render) in the next
    incremental build. Rule dependencies are collected during VALIDATE and persisted with the page's build facts like
    the existing reference edges. A template change (including its `rules {}`) already rebuilds via
    `PAGE_TEMPLATE`/`SECTION_TEMPLATE`/`PARENT_TEMPLATE`.
12. **UI.**
    - The form engine calls `rules/evaluate` debounced (~400 ms after the last change, and on load); stale responses
      are dropped by a sequence number. It applies `fills` — `mode empty` only to fields the user has not touched in
      this session and that are empty or still hold the previous live-fill value (so a slug follows the title until
      edited by hand); `mode always` fields are read-only with a "computed" badge — and `fieldStates` (required marker,
      read-only). Client validators stay only for instant format feedback; server findings are authoritative.
    - Findings show inline per editor path down to list rows and group members (no more folding to the top-level
      editor), styled per level: hint (muted, editor only), info, warning, error; message in the UI language.
    - Save/autosave rejected by save-scope errors: the editor keeps the local state, shows the errors and marks the
      page "Not saved — fix N errors".
    - Issues panel: groups by level, filter by scope; `info` shown, not counted in the badge.
    - Release dialog / plan: errors block, warnings need the "Release with warnings" checkbox (sends
      `acceptWarnings`), infos listed collapsed.
    - Build run view: new `SF-GEN-0121` rendering, rule name and "Fix in …" link like `SF-GEN-0120`.
    - Template/dataset/global-set CDL editor: syntax highlighting and completion for `rules {}`, diagnostics from
      `/cdl/validate`.
13. **Codes.**
    - CDL: `SF-CDL-0113` invalid `rules {}` entry (syntax/unknown key), `SF-CDL-0114` missing `level`/`scope`/
      `assert`/`message`, `SF-CDL-0115` unknown target or identifier path, `SF-CDL-0116` expression error (parse,
      non-boolean assertion literal, unknown function, arity), `SF-CDL-0117` duplicate rule name / duplicate fill path /
      fill cycle, `SF-CDL-0118` override or `off` of an unknown inherited rule, `SF-CDL-0119` invalid modifier on a
      built-in (e.g. `onGeneration fail` without `generation`/`error`, built-in override in a child template).
    - Domain: `SF-DOM-0156` (422, release has warnings and `acceptWarnings` is not set; `assets[{uuid, locale,
      issues}]`).
    - Generation: `SF-GEN-0121` (rule with `onGeneration fail` failed; run `FAILED`).
    - Runtime finding codes (not problem codes): `rule-eval` (evaluation error or limit), `read-only` (ignored change).
14. **No export/import or schema change.** Rules live in CDL sources. `/cdl/validate` returns the new diagnostics for
    all three kinds (`?kind=DATASET|GLOBAL_SET`).

## Exit criteria (epic is done when)

- [ ] A page template with `rules {}` (rule, state, fill), inline built-in overrides and a child template that overrides
      and switches off inherited rules compiles; every invalid variant yields its `SF-CDL-011x` diagnostic.
- [ ] While editing, findings of every level, live fills (slug follows title until edited) and `requiredWhen` /
      `readOnlyWhen` states arrive from `rules/evaluate` and show inline per path, in the UI language.
- [ ] A save-scope error rejects save and autosave; read-only / `mode always` fields keep the server value with an
      `info` finding.
- [ ] Release: errors block (`SF-DOM-0150`), warnings need confirmation (`SF-DOM-0156` / `acceptWarnings`), release
      fills create a version in the release revision; scheduled releases record warnings.
- [ ] Generation: `holdBack` errors hold the page back (`PARTIAL`), `fail` errors fail the run after validating all
      pages (`SF-GEN-0121`), warnings/infos are listed; a change to an asset read via `ref()` re-validates the page in
      the next incremental build.
- [ ] Rules work per locale (`locales`), on list rows, on page bodies/sections and in section templates, dataset
      schemas and global sets.
- [ ] Existing templates without `rules {}` behave exactly as before (existing validation/release/generation tests
      green unchanged, except the generation L10N fix).
- [ ] 5,000-page full build within +10 % of pre-M33 with a template carrying ~10 rules.
- [ ] `./gradlew spotlessCheck build` (`test --rerun`), `ui` `npx ng build` and `npx vitest run` green; spec and guides
      updated.

## Tasks (dependency order)

| # | Task | Area | Depends |
|---|---|---|---|
| 1 | [M33.1 Expression language v2](001-expression-language-v2.md) | backend | — |
| 2 | [M33.2 CDL `rules {}` and built-in modifiers](002-cdl-rules-section.md) | backend | M33.1 |
| 3 | [M33.3 Rule engine and finding model](003-rule-engine.md) | backend | M33.2 |
| 4 | [M33.4 Save scope: fills, read-only, rejection](004-save-scope.md) | backend | M33.3 |
| 5 | [M33.5 Edit scope: evaluate endpoint](005-edit-scope-endpoint.md) | backend | M33.3 |
| 6 | [M33.6 Release scope](006-release-scope.md) | backend | M33.4 |
| 7 | [M33.7 Generation scope and planner edge](007-generation-scope.md) | backend | M33.3 |
| 8 | [M33.8 UI](008-ui.md) | frontend | M33.4, M33.5, M33.6, M33.7 |
| 9 | [M33.9 Spec and docs](009-docs.md) | qa | M33.1–M33.8 |

The epic is small in features, so its tasks sit directly under the epic (one task per feature). After M33.3, M33.4,
M33.5 and M33.7 are parallel lanes (`PageServiceImpl`/`RecordServiceImpl`/`GlobalSetServiceImpl` vs a new controller
vs `RenderPipeline`/planner). M33.6 needs M33.4's fill application. The UI can start on M33.5's API shape once the
OpenAPI is regenerated.

## Dependencies

`M2` (CDL, expression evaluator, content validation), `M3` (form engine), `M17` (global sets), `M19`/`M25` (datasets,
records), `M20` (inheritance, `EffectiveDefinition`), `M22` (planner edges), `M24` (locales, `LocalizationContext`),
`M27` (release, scheduler), `M28` (publish policy), `M30` (Issues panel, draft checks).

## Notes

- **API shape.** Regenerate OpenAPI (`./gradlew :server:sf-app:generateOpenApi -Pfrontend.skip=true`) and
  `ui/src/app/core/api/generated/schema.d.ts` (`npm run generate:api`) after each task that changes the API.
- **Performance.** Compile rule expressions once per definition (cache next to the compiled CDL); batch `ref()`
  lookups per build (preload the snapshot's referenced assets); the evaluate endpoint must answer a typical page in
  < 50 ms server time.
- **Security.** Expressions are data, never code: no reflection, no host access, bounded evaluation (timeout,
  `ref` cap, regex via a safe engine or a match-time limit against ReDoS).
- **Not in scope:** rules on media metadata or templates themselves; generation-time (unstored) fills; overriding
  errors at release/build; unifying with M30 quality rules / `QualitySeverity`; project-level (non-template) rules;
  client-side rule evaluation.
