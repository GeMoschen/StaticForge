---
id: M23.4.1
status: done
depends: [M23.3.1]
epic: m23-global-search
feature: ui
area: frontend
---

# M23.4.1 — Ctrl+K command palette over search

## Context

- `ui/src/app/core/ui/shortcut.service.ts`:
  - `commandPaletteOpen = signal(false)`, set by `register('k', { mod: true })` and
    `register('?', { shift: true })`;
  - `closePalette()`;
  - `handleGoShortcut` is a no-op placeholder for `g`-chords.
- `core/ui/command-palette/command-palette.component.ts` injects `ShortcutService`, exposes `open`
  and `close()`, and uses `SfAutofocusDirective`. It has no search logic.
- The UI is Angular 18+ standalone, zoneless, with signals (§23.1).
- The generated API types live in `core/api/generated/schema.d.ts`.
- Project context comes from `project-context.store.ts`.
- `TimeTravelStore.isTimeTravel` marks time travel (`M6`/`M15.5`).

## Goals

- **Service.** A `SearchService` (`features/search/search.service.ts` or `core/api`, following
  existing feature service placement) wrapping `GET /projects/{key}/search` with typed
  `SearchHitView`/facets from the regenerated schema.
- **Palette behavior:**
  - When `project-context.store` has a current project, typing searches it:
    - 150 ms debounce;
    - cancel in-flight requests on new input (`switchMap`-equivalent with signals/`rxResource`);
    - `size=20`;
    - minimum 2 characters, except exact uid-looking input.
  - Results are grouped by type (Pages, Media, Templates, Navigation, Folders, and Globals/Records
    once present). Each group shows at most 5 entries, with a "See all N results" row that
    navigates to `M23.4.2`'s page with `q` prefilled.
  - Each row shows: type icon, display name, uid (muted), folder path, and a one-line snippet with
    highlight ranges rendered as `<mark>` built from text nodes (no `innerHTML`).
  - Keyboard:
    - ↑/↓ move the active option (wrapping);
    - Enter opens it;
    - Ctrl/Cmd+Enter opens the search page;
    - Esc closes and restores focus to the previously focused element.
- **No project.** Outside a project (dashboard/login) the palette shows "Open a project to search"
  and does not call the API.
- **Time travel.** A persistent note, "Results reflect the current revision". Opening a result
  leaves time travel (call the existing "return to now" action) so the user doesn't land on a stale
  view of a current hit.
- **Deep links** via an `assetRoute(hit)` helper:
  - `PAGE` → `p/:key/pages/:uuid`
  - `MEDIA` → media library with the detail drawer open (add a `?asset=:uuid` query param handled
    by `media-library.component`)
  - `PAGE_TEMPLATE`/`SECTION_TEMPLATE` → templates IDE with that template selected (`?asset=`)
  - `PAGE_REFERENCE`/navigation `FOLDER` → navigation store with it selected (`?asset=`)
  - Other `FOLDER`s → the owning store with the folder selected
  - `GLOBAL_SET`/`DATASET`/`RECORD` → their stores' routes (`M17.4.1`, `M19.4.*`) when present
  - Put the helper in one place (`shared/`) so `M23.4.2` reuses it.
- **Accessibility.** WAI-ARIA combobox + listbox: `role="combobox"`, `aria-expanded`,
  `aria-controls`, `aria-activedescendant`, `role="option"` with `aria-selected`. The result count
  is announced through a polite live region. The palette is a modal dialog with a focus trap and
  follows the existing `dialog.service` conventions.
- **Errors.** `503 SF-SEARCH-0503` shows "Search is temporarily unavailable" inline; other errors
  use the toast service.

## Acceptance criteria

- [x] Ctrl/Cmd+K inside a project, typing a word from a page's rich text, shows that page under
      "Pages" and Enter opens `pages/:uuid`. Verified in the running app (dev backend + `ng serve`,
      Playwright or manual), not just in specs.
- [x] Media, template and navigation results open the correct asset through the new `?asset=` deep
      links. Direct navigation to those URLs also works on reload.
- [x] Rapid typing sends at most one in-flight request (older ones cancelled). Verified by a service
      spec using `HttpTestingController`.
- [x] Keyboard-only flow works (open, type, arrow, Enter, Esc with focus restore). ARIA attributes
      are present (component spec plus an axe check if the e2e setup supports it).
      *Verified live by `m23-journeys.spec.ts` (combobox `aria-expanded`/`aria-controls`/`aria-activedescendant`,
      options `aria-selected`, the polite live region's count, Esc restoring focus). No component spec (the runner
      can't mount `templateUrl` components) and no axe run (axe-core isn't installed here).*
- [x] Snippet highlighting uses text nodes and `<mark>` only. A spec with a `<script>` in the
      snippet text renders it as text.
      *`search.util.spec.ts` splits a snippet holding `<script>alert(1)</script>` into plain runs; the template
      renders runs by interpolation into text nodes and `<mark>` elements, never `innerHTML`.*
- [x] Time-travel note is shown while `TimeTravelStore.isTimeTravel` is true.
- [x] `npm run build` green. New pure-logic specs (`assetRoute`, highlight-range splitting, search
      service) pass. Component specs using `templateUrl` may hit the known
      `resolveComponentResources` tooling failure; record it, don't hide it.

## Out of scope

- Non-search commands in the palette (actions like "Generate", "New page", `g`-chord navigation).
  The palette structure should allow adding command groups later.
- Full search page (`M23.4.2`).
- Recent/pinned items.

## Notes / hazards

- `Shift+?` currently also opens the palette (it is the conventional shortcut-help key). Leave the
  binding as is; changing it is a separate UX decision.
- Don't let the global Ctrl/Cmd+K handler fire while the user types in Monaco-less `<textarea>`
  template editors if that would lose input. Check `ShortcutService`'s existing input-target guard
  and keep it.
- Debounce and cancellation matter: the endpoint is fast, but every keystroke on a 5,000-page
  project must not queue requests.
