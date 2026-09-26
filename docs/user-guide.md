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
   - Not every page template is offered. Templates marked **Abstract** (shown with an *Abstract* badge in the Templates store) are layouts that other templates build on, so no page can use them directly. Pick a template that extends the layout instead, or ask a developer to make one.
3. Open the page editor — a split view: page fields on the left, live preview on the right.
4. Fill the template's editors. Save is ambient: the header shows `Saved 12:04` with a revision link. There is no blocking save spinner (§24.6).
   - A half-filled page always saves: an empty required field, too few list items or text that is too long doesn't stop the save. These are checked when you release the page instead: the release dialog lists each problem with its field and refuses to release until it's fixed (see [Publishing](#publishing-draft-release-unpublish-m27)). Generation keeps checking too: a page with such a problem isn't published, the generation log lists it under `SF-GEN-0120`, and the other pages are still published.
   - A save is rejected only when a value has the wrong shape for its field (for example text in a number field, a value that isn't one of the field's options, or a section whose template isn't allowed in that body). Nothing is stored, and the error lists each offending field path.
   - A page often also shows values from **Globals** (below), such as the site title. Those aren't fields of the page — change them in Globals.
5. Preview updates live as you type (debounced), and the viewport switcher (mobile / tablet / desktop) resizes the preview.
6. Saving doesn't put anything online: your page is a **draft** until someone releases it (see [Publishing](#publishing-draft-release-unpublish-m27)).

#### Listing pages (pagination)

Some page templates turn a page into a listing spread over several pages, such as a blog index. Such a page has a
**pagination** field:

1. **Choose source…** opens a picker: a folder of the Navigation store (the pages it links to are listed), or a dataset
   (its records are listed), if the template allows both. Search narrows the list. Until you pick one, the page is not
   paginated.
2. Set **Items per page** (the template may cap it) and **Sort by**, with the direction button for ascending or
   descending. The field shows what that makes, for example **5 items → 3 pages**; entries that point to a deleted page
   are counted as skipped.
3. **Change source…** picks another one; **Clear** turns pagination off again.

The page's first page keeps its usual address; the others are published next to it (`blog-2.html`, `blog-3.html`, …).
Pages hidden from navigation (`nav.visible` off) are not listed, and a navigation entry whose page was deleted is
skipped, with a warning in the generation log.

When the page has more than one page, the preview toolbar shows **‹ Page n of N ›**: switch pages there, or click a
pagination link inside the preview. The selector also works in time travel, where the field itself is read-only.

### Sections

- A page body holds an ordered list of sections. Use the **+ Section** picker (a filtered palette showing only templates allowed for that body).
- Reorder by drag **or** keyboard (`Alt+↑/↓`) — drag is never the only way (§23.6).
- Sections are collapsible cards; collapsed state is remembered per template.

### Media

1. Open **Media**. Drop files anywhere to upload (or use the multi-file drop).
2. Set alt text, caption, copyright, and focal point in the detail drawer.
3. Reference media from a `media` or `link` editor using the picker.
4. The drawer shows **usages** ("where is this used?") before you delete anything. Usages are current as soon as a page or template is saved; you don't need to run a generation. Once you remove the media from every page that used it (or delete those pages), it can be deleted without forcing.

#### A different file per language (M27)

In a project with languages, the media drawer offers **Different file per language** — for a banner with text in it,
a German and an English PDF, a screenshot of a localized interface.

- Switch it on: the current file becomes the default language's file, and every other language uses it until it
  gets its own.
- The **Files** section lists every language: its own file (thumbnail, name, size, **Replace**, **Remove**) or
  "Uses Deutsch's file" with **Upload**. You can also drop a file onto a language's row. The default language's
  file can be replaced, not removed — every language without its own file falls back to it.
- The library's thumbnails show the file of the language you are editing; a small marker shows which media is
  localized.
- Each language is released on its own, like a page's languages: releasing only the English file changes only the
  English pages.
- Switching it off keeps the default language's file. When other languages have their own files, the drawer lists
  them ("These files will be discarded: EN hero-en.png (1.2 MB)") and asks before discarding them.
- For a stylesheet or other text file, the **Source** tab gets a language selector.

Pickers in page and link editors still pick the media, not one of its files: every language shows its own file.

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

Lists that many pages show — team members, products, FAQs, office locations — live in **Content** as **records**, not on any page. Each kind of list is a **dataset**: a developer decides which fields its records have, and you fill them in. Records are kept in **record sets**: a set holds the records of one dataset and decides which of them a page shows, and in which order — "Leadership", "Featured products", "FAQ: shipping". Edit a record once and every page that shows it follows.

**Finding your way.** Open **Content** from the nav. The tree on the left holds folders and, inside them, record sets (each with its record count; a warning sign means its query needs fixing). Folders only keep sets tidy. With nothing opened, the main area lists the record sets of the selected folder; the chips at the top narrow the list to one dataset (**All** shows every set).

**Creating a record set.**

1. Choose **New record set** in the toolbar, or right-click a folder → **New record set**.
2. Give it a name (the UID follows the name until you type your own) and **choose its dataset**. The dataset can't be changed later: every record in the set has that dataset's fields.
3. The set opens. **New record** asks for a name and opens the record; the record belongs to this set. Records autosave like pages; **Save now** or `Cmd/Ctrl+S` saves at once. If the dataset has a title field, the record's name follows that field.

A record always lives in exactly one record set — there are no records loose in a folder. Right-click a set for **New record**, **Rename**, **Move to…** (another folder), **History**, **Used by** and **Delete…**; you can also drag a set onto a folder.

**The set query** (the **Set query** panel above the records) decides what pages show:

- **Where** — an expression over the dataset's fields, such as `role == 'lead' && joined > '2022-01-01'`. Empty means every record.
- **Sort** — **Add sort key**, pick a field and **Ascending**/**Descending**; the arrows change the order of the keys. Without a key, records are sorted by name.
- **Offset** and **Limit** — skip the first records, or show at most this many (for "the three newest").

While you type, the panel checks the query and says what it would do: "4 of 9 records match · the set shows 3". A mistake is shown with the part and column it is in, and a set with errors can't be saved. **Save query** saves it as one revision; **Revert** throws your edits away. If a developer later removes a field the query uses, the set gets a warning and **shows no records** on any page until you fix and save the query.

**The records grid** has two views:

- **All records** (the default) lists every record of the set. The ones the set query leaves out are dimmed, with a tooltip saying why.
- **Show as rendered** lists only what pages show, in the order they show it — the set query applied.

**Search by name** filters as you type. For more precise filters, type an expression such as `role == 'lead'` and choose **Apply** — a mistake is shown with its column. Click a column header to sort (again to reverse, Shift+click to add a second sort); **Columns** hides columns you don't need (the dataset's title field starts hidden — its value is already the record's name in the first column). These filters only change what the grid shows. **Use as set query** copies them into the set query, where you can check and save them. Below the grid, the snippet (`$CMS_VALUE(recordset:leadership)$`) is what a developer puts in a template to show the set.

**Records.** The panel beside a record's form has **Checks** (empty required fields and similar findings — they don't block saving), **History** (every save is a revision, with restore) and **Usages** (the pages and templates that show this record). **Move…** moves the record into another record set of the same dataset. **Delete** asks first, and says how many pages or templates still show the record; a deleted record disappears from every list on the next preview or publish, and can be restored from its history.

**Deleting a set** asks first and names how many records go with it; the set and its records are deleted together, and restoring the set from its history brings them all back.

**In a page**, a field that points at a record or a record set opens a picker. A field meant for one dataset lists only that dataset's records or sets; a set shows its dataset and record count. Pick a set and the page shows that set's records the way its query says, in the look the developer gave the dataset.

During time travel a set and its records open read-only, as they were at that revision, and page previews show the records of that revision. The records grid lists the set's records of that revision too, dimming the ones its query left out then.

| Role | Record sets and records | Dataset fields and look, create and delete datasets |
|---|---|---|
| Viewer | read | read |
| Editor | edit | read |
| Developer and project admin | edit | edit (Templates → Datasets) |

A dataset that still has records or record sets can't be deleted — delete its sets first.

### Search

Search finds anything in the current project by what it contains, not only by its name.

- **Quick open.** Press `Ctrl+K` (`Cmd+K` on a Mac) anywhere in a project and type. Results appear as you type, grouped
  by kind (Pages, Records, Record sets, Media, Globals, Navigation, Folders, Page templates, Section templates, Datasets), five per
  group, each with its UID, folder and a line of text with your words highlighted. `↑`/`↓` move, `Enter` opens,
  `Ctrl+Enter` opens the search page with your words, `Esc` closes and puts you back where you were. "See all 12 pages"
  opens the search page filtered to that kind. Outside a project the palette only reminds you to open one.
- **Search page.** **Search** in the navigation rail (or `Ctrl+Enter` from the palette) shows every result with paging,
  a filter per kind with its count (the counts of the other kinds stay visible while you filter), and a folder filter
  (a folder path such as `/pages_root/news/`). A badge says where a result matched: Title, UID, Content or Source. The
  address holds your words, filters and page, so reload, back and forward, and shared links bring you to the same
  results.
- **What is searchable.**
  - Pages: name, UID, every text, rich-text, Markdown and select value, list items, catalog cards and section content,
    link titles, and the page's SEO title and description.
  - Media: file name, alt text, caption, copyright, and the content of text files processed by the CMS.
  - Page and section templates and datasets: name, UID, content definition and channel sources.
  - Navigation page references: label. Folders: name. Global property sets and dataset records: their values. Record
    sets: name and their dataset's name.

  References, media pickers, JSON, numbers, dates, colors and switches aren't searched.
- **How words match.** Upper and lower case don't matter, and neither do accents: `Häuser`, `hauser` and `haeuser` find
  the same pages. German and English words also match their other forms (`Häuser` finds `Haus`, `running` finds `run`).
  The last word matches as the start of a word while you type (`tea` finds `teaser`). Put words in quotes for an exact
  phrase. If nothing matches, words of five or more letters also match with one typo.
- **Always current.** Search reflects the current state of the project, also while you view an old revision; the
  palette and the search page say "Results reflect the current revision", and opening a result returns you to now. A
  change you just saved is searchable within a second or two. If the search page says "Index is catching up", recent
  changes aren't searchable yet.
- **Rebuilding the index.** Project admins see **Rebuild index** on the search page. Search keeps working while it
  rebuilds. If search says it is unavailable, the server can't open the project's search index — ask an operator (see
  `infra/README.md`).

### Languages (M24)

A project can publish in several **content languages**. A project that declares none is single-language and nothing
below applies: the editors, the URLs and the generated site are exactly what they were.

**Setting them up.** In **Settings → Languages**, a project admin lists the languages (a BCP 47 tag such as `de`,
`en` or `de-CH`, plus a label editors will see), picks the **default language**, and optionally gives a language a
**fallback chain** — `de-CH` falling back to `de` means a value nobody translated into Swiss German shows the German
one. The default language is always the last fallback, so a page never renders a blank where a value exists.

> **Adding the first language changes every page's URL.** `about.html` becomes `de/about.html` and `en/about.html`.
> The tab shows the before/after path of one of your own pages and asks you to confirm. If your site already has
> URLs people link to, switch on **Default language without URL prefix**: the default language keeps the site root
> (`about.html`) and only the other languages get a prefix (`en/about.html`).

**Switching language.** Once a project has languages, an **Editing language** picker sits above every screen. It
drives everything you edit — page fields, sections, property sets, records, media alt text, navigation labels — plus
the preview and the search palette. Your choice is remembered per project.

**Translating.** A developer marks the fields that differ per language `localizable` in the template's CDL; page
structure (bodies, section order, list rows, catalog cards) is shared by every language, so only values vary.

- A language-dependent field shows the language you are editing as a badge.
- A field you haven't translated shows what the page will actually render — *"Not translated — shows “Über uns” from
  Deutsch"* — with a **Copy from Deutsch** button to start from that text.
- Fields that are the same in every language are marked **All languages**; changing one changes them all.
- A required field is required in the **default** language only; the others may stay empty and fall back.

**Finding what's left.** The page, record and property-set editors show how many fields the current language still
owes (`en: 3 of 12 missing`), and the pages list can filter to **missing in en**. A value inherited through a
fallback counts as missing — that is the point: it is being read, but nobody has translated it.

**Previewing and sharing.** The preview renders the language you are editing, and a share link opens in that same
language.

**Removing a language.** Its translations are **kept**, not deleted: add the language back and they return. The
asset detail lists them as orphaned translations in the meantime. Turning languages off entirely, or taking
`localizable` off a field, *does* discard the other languages' values — both ask you to confirm first, naming how
many translations would go.

### Publishing: draft, release, unpublish (M27)

**What goes online when.** Saving never changes the website. Everything you save — pages, records, record sets,
property sets, media, navigation entries, folders — is a **draft**. **Releasing** makes the draft the version the
site shows, and the site changes with the **next build** (started by a developer, or by a schedule). Templates are
different: a template change reaches every released page with the next build, without a release.

**Statuses.** A badge next to every page, record, file and navigation entry — and in each editor's release bar —
shows its status in the language you are editing:

| Status | Means |
|---|---|
| **New** | never released: not on the site |
| **Published** | online, and the draft looks the same |
| **Changed** | online, but the draft differs; the site still shows the released version |
| **Unpublished** | taken offline; the draft is kept and can be released again |
| **Deletion pending** | deleted in the draft, still online until the deletion is released |

A clock on the badge means a schedule touches it; the tooltip lists every language ("DE published · EN changed").

**Releasing** (developers; see the roles table). In the editor's release bar choose **Release…**:

1. Tick the languages — the one you are editing is ticked; **All changed languages** ticks the rest.
2. The dialog lists what the release **also needs**: files and pages the page links to that aren't released yet,
   the folders it sits in, a set's new records, grouped by reason and ticked. Untick anything you don't want to
   release now — it will simply be missing from the page (the generation log warns with `SF-GEN-0221`). A folder
   whose name or place changed offers its changed contents unticked.
3. Missing required fields block the release: each is listed with its field and an **Open** link.
4. Add a comment if you like, and **Release**. "Released in r1902 — goes online with the next build."

**Per language.** Each language is released on its own. Editing only the English headline leaves German
**Published**; releasing English leaves the German page exactly as it was online — even when the page moved, was
renamed or got new sections in the meantime (each language shows the whole version released for it). Changing a field
that is the same in every language changes every language's status.

**Moving, renaming, deleting.** These are drafts too: a moved or renamed page stays at its old address until
released, and a deleted page stays online (**Deletion pending**) until you release the deletion. Deleting a page that
was never released removes it at once, as before. Renaming or moving a folder makes everything in it **Changed**.

**Unpublish…** takes a page offline in the languages you pick with the next build; its draft stays. **Discard
changes…** throws the draft away and brings back what is online, as a new revision (the discarded draft stays in the
history); the dialog lists the fields that would change. Discarding one language restores its translated fields;
fields shared by all languages are restored only when no other language has unreleased changes on them — otherwise
the dialog says they were kept.

**Changes.** **Changes** in the nav — with a count of new, changed and deletion-pending items — lists everything that
isn't released as it is, one row per language: type, name, folder, language, status, who changed it when, when it was
last released. Filter by type, status, language, who changed it, folder and name (the filters show as chips and stay
in the URL, so you can share a filtered list); sort by date or name. Select a row to see what changed since the
release, field by field, with **Open in editor**. Tick rows (or all rows of the page) to **Release…**, **Discard
changes…** or **Schedule release…** them together — one revision for the lot. With the keyboard: ↑/↓ move between
rows, Space ticks, Enter shows the changes.

**Preview: Draft or Published.** The preview toolbar switches between **Draft** — what you saved, with "Draft —
Changed" under the toolbar — and **Published** — what the next build puts online. A page that isn't released in the
language shows "Not published in Deutsch". **Share** asks which view the link shows ("Draft (latest saved)" or
"Published"); the link keeps it, also for every page you click to from there.

**Scheduling.** **Schedule…** in the release bar (or **Schedule release…** in Changes) releases or unpublishes at a
time you pick, in your own time zone (the dialog names it, e.g. "Europe/Berlin (CEST)"):

- **Which version:** *Release the versions as they are now* (default) or *Release whatever is saved at that time*.
  With the first, later edits don't sneak in: the schedule shows "Draft changed since scheduled", and **Re-pin**
  takes the current drafts instead.
- **Then:** *Generate right after* starts an incremental build as soon as the release is done.
- **If the time is missed** (server down, project archived): *Run as soon as possible*, or *Skip if more than N
  minutes/hours late*.

The release bar lists pending schedules ("Release scheduled for Tue 29 Sep 2026, 09:00 by Ana"); click one to open
it. **Schedules** in the nav lists every schedule with its next run, owner and status — filter by type, status and
owner — and lets developers **Edit**, **Run now**, **Take over** and **Cancel**; **History** shows each execution:
when it was due, how late it started, the outcome and each item's result, with links to the revision it wrote and the
build it started. **New generation schedule** plans builds: once, or repeating (every hour, every day, every weekday,
every week at a time — or a cron expression under *Advanced*, with the next five runs shown). A schedule runs as the
person who owns it; if they leave the project or lose the role, it stops ("Paused") until someone else takes it over.

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

A build publishes what is **released** (see [Publishing](#publishing-draft-release-unpublish-m27)), not the latest drafts.

1. Open **Generate**, pick full or incremental mode, channels, and a target, then start.
2. A live log shows per-stage progress, error/warning grouping by code, and a file count. Errors link to the offending template line (§24.5).
3. Roll back to a previous build with **Promote** on a past run (the last few builds are retained).

An incremental run renders only what changed and publishes the complete site: the pages it didn't touch are carried over from the build the target currently serves, pages you deleted or moved disappear from their old place, and the sitemap and search index always list every page. A run limited to some pages (a folder or a selection) works the same way: the rest of the site stays online as it was.

#### Why is this rebuilding?

- **Before a run.** In the generation dialog press **Preview plan** (`Alt+P`). It shows how many files would rebuild, how many assets changed (expand the list), the counts by reason and the largest groups ("412 via section_template:teaser"), and the revision the preview was computed at. The table lists every file with its reason; open a reason to read its chain from the page to the change, e.g. `page:about — places section` → `section_template:teaser`, with a link to the revision the change was made in ("+ 2 other changes" when several changes reach the same page). Tick **Validate templates** to also compile what the plan needs. If incremental can't be used — no previous complete build for this target, the build is gone, channel output settings changed — a warning says so: the run will be a full build. Changing the mode, target or channels marks the preview out of date; starting still works, and if content was saved after the preview you get a notice.
- **After a run.** In the run history each run shows "Incremental · 37 pages (via 2 changes)" or "Full · 5,000 pages". **Details → Rebuilt pages** lists what the run rebuilt and why, with the same filters. Plans of older runs are removed after a while ("Plan details were pruned").
- **While editing.** The **Impact** panel in the template editor, the media drawer (below **Referenced by**) and the page editor answers "if I change this, what rebuilds?": "Changing this rebuilds 12 pages (24 files)", by kind of dependency, and a table with each page's chain back to this asset (pages link to their editor). It loads when you open it, always reflects the current state (also while viewing an old revision), and reloads after you save. It counts the most a change could rebuild; a small edit may rebuild less. Navigation matters: renaming a page that a navigation lists, or editing the navigation, rebuilds every page showing that navigation.
- **Record sets.** Editing a record rebuilds the pages showing its set only if the set's query shows that record (before or after the edit); changing the set's query, name or place rebuilds every page showing the set. The reasons read "reads record set containing", "reads record set with changed query" and, after a developer changes how a dataset's records look, "renders through record template of".

### Revisions, spine, and time travel

- The spine shows the latest ~40 revisions, densest at the top. Your own changes are filled; others' are hollow.
- Click a tick to enter **time-travel mode**: a thin amber frame surrounds the content area, inputs go read-only, and the header reads `Viewing revision 1840 · Back to now`.
- From the Revisions screen you can filter by user, asset, and type; view a side-by-side diff; and restore.
- **Restore** always writes a *new* revision — history is append-only, nothing is ever overwritten.

### Conflict resolution

When two people edit the same asset, the second save shows a conflict drawer with both versions field by field, "keep mine / take theirs" per field, and who changed what when (§24.6). Your changes are never silently lost.

### Your account and project members (M26)

- **User menu** — your initials top right on the dashboard and at the bottom of the project rail: *My account*,
  *Administration* (instance admins), *Sign out*.
- **First sign-in** — with a password an administrator gave you, you first see *Set a new password*; the rules show as
  you type. Nothing else opens until you have chosen your own.
- **My account** — change your display name (username and email ask for your current password), change your password
  (every other session is signed out), see your projects, and *Sign out everywhere* if you think someone else has
  access.
- **Settings → Members** — who is in the project and with which role. Project admins add existing accounts (search by
  name), change roles and remove members; new accounts are created by an instance administrator.
- **Archived projects** are read-only for everyone and hidden from members; a banner says so. Ask an instance
  administrator to unarchive one.

## Keyboard

Everything is reachable without a pointer (§24.6): `Cmd/Ctrl+K` search (see [Search](#search)), `g p` pages, `g m` media, `g t` templates, `g r` revisions, `Cmd/Ctrl+S` save, `Cmd/Ctrl+Enter` refresh preview, `Alt+↑/↓` move section, `?` shortcut sheet.

In a project with several languages, the **Editing language** picker above the content area is an ordinary select you
can `Tab` to; changing it switches every editor, the preview and the search palette to that language.

In **Changes**, `↑`/`↓` move between rows, `Space` ticks a row and `Enter` shows its changes; the preview's
**Draft | Published** switch is a radio group (arrow keys switch).

In the Globals tree and the other store trees, `Tab` reaches each item, `Enter` or `Space` opens it, and `→`/`←` expand and collapse a folder. The Values and Schema tabs are ordinary buttons you can `Tab` to.

## Roles in detail

| Role | Read | Edit content | Edit templates & channels | Release, unpublish, discard, schedule (M27) | Generate/publish | Manage members |
|---|---|---|---|---|---|---|
| Viewer | yes (statuses, Changes, Schedules) | — | — | — | — | — |
| Editor | yes (statuses, Changes, Schedules) | yes | — | — | preview only | — |
| Developer | yes | yes | yes | yes | yes | — |
| Project admin | yes | yes | yes | yes | yes | yes |

Editors see every status, the Changes view and the schedules but no release or schedule actions; a release needs a
developer.

## Accessibility

The UI targets WCAG 2.2 AA (AAA where feasible): 7:1 body-text contrast, visible focus everywhere, full keyboard operation, `aria-current` on the active nav item, live regions for save/progress, and reduced-motion support (§24.7).
