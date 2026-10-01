import type { SfCatalogItem, SfCatalogType } from '../../shared/components/card/sf-catalog.component';
import type { ConfirmOptions } from '../../shared/components/dialog/confirm.service';
import type { SfDialogSize } from '../../shared/components/dialog/sf-dialog.component';
import type { SfBadgeTone } from '../../shared/components/display/sf-badge.component';
import type { SfStatusTone } from '../../shared/components/display/sf-status.component';
import type { SfComboboxOption } from '../../shared/components/forms/sf-combobox.component';
import type { SfRadioOption } from '../../shared/components/forms/sf-radio-group.component';
import type { SfSegmentedOption } from '../../shared/components/forms/sf-segmented.component';
import type { SfSelectOption } from '../../shared/components/forms/sf-select.component';
import type { SfBannerTone } from '../../shared/components/layout/sf-banner.component';
import type { SfSideNavItem } from '../../shared/components/layout/sf-side-nav.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import type { SfTab } from '../../shared/components/sf-tabs.component';
import type { SfButtonSize, SfButtonVariant } from '../../shared/components/sf-button.component';
import type { ToastKind } from '../../core/ui/toast.service';
import type { ContextMenuItem } from '../../shared/services/context-menu.service';

/**
 * Demo labels and sample content of the style guide (M35.9, user decision 5). The page chrome — headings, the index,
 * the switches, state captions — is translated (`styleguide.*` in `en.json`); what the components *show* is sample
 * content, kept here as data so the templates hold no literals.
 */

export const SAMPLE_GLYPHS = 'Aa';
export const TYPE_SAMPLE = 'Publish the spring campaign pages';
export const MONO_SAMPLE = '$CMS_VALUE(page.title)$';

// ── Buttons ──────────────────────────────────────────────────────────────────

export const BUTTON_VARIANTS: readonly { readonly variant: SfButtonVariant; readonly label: string }[] = [
  { variant: 'primary', label: 'Save' },
  { variant: 'secondary', label: 'Cancel' },
  { variant: 'ghost', label: 'Preview' },
  { variant: 'danger', label: 'Delete' },
  { variant: 'danger-ghost', label: 'Remove' },
];
export const BUTTON_SIZES: readonly SfButtonSize[] = ['sm', 'md'];

export const BUTTONS = {
  add: 'Add page',
  next: 'Next',
  settings: 'Settings',
  delete: 'Delete',
  more: 'More actions',
  saving: 'Saving',
  publish: 'Publish',
  publishTooltip: 'Publishes every pending change',
  disabledReason: 'Fix the 2 errors before publishing',
  sampleLink: 'Sample screen',
  externalLink: 'ARIA patterns',
  externalHref: 'https://www.w3.org/WAI/ARIA/apg/patterns/',
  pressed: 'Developer mode',
} as const;

// ── Forms ────────────────────────────────────────────────────────────────────

const LOCALES: readonly SfSelectOption<string>[] = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'ja', label: 'Japanese', disabled: true },
];

const MODES: readonly SfRadioOption<string>[] = [
  { value: 'full', label: 'Full', description: 'Rebuild every page' },
  { value: 'incremental', label: 'Incremental', description: 'Only pages that changed' },
  { value: 'scheduled', label: 'Scheduled', description: 'Not available on this project', disabled: true },
];

const VIEWS: readonly SfSegmentedOption<string>[] = [
  { value: 'list', label: 'List', icon: 'view_list' },
  { value: 'grid', label: 'Grid', icon: 'grid_view' },
  { value: 'tree', label: 'Tree', icon: 'account_tree', iconOnly: true },
  { value: 'table', label: 'Table', disabled: true },
];

const TEMPLATES: readonly SfComboboxOption<string>[] = [
  { value: 'home', label: 'Home page', description: 'Hero, teasers and news', group: 'Pages' },
  { value: 'article', label: 'Article', description: 'Long text with images', group: 'Pages' },
  { value: 'landing', label: 'Landing page', description: 'Campaign layout', group: 'Pages' },
  { value: 'contact', label: 'Contact', group: 'Pages' },
  { value: 'legacy', label: 'Legacy page', description: 'Retired', group: 'Pages', disabled: true },
  { value: 'teaser', label: 'Teaser', group: 'Sections' },
  { value: 'gallery', label: 'Gallery', group: 'Sections' },
  { value: 'quote', label: 'Quote', group: 'Sections' },
  { value: 'faq', label: 'FAQ', group: 'Sections' },
];

const TAGS: readonly SfComboboxOption<string>[] = [
  'campaign', 'spring', 'summer', 'news', 'product', 'press', 'event', 'career', 'blog', 'archive',
].map((tag) => ({ value: tag, label: tag }));

export const FORMS = {
  error: 'This needs your attention',
  input: { label: 'Page title', placeholder: 'Untitled', hint: 'Shown in the browser tab', value: 'Spring campaign' },
  textarea: { label: 'Description', hint: 'Up to 160 characters', value: 'Pages and teasers for the spring campaign.' },
  select: { label: 'Locale', placeholder: 'Choose a locale', options: LOCALES, value: 'en' },
  number: { label: 'Items per page', unit: 'items', value: 20 },
  date: { label: 'Publish on', value: '2026-10-15' },
  time: { label: 'Start time', value: '09:30' },
  datetime: { label: 'Release at', value: '2026-10-15T09:30' },
  search: { label: 'Search pages', placeholder: 'Title or path', value: 'campaign' },
  color: { label: 'Brand colour', value: '#2563eb' },
  file: { label: 'Hero image', hint: 'PNG or JPEG, up to 5 MB', accept: 'image/png,image/jpeg', maxSize: 5 * 1024 * 1024 },
  checkbox: { label: 'Visibility', text: 'Show in navigation', indeterminate: 'All pages of the folder' },
  radio: { label: 'Generation mode', options: MODES, value: 'incremental' },
  switch: { label: 'Developer mode', text: 'Show UIDs and technical fields' },
  segmented: { label: 'View', options: VIEWS, value: 'list' },
  combobox: { label: 'Template', placeholder: 'Choose a template', options: TEMPLATES, value: 'article' },
  multi: { label: 'Tags', placeholder: 'Add tags', options: TAGS, value: ['campaign', 'spring'] },
  slider: { label: 'Image quality', unit: '%', value: 80 },
  layout: {
    top: 'Label on top',
    inline: 'Label inline',
    required: 'Required field',
    optional: 'Optional field',
    hint: 'A hint under the control',
    error: 'With an error',
    errorText: 'Enter a value between 1 and 100',
  },
} as const;

// ── Display ──────────────────────────────────────────────────────────────────

export const BADGES: readonly { readonly tone: SfBadgeTone; readonly label: string; readonly icon?: string }[] = [
  { tone: 'neutral', label: 'Draft' },
  { tone: 'accent', label: 'New' },
  { tone: 'info', label: 'Scheduled', icon: 'schedule' },
  { tone: 'success', label: 'Published', icon: 'check_circle' },
  { tone: 'warning', label: 'Changed', icon: 'edit' },
  { tone: 'danger', label: '3 errors', icon: 'error' },
];

export const STATUSES: readonly { readonly tone: SfStatusTone; readonly label: string }[] = [
  { tone: 'neutral', label: 'Draft' },
  { tone: 'accent', label: 'In review' },
  { tone: 'info', label: 'Scheduled' },
  { tone: 'success', label: 'Published' },
  { tone: 'warning', label: 'Changed since release' },
  { tone: 'danger', label: 'Build failed' },
];

export const DISPLAY = {
  tags: ['campaign', 'spring', 'news'],
  featured: 'Featured',
  locked: 'Locked',
  shortcuts: ['Mod+K', 'Mod+Shift+P', 'F2', 'Shift+F10', 'g p'],
  avatars: ['Ada Lovelace', 'Grace Hopper', 'Linus'],
  copyValue: 'b3f1c2a0-5d7e-4f8a-9c21-0d6e4b7a1f93',
  copyLabel: 'Page UID',
  logoLabel: 'StaticForge',
} as const;

/** Moments relative to page load: two minutes ago, three hours ago, five days ago, in two days. */
export function relativeMoments(now = Date.now()): Date[] {
  const minute = 60_000;
  return [now - 2 * minute, now - 3 * 60 * minute, now - 5 * 24 * 60 * minute, now + 2 * 24 * 60 * minute].map(
    (t) => new Date(t),
  );
}

// ── Layout ───────────────────────────────────────────────────────────────────

export const LAYOUT = {
  toolbar: {
    label: 'Formatting',
    items: [
      { icon: 'format_bold', label: 'Bold' },
      { icon: 'format_italic', label: 'Italic' },
      { icon: 'link', label: 'Insert link' },
      { icon: 'format_list_bulleted', label: 'Bulleted list' },
    ],
    insert: 'Insert section',
  },
  section: {
    heading: 'Publishing',
    description: 'Where and when the generated site goes live.',
    body: 'Releases are built from the published state of every page.',
    action: 'Edit',
  },
  empty: {
    title: 'No pages yet',
    description: 'Create the first page of this folder or import existing content.',
    primary: 'Create page',
    secondary: 'Import',
  },
  skeleton: 'Loading pages',
  banners: [
    { tone: 'info', title: 'Scheduled release', message: 'The next release starts tonight at 22:00.' },
    { tone: 'success', title: 'Published', message: '24 pages went live.' },
    { tone: 'warning', title: 'Unpublished changes', message: '3 pages changed since the last release.' },
    { tone: 'danger', title: 'Build failed', message: 'The template "Article" has 2 errors.' },
  ] as readonly { readonly tone: SfBannerTone; readonly title: string; readonly message: string }[],
  bannerAction: 'Show details',
  spinner: 'Loading',
  tabsLabel: 'Page editor',
  navLabel: 'Project',
  tabs: [
    { id: 'content', label: 'Content', errors: 2 },
    { id: 'seo', label: 'SEO', dirty: true },
    { id: 'media', label: 'Media' },
    { id: 'navigation', label: 'Navigation' },
    { id: 'translations', label: 'Translations', note: 'disabled' },
    { id: 'permissions', label: 'Permissions' },
    { id: 'history', label: 'History' },
    { id: 'advanced', label: 'Advanced settings' },
  ] as readonly SfTab[],
  tabPanel: 'The panel of the selected tab.',
  navTabs: [
    { id: 'guide', label: 'Style guide', link: '/styleguide', exact: true },
    { id: 'sample', label: 'Sample screen', link: '/styleguide/sample' },
  ] as readonly SfTab[],
  sideNavLabel: 'Publishing',
  sideNav: [
    { id: 'runs', label: 'Runs', icon: 'history', badge: 1, badgeTone: 'info' },
    { id: 'targets', label: 'Targets', icon: 'dns' },
    { id: 'policy', label: 'Publish policy', icon: 'admin_panel_settings' },
    { id: 'quality', label: 'Quality', icon: 'rule', group: 'Checks', badge: 3, badgeTone: 'warning' },
    { id: 'redirects', label: 'Redirects', icon: 'alt_route', group: 'Checks' },
    { id: 'urls', label: 'URL registry', icon: 'link', group: 'Checks' },
  ] as readonly SfSideNavItem[],
  sideNavPanel: {
    runs: 'The run list: status, mode, target, trigger, duration and findings of every build.',
    targets: 'Where builds are written: folders on the server or remote targets.',
    policy: 'Who may release, build and schedule, per role.',
    quality: 'Link, SEO and accessibility rules and their levels.',
    redirects: 'Redirects from old URLs to their new pages.',
    urls: 'Every public URL the site has served, with its page.',
  } as Readonly<Record<string, string>>,
} as const;

// ── Overlays ─────────────────────────────────────────────────────────────────

export const DIALOG_SIZES: readonly SfDialogSize[] = ['sm', 'md', 'lg', 'full'];

export const OVERLAYS = {
  dialog: {
    title: 'Rename page',
    body: 'The page keeps its UID; links to it keep working.',
    field: 'New name',
    value: 'Spring campaign',
    cancel: 'Cancel',
    confirm: 'Rename',
  },
  drawer: {
    title: 'Page history',
    body: 'Every saved version of the page, newest first.',
    entries: ['Published by Ada Lovelace', 'Edited by Grace Hopper', 'Created by Linus'],
    close: 'Close',
  },
  popover: {
    trigger: 'Share preview',
    label: 'Share preview',
    body: 'Anyone with the link can see the draft for 7 days.',
    copy: 'Copy link',
    focusTrigger: 'What is a draft?',
    focusLabel: 'About drafts',
    focusBody: 'A draft is saved but not published.',
  },
  menu: { label: 'Page actions', text: 'Actions' },
  contextTarget: 'campaign/spring/index.html',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  menuChosen: 'Chosen: ',
  undone: 'Restored 3 pages',
} as const;

export const CONFIRMS: Readonly<Record<'default' | 'danger' | 'typed', ConfirmOptions>> = {
  default: {
    title: 'Publish 12 pages?',
    message: 'They go live with the next release.',
    confirmLabel: 'Publish 12 pages',
  },
  danger: {
    title: 'Delete 3 pages?',
    message: 'Their translations are deleted too.',
    confirmLabel: 'Delete 3 pages',
    tone: 'danger',
    details: ['Spring campaign', 'Spring teaser', 'Spring news'],
  },
  typed: {
    title: 'Delete the folder "campaign"?',
    message: 'The folder holds 48 pages.',
    confirmLabel: 'Delete folder',
    tone: 'danger',
    typeToConfirm: 'campaign',
    irreversible: true,
  },
};

export const TOASTS: readonly { readonly kind: ToastKind; readonly message: string }[] = [
  { kind: 'info', message: 'The release is queued.' },
  { kind: 'success', message: 'Page saved.' },
  { kind: 'warning', message: '2 links point to unpublished pages.' },
  { kind: 'error', message: 'The build failed: template "Article" has 2 errors.' },
];
export const UNDO_TOAST = 'Deleted 3 pages.';

export const MENU_ITEMS: readonly SfMenuItem[] = [
  { id: 'open', label: 'Open', icon: 'open_in_new', shortcut: 'Enter', group: 'Page' },
  { id: 'rename', label: 'Rename', icon: 'edit', shortcut: 'F2', group: 'Page' },
  { id: 'duplicate', label: 'Duplicate', icon: 'content_copy', shortcut: 'Mod+D', group: 'Page' },
  {
    id: 'move',
    label: 'Move to',
    icon: 'drive_file_move',
    group: 'Organise',
    children: [
      { id: 'move-root', label: 'Root' },
      { id: 'move-campaign', label: 'campaign' },
      { id: 'move-archive', label: 'archive', disabledReason: 'The archive is read-only' },
    ],
  },
  { id: 'publish', label: 'Publish', icon: 'publish', group: 'Organise', disabledReason: 'Fix the 2 errors first' },
  { id: 'delete', label: 'Delete', icon: 'delete', shortcut: 'Del', danger: true, separatorBefore: true },
];

export const CONTEXT_ITEMS: readonly ContextMenuItem[] = [
  { label: 'Open', icon: 'open_in_new', shortcut: 'Enter' },
  { label: 'Copy path', icon: 'content_copy', shortcut: 'Mod+C' },
  {
    label: 'Open in',
    icon: 'open_in_browser',
    children: [{ label: 'Preview' }, { label: 'Published site', disabledReason: 'Not published yet' }],
  },
  { separator: true, label: '' },
  { label: 'Delete', icon: 'delete', danger: true, shortcut: 'Del' },
];

// ── Data ─────────────────────────────────────────────────────────────────────

export const DATA = {
  treeLabel: 'Pages',
  tableLabel: 'Pages',
  splitterLabel: 'Resize the outline',
  splitterStart: 'Outline',
  splitterEnd: 'Editor',
  splitterStartBody: 'Sections of the page, in order.',
  splitterEndBody: 'Drag the separator, or focus it and use the arrow keys; Enter collapses the outline.',
  opened: 'Opened: ',
  search: 'Filter pages',
  columns: { title: 'Title', path: 'Path', status: 'Status', locale: 'Locale', author: 'Author', modified: 'Modified' },
  filters: { status: 'Status', locale: 'Locale' },
  bulk: { publish: 'Publish', delete: 'Delete' },
  done: 'Done: ',
} as const;

// ── Cards and catalogs ───────────────────────────────────────────────────────

/** A card of the demo catalogs: one text field (its summary) and, for a gallery, a nested catalog of slides. */
export interface DemoCard extends SfCatalogItem {
  readonly title: string;
  readonly children?: readonly DemoCard[];
}

export const CARDS = {
  types: [
    { id: 'teaser', label: 'Product teaser', icon: 'sell', description: 'A product with image, name and price' },
    { id: 'text', label: 'Text block', icon: 'notes', description: 'A heading and formatted text' },
    { id: 'gallery', label: 'Gallery', icon: 'photo_library', description: 'Slides with images and captions' },
  ] as readonly SfCatalogType[],
  slideTypes: [{ id: 'slide', label: 'Slide', icon: 'image' }] as readonly SfCatalogType[],
  /** The label of each type's text field. */
  fields: { teaser: 'Product name', text: 'Heading', gallery: 'Heading', slide: 'Caption' } as Readonly<
    Record<string, string>
  >,
  catalogLabel: 'Page content',
  slidesLabel: 'Slides',
  emptyLabel: 'Sidebar',
  readonlyLabel: 'Footer (from the page template)',
  single: {
    type: 'Product teaser',
    icon: 'sell',
    summary: 'Yirgacheffe 250 g',
    body: 'Washed Ethiopian coffee with notes of jasmine and lemon.',
    textType: 'Text block',
    textIcon: 'notes',
    textSummary: 'Our roasting process, from green bean to the cup on your table',
  },
  menu: [
    { id: 'duplicate', label: 'Duplicate', icon: 'content_copy' },
    { id: 'remove', label: 'Remove', icon: 'delete', danger: true, separatorBefore: true },
  ] as readonly SfMenuItem[],
  chosen: 'Chosen: ',
  removed: 'Removed: ',
  untitled: 'untitled card',
} as const;

/** The demo page content: four cards, the gallery holding a nested catalog of slides. */
export function demoCards(): DemoCard[] {
  return [
    { id: 'card-1', type: 'teaser', title: 'Yirgacheffe 250 g' },
    { id: 'card-2', type: 'text', title: 'Our roasting process' },
    {
      id: 'card-3',
      type: 'gallery',
      title: 'The roastery',
      children: [
        { id: 'card-3-1', type: 'slide', title: 'Green beans arrive' },
        { id: 'card-3-2', type: 'slide', title: 'The drum roaster' },
      ],
    },
    { id: 'card-4', type: 'teaser', title: '' },
  ];
}

/** The read-only demo catalog. */
export function demoReadonlyCards(): DemoCard[] {
  return [
    { id: 'footer-1', type: 'text', title: 'Visit us' },
    { id: 'footer-2', type: 'teaser', title: 'Gift card' },
  ];
}
