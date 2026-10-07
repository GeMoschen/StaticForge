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

## Scope a feature to what the user asked for, not what generalizes (2026-09-29)
- **Mistake (M31):** the goal was a site home page ("Homepage" as `index.html`) and a reachable Navigation root; the plan
  generalized it to a start page for *every* pages folder, with API, planner edge, import protocol and UI — which the
  user never wanted and had to be removed again.
- **Rule:** when a plan widens the user's request (every folder instead of the one case, a new setting instead of a fix),
  name that widening as its own question in the plan and get it confirmed before building it.

## A reload after a save must not take back newer edits (2026-09-30)
- **Mistake (found by the M20 journey in M34):** the Templates screen saved, then reloaded the template and reset every
  buffer from the reload. Anything typed between the save's answer and the reload's was silently replaced by the saved
  text — the journey's next edit vanished and Save went grey.
- **Rule:** a follow-up read after a save refreshes derived data but resets the form only while it is still unchanged
  since that save (compare against the dirty state before applying). Test it: save, type, then flush the reload.

## jsdom lets a spec click a disabled button (2026-10-01)
- **Mistake (found in M35.6):** two dataset-editor specs typed and then clicked Save at once. The button was still
  disabled (the dirty state hadn't rendered yet), but jsdom dispatches `click` listeners on a disabled `<button>`, and
  the event bubbled to the `(click)` on `<sf-button>`. The specs passed by doing what no user can; they broke as soon as
  `sf-button` swallowed blocked clicks like a browser.
- **Rule:** before a spec clicks a button that a state change enables, `await waitFor(() => expect(button).toBeEnabled())`.
  A component that must not act while disabled/busy blocks the click itself (`sf-button` does), never relies on the
  native `disabled` alone.

## `[hidden]` loses to `display` (2026-09-30)
- **Mistake:** per-channel panels were switched with `[hidden]`, but their class set `display: flex`, which beats the
  UA's `[hidden] { display: none }` — every panel showed at once.
- **Rule:** an element toggled with `hidden` whose styles set `display` needs an explicit `.x[hidden] { display: none; }`.


## Visually hidden elements stretch scroll areas (2026-10-01)
- **Mistake:** `.sf-sr-only` (absolute, no offsets) sat at its static position deep inside a long form. Its containing
  block was a positioned ancestor outside the unpositioned scroll container, so it escaped the clipping, stretched
  the ancestors' scroll area and `scrollIntoView` shifted the whole frame. Making only the splitter pane positioned
  moved the problem one level down (a second scrollbar); the area had been patched locally twice before.
- **Rule:** fix it at the source — absolutely positioned helpers that must not affect layout get explicit offsets
  (`top: 0; left: 0`). When a scroll bug shows up, list every element with `scrollTop > 0` and every scroll
  container's overflow before patching one container.

## Never end a command with an exploratory `git stash` (2026-10-01)
- **Mistake (M35.10):** I appended `git stash -q 2>/dev/null; echo skip` to a lint command while "checking something". It
  stashed every tracked edit of the working tree (untracked files stayed), so the tree silently reverted to HEAD. I
  popped it at once and lost nothing, but a failed pop would have cost the session's work.
- **Rule:** no `git stash`, `checkout --`, `reset` or `clean` unless the step is the point of the command and the tree
  state is known. Compare with the old code through `git show HEAD:path` or a worktree. Keep lint/build commands free of
  trailing "just in case" commands.

## A roving toolbar with a text field in it is a keyboard trap (2026-10-03)
- **Mistake (M35.19, found in the browser walkthrough, not by any spec):** the media toolbar used the design system's `sf-toolbar` (one tab stop, ←/→ between
  items) with the search field as its first item. A text field keeps ←/→ for its caret, so from the search field Tab jumped over Type, Sort, Grid/List and
  Upload straight to the first card: four controls could not be reached by keyboard. The unit specs only checked DOM order.
- **Rule:** a bar that holds a text field or a select is a plain group with every control in the tab order (`sf-toolbar roving="false"`); roving tabindex is
  for bars of buttons only. A keyboard walkthrough prints the real tab order (`document.activeElement` after each Tab) and checks every action is in it.

## An element that moves itself into `<body>` must not be the first node of a repeated view (2026-10-03)
- **Mistake (shared `sf-context-menu`, M35.7, surfaced in M35.19):** the panel relocates itself into `<body>` and was the root of an `@for` view. When a second
  menu replaced the first in one change-detection pass, Angular inserted the new panel before the old one — a node that was no longer a child of the host —
  and threw `insertBefore ... not a child`. jsdom showed it only when the two events were dispatched without a change-detection pass between them.
- **Rule:** wrap such an element in a slot that stays where Angular put it (an `ng-container` does not help: its first node is its first child). Reproduce
  with plain `dispatchEvent` calls, not `fireEvent`, which runs change detection after each event.

## A panel moved into `<body>` is outside its host for an outside-press handler (2026-10-07)
- **Mistake (sf-combobox, found as "clicking an item only closes the dropdown" in the Schedules item picker):** the combobox's
  document `pointerdown` handler closed the list when the target was not inside the host, but `anchorPanel` had moved the
  panel into `<body>`. A real press on an option closed (and removed) the panel before the `click` could choose. The spec only
  fired `click`, which skips the press, so it passed.
- **Rule:** an outside-press handler must treat the portaled panel as inside (`sf-menu`, `sf-popover` and `sf-date-input` do).
  Specs for pickers dispatch the whole sequence a browser sends (`pointerdown`, `mousedown`, `mouseup`, `click`) and assert the
  list is still open between press and click.
