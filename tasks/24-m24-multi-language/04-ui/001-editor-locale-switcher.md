---
id: M24.4.1
status: todo
depends: [M24.1.2, M24.2.2, M24.3.2, M17.4.1, M19.4.2]
epic: m24-multi-language
feature: ui
area: frontend
---

# M24.4.1 — Editing-locale switcher, fallback display, preview locale, locale-aware diff

## Context

`ui/src/app/features/forms/sf-content-form.component.ts` renders a form from a
`ContentDefinition` (inputs `definition`, `formGroup`, `projectKey`);
`form-builder.service.ts` builds controls (`buildEditorControl`, `buildRowGroup`) and
serializes (`valueOf(def, form)`). It is used by `pages/page-editor.component.ts`
(autosave via `PageAutosaveService` / `composePagePayload`), `section-editor.component.ts`,
and — after M17/M19 — the global set and record editors. Media metadata is edited in
`features/media/media-detail-drawer.component.ts`; navigation labels in
`features/navigation/*` reference detail. The revision diff is
`revision-diff.component` over `RevisionDiff`/`FieldChange` paths.

## Goals

- **Editing locale state:** `EditingLocaleStore` (signal), default = project default
  locale, persisted per project in `localStorage` (try/catch, per-viewer convenience),
  switcher in the project shell top bar (only when `LocalesStore.isLocalized`), keyboard
  shortcut documented in the Shift+? overlay.
- **Form engine:**
  - `FormBuilderService` builds a localizable leaf control bound to
    `values[editingLocale]` of the L10N wrapper and writes back via the same wrapper
    helper semantics as `L10nValues` (keep other locales untouched on save);
  - switching locale rebinds controls without losing unsaved edits of the previous locale
    (autosave flushes or the in-memory wrapper keeps both);
  - a localizable field shows a locale badge; an empty value whose fallback resolves shows
    the fallback value as placeholder text with "from `de`" hint and a "copy from `de`"
    action; non-localizable fields show an "all languages" hint when the project is
    localized;
  - `required` indicator only in the default locale;
  - `visibleWhen` evaluates against the editing locale's resolved value (shared fixture
    from M24.2.1).
- **Template save flows:** when `TemplateServiceImpl` returns a
  `LocalizationMigrationResult` requiring confirmation (on → off with translations), show a
  confirm dialog listing affected assets/discarded count, then re-save with
  `confirmDiscard=true`. Same for the Languages tab disabling locales (M24.1.2).
- **Media + navigation:** alt text / caption fields and PageReference label follow the
  editing locale.
- **Preview:** preview pane and share-link creation pass `locale=editingLocale`; preview
  toolbar shows the locale.
- **Diff:** `revision-diff.component` renders `content.headline.values.en` as
  "Headline (English)" instead of the raw path.
- **Search palette:** pass the editing locale to `GET /search` (M23.4.1) by default.
- Time travel: switcher remains usable (read-only viewing per locale), inputs disabled.

## Acceptance criteria

- [ ] Page editor: switch to `en`, type a headline, autosave, reload → `de` unchanged,
      `en` saved; payload contains both in one wrapper.
- [ ] Empty `en` field shows `de` fallback placeholder + "copy from" works.
- [ ] Global set editor, record editor, media drawer and nav label editor all follow the
      switcher.
- [ ] Toggling a template editor to non-localizable with translations shows the confirm
      dialog; cancel writes nothing.
- [ ] Preview renders the `en` output; share link opens `en`.
- [ ] Diff labels locale.
- [ ] Non-localized project: no switcher, no badges, forms behave exactly as before.
- [ ] Specs for `FormBuilderService` L10N binding (pure logic, runs despite the
      `templateUrl` runner issue); `npm run build` green.

## Out of scope

- Missing-translation indicators across pages (M24.4.2).
- Side-by-side translation view / machine translation.

## Notes / hazards

- Autosave race: switching locale mid-debounce must not write the old locale's pending
  value into the new locale's slot — bind by locale at edit time, not at flush time.
- Accessibility: the fallback placeholder must not be read as a real value by screen
  readers (`aria-describedby` hint, not `value`).
