# StaticForge CMS — User guide

For **editors** (Elena), **project administrators** (Paul), and **instance administrators** (Ida). Covers the core flows. Everything here follows the interface copy rules of §24.8: sentence case, names editors use (pages, media, templates, revisions), buttons that say what happens, and technical identifiers shown verbatim in monospace.

The interface is built around one idea (§24.1): **every change is on the record, and the record is always visible.** The revision spine (the 44 px rail on the left of every project workspace) is that record — the single, consistent way to browse history, compare versions, and restore.

## Who you are

| Persona | Can do |
|---|---|
| **Editor** | create/edit page content, sections, media; preview |
| **Project administrator** | + manage members, channels, generation targets, trigger publishes |
| **Instance administrator** | + create/archive projects, manage global users |

Templates are owned by **template developers** (see the [template-developer guide](template-developer-guide.md)). As an editor you never see a template.

## Core flows

### Pages

1. Open **Pages** from the nav. The folder tree is on the left, the page table in the centre.
2. Create a page: choose a template, a display name, and a folder. The UID (shown in mono) is derived from the name automatically.
3. Open the page editor — a split view: page fields on the left, live preview on the right.
4. Fill the template's editors. Save is ambient: the header shows `Saved 12:04` with a revision link. There is no blocking save spinner (§24.6).
   - A half-filled page always saves: an empty required field, too few list items or text that is too long doesn't stop the save. These are checked when you publish instead. A page with such a problem isn't published; the generation log lists it under `SF-GEN-0120` with the field paths, and the other pages are still published.
   - A save is rejected only when a value has the wrong shape for its field (for example text in a number field, a value that isn't one of the field's options, or a section whose template isn't allowed in that body). Nothing is stored, and the error lists each offending field path.
5. Preview updates live as you type (debounced), and the viewport switcher (mobile / tablet / desktop) resizes the preview.

### Sections

- A page body holds an ordered list of sections. Use the **+ Section** picker (a filtered palette showing only templates allowed for that body).
- Reorder by drag **or** keyboard (`Alt+↑/↓`) — drag is never the only way (§23.6).
- Sections are collapsible cards; collapsed state is remembered per template.

### Media

1. Open **Media**. Drop files anywhere to upload (or use the multi-file drop).
2. Set alt text, caption, copyright, and focal point in the detail drawer.
3. Reference media from a `media` or `link` editor using the picker.
4. The drawer shows **usages** ("where is this used?") before you delete anything. Usages are current as soon as a page or template is saved; you don't need to run a generation. Once you remove the media from every page that used it (or delete those pages), it can be deleted without forcing.

### Generate & publish

First, in **Settings → Targets**, create at least one target (the first one becomes the default). Each target writes into its own folder, `{projectKey}/{output folder}` under the server's output root (`{projectKey}/target-{id}` when the folder is left empty); two targets of a project may not share or nest folders (an imported target whose folder is invalid or clashes is imported without it and uses its default folder; the import analysis warns about this). Set **Base URL** for correct sitemap and absolute links.

In **Channels**, each channel's form sets how its output files and links are named:

| Field | Default | Meaning |
|---|---|---|
| **File extension** | derived from the key (`md` for `markdown`) | 1–10 lowercase letters or digits, without the dot |
| **URL strategy** | `RELATIVE` | `RELATIVE`: pages are files (`about.html`). `PRETTY`: with a trailing slash, pages are folders (`about/index.html`) |
| **Trailing slash** | off | Only available with `PRETTY`; links to pages end in `/` (`about/`) |
| **Index page UID** | `index` | The page with this UID becomes its folder's index page |
| **Index file name** | `index.` + extension | File name of a folder's index page, also used for pretty folder URLs; letters, digits, `.`, `-`, `_`, up to 64 |

An invalid value is rejected with the field named. Changing the extension or URL settings moves every page of the channel: the next generation rebuilds all pages even in incremental mode, and generated URL registry entries are recomputed (manual overrides are kept).

1. Open **Generate**, pick full or incremental mode, channels, and a target, then start.
2. A live log shows per-stage progress, error/warning grouping by code, and a file count. Errors link to the offending template line (§24.5).
3. Roll back to a previous build with **Promote** on a past run (the last few builds are retained).

### Revisions, spine, and time travel

- The spine shows the latest ~40 revisions, densest at the top. Your own changes are filled; others' are hollow.
- Click a tick to enter **time-travel mode**: a thin amber frame surrounds the content area, inputs go read-only, and the header reads `Viewing revision 1840 · Back to now`.
- From the Revisions screen you can filter by user, asset, and type; view a side-by-side diff; and restore.
- **Restore** always writes a *new* revision — history is append-only, nothing is ever overwritten.

### Conflict resolution

When two people edit the same asset, the second save shows a conflict drawer with both versions field by field, "keep mine / take theirs" per field, and who changed what when (§24.6). Your changes are never silently lost.

## Keyboard

Everything is reachable without a pointer (§24.6): `Cmd/Ctrl+K` command palette, `g p` pages, `g m` media, `g t` templates, `g r` revisions, `Cmd/Ctrl+S` save, `Cmd/Ctrl+Enter` refresh preview, `Alt+↑/↓` move section, `?` shortcut sheet.

## Roles in detail

| Role | Read | Edit content | Edit templates & channels | Generate/publish | Manage members |
|---|---|---|---|---|---|
| Viewer | yes | — | — | — | — |
| Editor | yes | yes | — | preview only | — |
| Developer | yes | yes | yes | yes | — |
| Project admin | yes | yes | yes | yes | yes |

## Accessibility

The UI targets WCAG 2.2 AA (AAA where feasible): 7:1 body-text contrast, visible focus everywhere, full keyboard operation, `aria-current` on the active nav item, live regions for save/progress, and reduced-motion support (§24.7).
