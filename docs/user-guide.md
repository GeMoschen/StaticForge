# StaticForge CMS — User guide

For **editors** (Elena), **project administrators** (Paul), and **instance administrators** (Ida). Covers the core flows. Everything here follows the interface copy rules of §24.8: sentence case, names editors use (pages, media, templates, revisions), buttons that say what happens, and technical identifiers shown verbatim in monospace.

The interface is built around one idea (§24.1): **every change is on the record, and the record is always visible.** The revision spine (the 44 px rail on the left of every project workspace) is that record — the single, consistent way to browse history, compare versions, and restore.

## Who you are

| Persona | Can do |
|---|---|
| **Editor** | create/edit page content, sections, media, records, global values; preview |
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
   - A page often also shows values from **Globals** (below), such as the site title. Those aren't fields of the page — change them in Globals.
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

#### Stylesheets, scripts and other text files

Text files (CSS, JavaScript, JSON, SVG, XML, plain text, web manifests) get two more tabs in the
media drawer, next to **Details**:

- **Source** shows the file's content. Edit it and choose **Save**: every save is a revision, with
  history, diff and restore like any other change, so you don't need to download and re-upload the
  file. Tab inserts a tab, and the file keeps its line endings. Very large files (over 1 MB) open
  read-only; use **Replace file** for those. If someone else saved the file since you opened it, you
  choose between keeping your version and taking theirs. Closing the drawer or opening another file
  with unsaved changes asks first.
- **Process CMS syntax** (a switch at the top) lets a developer use template instructions in the
  file, for example the brand color from Globals in a stylesheet. When it's on:
  - errors are listed as you type (click one to jump to it) and **Save** stays disabled until
    they're fixed;
  - switching it on lists every place where the file's content will change, for example each `$$`,
    which is published as a single `$`;
  - the **Rendered** tab shows what the file turns into with the current values;
  - page previews and generated sites use the rendered file; a **CMS** badge marks the file in the
    library.

  Leave it off for files that should be published exactly as uploaded, such as third-party scripts.
  Replacing a processed file with a file that isn't text switches processing off, and the drawer
  tells you.

During time travel the switch, the editor and **Save** are disabled, and **Source** shows the file as
it was at that revision.

### Globals

Site-wide values — the site title, the logo, the social links, the footer copyright line — live in **Globals**, not on any single page. Change one there and every page that shows it picks the change up.

1. Open **Globals** from the nav. Like Navigation, the folder tree is on the left and the selected item on the right. Folders are only for keeping things tidy; they don't change where a value shows up.
2. The store holds **property sets**, each a named group of fields such as `site` or `social`. Select one to open it.
3. The **Values** tab is a form, like a page's fields. Fill it in and choose **Save values**. Globals don't autosave: a property set is shown on many pages at once, so nothing reaches a preview until you save.
4. The **Schema** tab shows which fields the set has. Developers declare them; editors can read the schema but not change it.
5. Every save is a revision, so a property set has history, a diff and restore like everything else. If someone else saved the same set since you opened it, your save is refused and the set reloads with their version — re-apply your change and save again.
6. The header shows the set's UID and a snippet such as `$CMS_VALUE(CMS_GLOBAL.site.title)$` — hand that to a developer if a template should show this value.

A property set that a template or page still reads can't be deleted; its usages list who reads it.

| Role | Globals: values | Globals: schema, create, delete |
|---|---|---|
| Viewer | read | read |
| Editor | edit | read |
| Developer and project admin | edit | edit |

During time travel the whole Globals screen is read-only and shows each set as it was at that revision.

### Content

Lists that many pages show — team members, products, FAQs, office locations — live in **Content** as **records**, not on any page. Each list is a **dataset**: a developer decides which fields its records have, and you fill them in. Edit a record once and every page that shows it follows.

1. Open **Content** from the nav. The chips at the top pick a dataset (**All** shows a card per dataset with its record count); the tree on the left holds folders, which only keep records tidy.
2. A dataset's records are a grid. **Search by name** filters as you type. For more precise filters, type an expression such as `role == 'lead' && joined > '2022-01-01'` and choose **Apply** — a mistake is shown with its column. Click a column header to sort (again to reverse, Shift+click to add a second sort); the column chooser hides columns you don't need, and remembers that on this device.
3. **New record** asks for a name and a dataset, then opens the record. Records autosave like pages; **Save now** or `Cmd/Ctrl+S` saves at once. If the dataset has a title field, the record's name follows that field.
4. The panel beside the form has **Checks** (empty required fields and similar findings — they don't block saving), **History** (every save is a revision, with restore) and **Usages** (the pages and templates that show this record).
5. **Delete** asks first, and says how many pages or templates still show the record; a deleted record disappears from every list on the next preview or publish, and can be restored from its history.
6. In a page, a field that points at a record opens a picker that lists only that dataset's records.

During time travel a record opens read-only, as it was at that revision, and page previews loop the records of that revision. The grid itself always lists today's records.

| Role | Records | Dataset fields, create and delete datasets |
|---|---|---|
| Viewer | read | read |
| Editor | edit | read |
| Developer and project admin | edit | edit (Templates → Datasets) |

A dataset that still has records can't be deleted — delete its records first.

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

In the Globals tree and the other store trees, `Tab` reaches each item, `Enter` or `Space` opens it, and `→`/`←` expand and collapse a folder. The Values and Schema tabs are ordinary buttons you can `Tab` to.

## Roles in detail

| Role | Read | Edit content | Edit templates & channels | Generate/publish | Manage members |
|---|---|---|---|---|---|
| Viewer | yes | — | — | — | — |
| Editor | yes | yes | — | preview only | — |
| Developer | yes | yes | yes | yes | — |
| Project admin | yes | yes | yes | yes | yes |

## Accessibility

The UI targets WCAG 2.2 AA (AAA where feasible): 7:1 body-text contrast, visible focus everywhere, full keyboard operation, `aria-current` on the active nav item, live regions for save/progress, and reduced-motion support (§24.7).
