# Lessons

## Generated links: relative to the current page (2026-09-15)
- **Mistake:** when page links broke on nested pages, I offered "relative" vs "root-absolute", the user first picked
  root-absolute, and I changed every generated link to `/…`. The user then corrected it: links inside a page must
  always be resolved relative to the current page.
- **Rule:** generated output links (navigation, `$CMS_REF` page/folder/media) are relative to the rendering page's
  output path (`GenerationRenderer.relativeUrl`). Don't switch to root-absolute or site-root-relative forms.
- **Rule:** for output-format choices that users will see in every generated page, show a concrete rendered
  example from *their* site structure (e.g. what `pf/pf1/p3.html` would contain) before implementing, and
  verify the generated site with a link checker (resolve each href against its page), not only by reading HTML.

## Don't ship known gaps as "limits" (2026-09-16)
- **Mistake:** at the end of M21 I reported three things as deviations/limits instead of fixing them: `paginationPath`
  only settable through the API, the page editor overflowing a 1280 px window ("pre-existing"), and a plain dropdown
  source picker with the "N items → M pages" hint dropped because it "would need a new endpoint". The user asked for
  all three to be fixed.
- **Rule:** a task-file goal I can't meet the cheap way is still a goal: build what it needs (a small endpoint, an
  extension of the shared picker) or ask before dropping it. Never trade a stated feature for a "limit" line.
- **Rule:** a layout defect that I observe in my own screenshots and that affects the feature I'm shipping gets fixed
  (root cause, e.g. a flex item missing `min-width: 0`), even when it predates the milestone. Assert it in the journey
  (elements in viewport at the target width) so it can't come back.

## A `default` interface method is not behind the Spring proxy (2026-09-17)
- **Mistake:** adding `confirmDiscard` overloads to `TemplateService`/`GlobalSetService`/`DatasetService`/
  `PageReferenceService`/`UrlRegistryService`, I kept the old signature as a `default` method delegating to the new
  `@Transactional` one. A default method calls the implementation directly (self-invocation), so the transactional
  proxy is bypassed: an unconfirmed save that *threw* to roll itself back had already committed its writes. Caught by
  a test asserting the revision counter was unchanged.
- **Rule:** when adding an overload to a Spring service interface, declare **both** overloads abstract and implement
  both in the impl with `@Transactional`. Never a `default` method that delegates into annotated behaviour — same for
  `@Cacheable`, `@PreAuthorize` and every other proxy-based annotation.
- **Rule:** "throw to roll back" only works when a transaction is actually open. Assert the rollback (revision count,
  stored value) in the test, don't assume it.

## Compare boxed ids with `equals`, not `==` (2026-09-17)
- **Mistake:** two integration tests filtered with `asset.getProjectId() == project.getId()` (both `Long`). That is an
  identity comparison; it only worked because the ids stayed inside the `Long` cache (−128..127). Adding one more test
  class pushed project ids past 127 and the filters silently matched nothing, failing a test that had nothing to do
  with my change.
- **Rule:** never `==` on boxed types. `Objects.equals(a, b)`, or compare primitives. When an unrelated test starts
  failing after adding fixtures, suspect a latent boxed comparison or another test-order dependency before suspecting
  the feature.

## Don't run Gradle while a Gradle build is in flight (2026-09-17)
- **Mistake:** I started a long `./gradlew test` in the background and kept compiling in the foreground. The
  concurrent build rewrote `sf-api.jar` mid-run, and the suite reported ~10 unrelated "Failed to load
  ApplicationContext" failures that did not exist.
- **Rule:** while a background Gradle task runs, do non-Gradle work (docs, UI, reading). Re-run the suite cleanly
  before believing any failure list.

## A `<select>` that shows an option the model never chose (2026-09-18)
- **Mistake:** the Languages tab kept `defaultLocale` in a signal that only the select's `(change)` handler ever
  wrote. After adding the first language the select *displayed* it (a browser's fallback for an unmatched `[value]`),
  but the signal was still empty, so validation kept reporting "Pick the default language." and the save button never
  enabled. The M24 journey hid this by calling `selectOption('de')` explicitly — a step no real user performs.
- **Rule:** when a control renders an implicit default, model that default explicitly (a `computed` that falls back to
  the first option) instead of waiting for a change event that will never fire. And never let an e2e journey click
  something a real user would not: that click is the bug's hiding place.
- **Rule:** a Save button must be gated on *dirty* state as well as validity — "enabled with nothing to save" and
  "disabled with real edits" are the same missing comparison against the last server response.

## `$index` is shadowed by a nested `@for` (2026-09-18)
- **Mistake:** the Languages tab passed `$index` to `toggleFallback(...)` from *inside* the nested candidate loop,
  so Angular resolved it to the candidate's index, not the row's. Ticking "DE" as a fallback for EN wrote the
  fallback onto row 0 (de), which then reported "'de' cannot fall back to itself." — an error pointing at the wrong
  row and the wrong cause.
- **Rule:** the moment a `@for` is nested inside another, alias the outer index (`let rowIndex = $index`) and use the
  alias throughout the outer block. Implicit contextual variables are the first suspect whenever an action lands on
  the wrong item of a list.

## Concurrent actions in one scheduler tick race (2026-09-25)
- **Mistake (M27.4, found in M27.5):** a scheduler test expected two generation actions that are due in the same tick
  to both start there. The engine runs claimed actions concurrently, and a project allows one run at a time, so the
  loser waits. The test passed only when the first run happened to finish before the second tried: 1 of 3 runs.
- **Rule:** a test that ticks several actions touching one exclusive resource (a project's generation run, a lock)
  must not assume an order or a same-tick outcome. It ticks until each has reached its state, and awaits the resource
  in between. Before calling a failing test "flaky", run it 3+ times on master to separate an old race from a new bug.

## Count a call's SQL on its own thread (2026-09-26)
- **Mistake (M27.1.4):** a query-count test used Hibernate's statistics, which are global to the session factory. It
  passed alone and failed in the full suite, because the scheduler poll and the search indexer query in the
  background of the same context. Also, the first calls in a context pay one-time cache reads.
- **Rule:** assert statement counts with `ThreadStatementCounter` (per-thread `StatementInspector`), warm the
  project's caches with an unmeasured call right before each measured one, and prove the test fails on the old code.

## Never edit a loaded version's payload in place (2026-09-26)
- **Mistake (pre-existing since the section endpoints, found in M27.6's manual check):** `BodyService` edited the
  payload it was handed — the open version's managed `JsonNode` — for content merge-patch and every section operation.
  At flush Hibernate rewrote the *previous* version's row with the new content: history lied, and a released version
  silently took the draft's edits (status stayed `PUBLISHED`; the next build would have published unreleased content).
  Unit specs and the release service tests never saw it: they save through `PUT` (a fresh payload).
- **Rule:** any code that derives a new payload from a stored one starts with `deepCopy()`. Helpers that "normalize"
  a node (`object(node)`, `JsonUtil.object`) must not hand back the stored instance for editing.
- **Rule:** a versioning feature is tested through *every* write path the UI uses (PATCH, section add/reorder/delete/
  move), and asserts the earlier version is unchanged — not only the new one.

## Spec fixtures must have the API's real shape (2026-09-23)
- **Mistake (M25, found by the e2e journey):** the Content UI ran record/set `folderPath` values through a helper
  that expects stored paths (`/content_root/…`), but the REST API sends them store-relative (`/staff/`). Every unit
  spec passed because its fixtures were hand-written in the *stored* shape — so breadcrumbs, move targets and the
  folder filter of the set list were broken in the running app only.
- **Rule:** build UI spec fixtures from the API's real response shape (the generated `schema.d.ts` types, a captured
  response, or the backend's own DTO test), never from what the component code expects. When a helper converts a
  value, its spec needs one case per source shape it can actually receive.
- **Rule:** an assertion like `jsonPath(...).doesNotExist()` passes on an explicit `null`; assert absence and
  null-ness separately when the contract says "left out".

## A throttle must defer, not drop (2026-09-26)
- **Mistake (M28.3.1, found by the journey):** the project detail (with the caller's publish permissions) was re-read on
  navigation "at most every N seconds". A navigation inside the window after the last read skipped the refresh, so an
  editor kept the old controls after the admin changed the policy — until some later navigation.
- **Rule:** when a refresh exists so that "the next action sees the change", never drop it by time. Coalesce instead:
  one request in flight, and a request asked for meanwhile runs once more after it. Test the "immediately after a
  read" case explicitly.

## Zoneless: the DOM flips before Angular renders (2026-09-26)
- **Mistake:** a Playwright helper clicked a checkbox, waited for *that* checkbox's state (the native click flips it at
  once) and read the next switch before the app's render had run (the app uses zoneless change detection) — so it saw
  stale `checked`/`disabled` states and clicked a switch that was about to be disabled.
- **Rule:** in journeys, after an action wait for something only the app's render produces (a dependent control, a
  text), never for the state the browser changed natively. Remember `provideExperimentalZonelessChangeDetection`.

## Kill a process by its verified listening PID (2026-09-26)
- **Mistake:** `netstat … | awk '{print $NF}' | head -1` picked a TIME_WAIT line whose PID column is 0, and
  `taskkill //PID 0 //T` tried to kill the system tree (Windows refused).
- **Rule:** select the LISTEN (`ABHÖREN`) line of the port, require a PID matching `^[1-9][0-9]*$`, and print it
  before killing.

## No `git stash` while another agent edits the tree (2026-09-26)
- **Mistake:** I stashed to compare a build before/after while a docs agent was editing files in the same working tree;
  an edit landing between stash and pop would have been lost or conflicted.
- **Rule:** to compare against the old code, use `git worktree add` (or read `git show HEAD:path`), never stash a tree
  that someone else is writing to.

## Benchmarks on a shared machine: compare fastest runs, not medians (2026-09-28)
- **Mistake (M30 performance budget):** I reported the full build as "+11 % by median" after three alternating rounds.
  The baseline runs themselves spread from 4.4 to 5.1 s because the user's browser and another agent were loading the
  4-core machine; the noisy baselines flattered the median. Compared fastest to fastest, the overhead was +20–30 %, and
  I had to correct the claim.
- **Rule:** background load only ever adds time, so compare the fastest run of each side, and alternate baseline and
  change in the same window. Check the machine's load (`Get-Counter` per process) before trusting a timing, say when the
  numbers are unreliable, and never kill a process this session didn't start to get a quiet machine.
- **Rule:** profile the cold path the benchmark actually measures. A single build in a fresh JVM pays the JIT warm-up of
  every new code path (jsoup + rules: ~0.85 s cold vs ~0.27 s warm here); a warm micro benchmark hides it.
