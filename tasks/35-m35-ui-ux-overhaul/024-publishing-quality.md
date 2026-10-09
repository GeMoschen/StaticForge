---
id: M35.24
status: built
depends: [M35.11, M35.12, M35.13, M35.14, M35.15]
epic: m35-ui-ux-overhaul
feature: screens
area: frontend
---

# M35.24 — Publishing, quality, redirects, URL registry

## Context

`features/generation/*` (runs, run detail with custom tabs, live log, generation dialog), targets, publish policy,
`features/settings` quality, redirects and URL registry. Routes from M35.11. Screenshots 82–84, 86, 88–89 and E9.

## Goals

- **Publishing → Runs:**
  - `sf-data-table`: status, mode, target, trigger, started, duration, pages, findings.
  - One line per cell, with details in the run view.
  - Primary *Build now*, disabled with a reason when there is no target (links to Targets).
- **Run detail:**
  - A summary header (status, counts, duration), then `sf-tabs` Summary | Rebuilt | Findings | Log.
  - Findings grouped by code with a count; they name the page, link to it, and say how to fix.
  - Logs are monospace, virtualized and follow the tail.
- **Build now dialog:**
  - Target select preselects the default.
  - Mode (full, incremental) as a segmented control.
  - Dry-run plan preview.
  - Page scope picker as a real picker, not text-looking links.
- **Targets:** `sf-data-table` with Delete in ⋮ (confirm). The form is in a drawer.
- **Publish policy:** a settings form with the save UX.
- **Quality:**
  - A summary first (rules on/off counts, last results), then rules grouped by category, keeping the segmented
    Off/Warning/Error control.
  - The long explanations become hints and tooltips.
- **Redirects and URL registry:**
  - `sf-data-table`s with aligned filters.
  - Destructive actions (Reset all) are hidden in empty states and live in ⋮ with a typed confirmation.

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

**Sample first (user rule, 2026-10-02).** If this task needs a screen, state or decision that the sample at `/styleguide`
does not cover (or covers differently), do **not** implement it. Add it to the sample first, tell the user, and wait
for their review and sign-off; record the decisions in `009-style-guide-gate.md`. Only then build it in the app.

**Signed off with M35.12 (gate decisions 41–46):** filter bars use the **normal control size** (as tall as the search
field; the shared `sf-data-table` toolbar already does), type filters show the type's icon, an open list item's row uses
`sf-data-table` `currentKey` (highlight + accent bar + `aria-current`), dialog footers use `<ng-container sfDialogFooter>`,
and list + detail panes are bordered cards with the splitter handle centred in a gap (`--sf-splitter-gap`).

## Acceptance criteria

- [ ] Screen definition of done met (README).
- [ ] Vitest specs updated. `npx vitest run` and `npx ng build` green.

## Notes (M35.9)

- Navigation inside Publishing is the `sf-side-nav` (Runs, Targets, Policy, Quality, Redirects, URLs; decisions 28-30).
  Quality, Redirects and the URL registry belong here, not in Settings.
- Sample (decision 27) is the reference: runs table; run detail (Summary | Rebuilt | Findings | Log, one run still
  running with a live log tail); the Build now dialog (target preselected, Full/Incremental, dry-run plan, page scope
  picker); targets (table, form in a drawer) and the publish policy form; quality (summary, rules by category with
  Off/Warning/Error); redirects and the URL registry (tables with aligned filters, destructive actions in ⋮ with a
  typed confirmation).
- Drawers (the targets form): see the open question on drawers over the top bar (M35.19).

## Server contract (stream B: redirects, URL registry, targets)

All paths are under `/api/v1/projects/{projectKey}`. Additive and backwards compatible. UI types are hand-written
(`GenerationTargetView` etc. in `ui/src`); there is no generated client or OpenAPI spec to regenerate.

### Delete all manual redirects (new)
- `DELETE /redirects?kind=MANUAL` - `PROJECT_ADMIN`. Response `200 {"deleted": <int>}` (0 when none).
- `kind` is mandatory and must be `MANUAL` (case-insensitive); absent, `AUTO` or unknown is `400 SF-API-0400`,
  `field: "kind"`. Only `MANUAL` rows of this project are removed; `AUTO` rows and other projects are untouched.
- Archived project: `409 SF-DOM-0141`. Audit: one record `REDIRECTS_MANUAL_DELETED`, target `redirects:manual`,
  detail `{deleted:n}` (also written when n = 0), not one record per row. No `If-Match`: a bulk delete has no single
  row version to compare; the single `DELETE /redirects/{id}` keeps its optional `If-Match`. No confirmation body or
  param (the UI does the typed confirmation). Redirects allocate no revision and have no caches, so nothing else to
  invalidate.

### Redirect list filters (`GET /redirects`) - all already existed except `noLocale`
- Params: `channel` (exact channel key), `locale` (exact; blank/`""` is NOT a filter), **`noLocale=true` (new)** keeps
  only rows with locale `""` (channels without languages, e.g. files; wins over `locale`), `kind` = `AUTO|MANUAL`
  (case-insensitive, unknown `400` field `kind`), `state` = `ACTIVE|SHADOWED|DANGLING|LOOP` (case-insensitive, unknown
  `400` field `state`), `q` (case-insensitive substring of `fromPath` or fixed `toPath`), `page` (default 0, >= 0),
  `size` (default 50, 1..200, else `400`). Filters combine; sort is channel, locale, fromPath.
- Row `state` is `null` when the default target has no published build (then `target` is null, `basisRunId` null in
  the page, and a `state=` filter matches nothing). `state` is computed against that build, so `totalElements` under a
  state filter counts matching rows only. Page JSON: `{rows,page,size,totalElements,totalPages,basisRunId}`.

### URL registry "no language" (`GET /url-registry`)
- Existing: `locale=` (empty value) already selected rows with locale `""` (`null`/absent = unfiltered). New, for
  clients that drop empty params: **`noLocale=true`** does the same and wins over `locale`. `noLocale=false` = no-op.

### Targets (`/targets`)
- **`baseUrl`** truth: `config.baseUrl` is used by the generator (`GenerationService.baseUrl`: sitemap.xml is only
  written when it is non-blank; absolute links of HTML-stub and `.htaccess` redirects). It was stored in `config` but
  not surfaced. Now: view has `baseUrl` (string|null; `config.baseUrl`, trimmed, null when absent/blank) as the last
  field; request has optional `baseUrl` (null/absent: `config.baseUrl` as sent is kept; non-blank: written to
  `config.baseUrl`, overriding; blank: removed from config). `config.baseUrl` itself is unchanged, so the existing UI
  keeps working.
- Validation (create and update, either source): absolute `http`/`https` URL with host, no query/fragment, else
  `400 SF-API-0400`, `field: "baseUrl"`.
- **Duplicate name**: was allowed before. Now `409 SF-API-0409` with `field: "name"`, case-insensitive per project,
  on create and on update only when the name changes (legacy duplicates stay editable).
- **Output directory collision** (equal or nested `config.path`): `400 SF-API-0400`, no `field`, detail
  "Output path 'x' overlaps the output of target 'y'." (unchanged; there is no dedicated SF-DOM code).
- Permissions unchanged (create DEVELOPER, update/delete PROJECT_ADMIN, read VIEWER).

### Publish policy impact item (`POST /publish-policy/impact`)
- Each `failingSchedules[]` entry has two new fields: `itemName` (display name of the schedule's first released or
  unpublished item; `null` for a schedule without items, e.g. generation) and `itemCount` (items covered, 0 for none).

## Server contract (generation runs / quality, stream A)

DTO types reach the UI through `openapi-typescript` (`npm run generate:api` from `server/sf-app/build/openapi/openapi.json` into `ui/src/app/core/api/generated/schema.d.ts`); regenerate it after the server build. All changes are additive.

### Run log: `GET /projects/{key}/generations/{id}/log?from=<n>` (VIEWER)
- Response `{lines:[{n,time,stage,level,text,files,errors,warnings}], complete, truncated, pruned}`.
  `n` counts from 1 per run; `time` ISO-8601 instant; `stage` one of `SNAPSHOT|PLAN|VALIDATE|RENDER|ASSETS|CHECK|POST|WRITE|REPORT`;
  `level` is `info|warning|error`; `files|errors|warnings` are the run's counters when the line was written (the last line
  carries the current totals, so counters need no extra call). `from=<n>` returns the lines with `n` greater than `from`
  (absent/`<=0`: all). Poll a running run with the last `n` seen.
- Lines = the SSE `progress` events (one per stage, `CHECK` twice), plus at the end one line per diagnostic code
  (`SF-GEN-0111 (3x): first message`, level `error` for errors, `warning` for warnings, stage `REPORT`), one
  "`N pages held back by quality checks`" warning line, and the final `REPORT` line (text = run status; level `error`
  for FAILED, `warning` for PARTIAL/CANCELLED, else `info`).
- `complete`: the run ended and the log is final (also for FAILED/CANCELLED/interrupted runs). `truncated`: the cap
  (`sf.generate.log-max-lines`, default 2000) dropped lines; a `warning` line "Log truncated: ..." marks the cut and the
  closing `REPORT` lines are always kept. Line text is cut at 1000 characters.
- Storage: JSON blob in the content-addressed blob store, `generation_run.log_blob_sha`; written at every stage change
  and once more, `complete`, when the run ends. A RUNNING run on the answering node is served from memory.
- Retention: the log lives and dies with its run (`generation-run-retention` deletes the row, `blob-sweep` the blob).
  A run that ended without a stored log (runs from before this change) answers **200** `{lines:[], complete:true, pruned:true}`.
  A QUEUED run with no lines yet: `{lines:[], complete:false, pruned:false}`. Another project's / unknown run: `404`.

### SSE `GET .../generations/{id}/events`
- For a run that is not finished, the stream now first replays the lines so far as `progress` events, then the usual
  `STATUS` event, then live events. Every `progress` event that is a log line now also carries `n`, `time`, `level`
  (absent on `STATUS`); replay and live may overlap, so de-duplicate by `n`. Finished runs behave as before (STATUS, close; use `/log`).

### Trigger
- `GenerationRunView.trigger`: `MANUAL|SCHEDULE|RELEASE`. Existing rows `MANUAL` (column `generation_run.trigger_kind`, changeset 034).
- `POST /generations` accepts optional `trigger: "MANUAL"|"RELEASE"` (absent = MANUAL). `"SCHEDULE"` -> `400`
  (`trigger must be MANUAL or RELEASE.`). The scheduler (scheduled generation, recurring generation, "then generate")
  sets `SCHEDULE` server-side. The client must send `RELEASE` itself for the "Build after release" start
  (`BuildNowService.announceRelease`/`start` currently posts `{mode:'INCREMENTAL', comment:'Build after release'}`).
  The audit entry `GENERATION_STARTED` also records `trigger`.

### Typed run fields (`GenerationRunView`, also in the list)
- `planState`: `STORED` (plan entries available), `PRUNED` (plan summary only: retention removed the entries),
  `PENDING` (QUEUED/RUNNING and not planned yet), `NONE` (ended before planning: failed/cancelled early). `GET .../plan` is 404 for `NONE`.
- `heldBack`: `[{assetUuid, name, locale, channel}]` (empty list for none). `name` = the page's current display name, falling
  back to its uid; `null` for a deleted page of an old run with no uid. `locale` is `null` in a project without languages.
  `diagnostics.heldBack` is unchanged.

### Findings facets: `GET /projects/{key}/generations/{id}/findings/facets` (VIEWER)
- Same filter params as `/findings` (`severity`, `category`, `code` repeatable, `assetUuid`, `channel`, `locale`,
  `pathPrefix`; no paging). `400` for an invalid severity/category, `404` for another project's run.
- Response `{total, severity:{WARNING,ERROR}, category:{LINKS,SEO,ACCESSIBILITY}, code:[{code,name,count}], locale:{<locale>:count}}`.
  Every facet counts the findings that pass **all filters except its own**; `total` passes all. `severity` and `category`
  always carry every key (0 allowed); `code` lists codes with count > 0 sorted by code (`name` null for a rule the app
  no longer knows); `locale` lists languages with count > 0 (empty in a project without languages). `/findings` is unchanged.

### Last-run counts per rule: `GET /projects/{key}/quality-rules/last-run` (VIEWER)
- `{run:{id,status,finishedAt,targetId,findingErrors,findingWarnings,truncated}, counts:{"SF-CHK-0301":n,...}}`; `run` and
  `counts` are both `null` when the default target has no SUCCESS/PARTIAL run. `run` = the newest such run on the default
  target (there is no separate run "number": the id is the number). `findingErrors/findingWarnings` cover every finding of the run;
  `counts` only the stored ones (`truncated` = findings the storage caps dropped); a rule without findings is absent from `counts`.
  `GET /quality-rules` is unchanged.

### Notes
- `GET /generations` (history) is unbounded (all runs of the project, newest first, no paging); not changed. It now also
  carries the new fields, and `heldBack` names cost one extra lookup per request only when a run holds pages back.

## Review (2026-10-09)

Built to the signed-off sample (gate round 17, decisions 186-212). User decisions during the build: persist the run log, add the run `trigger`, build *Delete all manual redirects* (admin only), server counts for per-rule last-run and findings facets, item name in the policy impact dialog, developers keep the server's targets rules, redirect 'Saved as' shows what is stored, a 409 on saving a redirect keeps the dialog open with Reload, Quality shows 'No finished run yet' without a run.

Verification: `npx ng build` green, `npm run lint` clean (pre-existing warnings only), `npx vitest run` 353 files / 4136 tests green after the i18n namespace fix, server `test --rerun` 1046 tests with 2 failures that also fail on the untouched commit 20c98acc (`NavigationApiIntegrationTest.visibleInMenuDefaultsToTrueAndIsSetThroughTheUpdateEndpoints`, `ReleaseApiTest` 'search with releaseStatus=CHANGED …'). **Not done:** no browser walkthrough against a running backend for Runs/Build now/Redirects/URLs (Targets/Policy/Quality were looked at with mocked responses); e2e journeys still use old selectors (`e2e/m28-journeys.spec.ts` policy card) - M35.31.

Deviations to confirm: no progress percentage for a running run (the server has none; stage + spinner); *Reported by the build* section added to the run Summary (template/file problems the old UI showed); Build now scope takes one folder (request has one `folderPath`); Rebuilt badges say 'files'; URL registry has no 'all channels' filter (server ignores blank channel); a Build now button sits in the page header besides the top bar's quick build; quality channel note shown once.
