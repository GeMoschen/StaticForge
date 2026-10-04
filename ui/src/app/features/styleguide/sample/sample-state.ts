import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HashMap, TranslocoService } from '@jsverse/transloco';
import { ToastService } from '../../../core/ui/toast.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { DialogService } from '../../../shared/components/dialog/dialog.service';
import {
  FIXED_CONTENT_FILTER,
  FIXED_CONTENT_FOLDER,
  FIXED_DATASET,
  FIXED_RECORD,
  FIXED_RECORD_SELECTION,
  FIXED_RECORD_SET,
  SampleContentEntry,
  SampleRecord,
  SampleTemplateEntry,
  TEMPLATE_USAGES,
  contentEntry,
  contentParentOf,
  contentPath,
  recordSetOf,
  recordSets,
  templateEntry,
  templatePath,
  templateUsageCount,
  templatesInside,
} from './sample-content-data';
import {
  CONTENT_ROOT,
  SampleContentMoveData,
  SampleContentMoveDialogComponent,
} from './sample-content-move-dialog.component';
import {
  SampleContentRenameData,
  SampleContentRenameDialogComponent,
  SampleContentRenameResult,
} from './sample-content-rename-dialog.component';
import { FAVORITE_SEED, SampleFavorite, favoriteKey, pageFavorite } from './sample-favorites';
import {
  SampleNewTemplateData,
  SampleNewTemplateDialogComponent,
  SampleNewTemplateKind,
  SampleNewTemplateResult,
} from './sample-new-template-dialog.component';
import {
  SampleNewRecordSetData,
  SampleNewRecordSetDialogComponent,
  SampleNewRecordSetResult,
} from './sample-new-record-set-dialog.component';
import {
  FIXED_FOLDER,
  FIXED_PAGE,
  FIXED_SELECTION,
  SampleEntry,
  SampleLang,
  SampleStatus,
  entryById,
  parentOf,
  pathTo,
} from './sample-data';
import {
  SampleCdlSection,
  SampleTemplateChannel,
  SampleTemplateKey,
  TEMPLATE_DEFS,
  templateDefByKey,
} from './sample-template-data';

/** The rail's working areas of the sample. */
export type SampleArea =
  | 'pages'
  | 'content'
  | 'templates'
  | 'media'
  | 'navigation'
  | 'globals'
  | 'changes'
  | 'schedules'
  | 'publishing'
  | 'settings'
  | 'history'
  | 'account'
  | 'admin'
  | 'login'
  | 'setpassword';
/** Areas whose own component fills the main region (with its own tree and query parameters); their view is the area. */
export const SELF_CONTAINED_AREAS = [
  'media',
  'navigation',
  'globals',
  'changes',
  'schedules',
  'publishing',
  'settings',
  'history',
  'account',
  'admin',
  'login',
  'setpassword',
] as const;
/** The screens outside the frame (M35.16): no top bar, no rail — a centred card on the page background. */
export const BARE_AREAS: readonly SampleArea[] = ['login', 'setpassword'];
/** The areas of Administration (M35.16): the rail lists them instead of the project's areas. */
export type SampleAdminSection = 'users' | 'projects' | 'jobs' | 'audit';
export const ADMIN_SECTIONS: readonly SampleAdminSection[] = ['users', 'projects', 'jobs', 'audit'];
export type SampleSelfContainedArea = (typeof SELF_CONTAINED_AREAS)[number];
/** The areas the sample renders. */
export const SAMPLE_AREAS: readonly SampleArea[] = [
  'pages',
  'content',
  'templates',
  'media',
  'navigation',
  'globals',
  'changes',
  'schedules',
  'publishing',
  'settings',
  'history',
  'account',
  'admin',
  'login',
  'setpassword',
];

/**
 * What the main pane shows. Pages: `folder`, `editor`. Content: `contentfolder`, `recordset`, `record`. Templates:
 * `dataset`, `template` (a page or section template; another template or a folder is a placeholder until M35.21).
 * The self-contained areas: one view each, named like the area.
 */
export type SampleView = 'folder' | 'editor' | 'contentfolder' | 'recordset' | 'record' | 'dataset' | 'template' | SampleSelfContainedArea;
export const SAMPLE_VIEWS: readonly SampleView[] = [
  'folder',
  'editor',
  'contentfolder',
  'recordset',
  'record',
  'dataset',
  'template',
  ...SELF_CONTAINED_AREAS,
];

export const AREA_OF_VIEW: Readonly<Record<SampleView, SampleArea>> = {
  folder: 'pages',
  editor: 'pages',
  contentfolder: 'content',
  recordset: 'content',
  record: 'content',
  dataset: 'templates',
  template: 'templates',
  media: 'media',
  navigation: 'navigation',
  globals: 'globals',
  changes: 'changes',
  schedules: 'schedules',
  publishing: 'publishing',
  settings: 'settings',
  history: 'history',
  account: 'account',
  admin: 'admin',
  login: 'login',
  setpassword: 'setpassword',
};

export type SampleRail = 'expanded' | 'collapsed';
export type SampleThemeChoice = 'light' | 'dark' | 'system';
export type SampleDensity = 'compact' | 'comfortable';
/** The dataset view's tabs: overview, the schema and rules (CDL), one per record template channel. */
export type SampleDatasetTab = 'overview' | 'schema' | 'rules' | 'html' | 'rss';
export const SAMPLE_DATASET_TABS: readonly SampleDatasetTab[] = ['overview', 'schema', 'rules', 'html', 'rss'];
/** The code highlighting palette previewed on `<html data-code-palette>` (decision 18). */
export type SampleCodePalette = 'current' | 'refined';

/** One breadcrumb segment; `target` is the folder it opens (`null` = the area's root), none for the current item. */
export interface SampleCrumb {
  readonly label: string;
  readonly target?: string | null;
}

export const STATUS_TONES = {
  released: 'success',
  changed: 'warning',
  draft: 'neutral',
  scheduled: 'info',
} as const satisfies Record<SampleStatus, string>;

export const STATUS_ICONS: Readonly<Record<SampleStatus, string>> = {
  released: 'check_circle',
  changed: 'edit',
  draft: 'radio_button_unchecked',
  scheduled: 'schedule',
};

const AREA_LABELS: Readonly<Record<SampleArea, string>> = {
  pages: 'rail.pages',
  content: 'rail.records',
  templates: 'rail.templates',
  media: 'rail.media',
  navigation: 'rail.navigation',
  globals: 'rail.globals',
  changes: 'rail.changes',
  schedules: 'rail.schedules',
  publishing: 'rail.publishing',
  settings: 'rail.settings',
  history: 'history.title',
  account: 'rail.account',
  admin: 'rail.admin',
  login: 'rail.account',
  setpassword: 'rail.account',
};

function initialRecords(): ReadonlyMap<string, readonly SampleRecord[]> {
  return new Map(recordSets().map((set) => [set.id, set.records ?? []]));
}

/**
 * The sample screen's state (M35.9), provided by {@link SampleScreenComponent} and shared by its parts: the area and
 * what is open in it, developer mode, the rail, theme and density, the editing language, and the in-memory records.
 * Nothing is persisted; the query parameters mirror the screen state (see the screen component).
 */
@Injectable()
export class SampleState {
  private readonly transloco = inject(TranslocoService);
  private readonly toasts = inject(ToastService);
  private readonly dialogs = inject(DialogService);
  private readonly confirms = inject(ConfirmService);
  private readonly injector = inject(Injector);
  /** Re-evaluates the translated labels once the language file is in. */
  private readonly translation = toSignal(this.transloco.selectTranslation(), { initialValue: null });

  readonly view = signal<SampleView>('folder');
  readonly area = computed<SampleArea>(() => AREA_OF_VIEW[this.view()]);
  /** Login and Set password sit outside the frame. */
  readonly bare = computed(() => BARE_AREAS.includes(this.area()));

  // ── Administration (M35.16): the rail's section and the open detail, mirrored in the URL by the admin area ──────
  readonly adminSection = signal<SampleAdminSection>('users');
  /** The open user (`auser`) or job (`ajob`) of the section; `null` = its list. */
  readonly adminDetail = signal<string | null>(null);

  // ── Pages ──────────────────────────────────────────────────────────────────
  /** The folder of the folder view; `null` = the Pages root. */
  readonly folderId = signal<string | null>(null);
  readonly pageId = signal<string>(FIXED_PAGE);
  /** Rows a table selects once when it shows (the scripted `view=folder` and `view=recordset` states). */
  readonly preselect = signal<readonly string[]>([]);
  /** The page editor scrolls to this outline entry once (`focus=catalog`). */
  readonly focus = signal<string | null>(null);

  // ── Content ────────────────────────────────────────────────────────────────
  /** The folder of the content folder view; `null` = the Content root. */
  readonly contentFolderId = signal<string | null>(null);
  readonly recordSetId = signal<string>(FIXED_RECORD_SET);
  readonly recordId = signal<string>(FIXED_RECORD);
  /** The dataset filter the content folder table applies once (`view=contentfolder`). */
  readonly presetFilter = signal<string | null>(null);
  /** Whether the record set's query panel starts expanded (`view=recordset`). */
  readonly queryExpanded = signal(false);
  /** `show=all`: the record table starts on *All records* instead of *Shown by the filter*. */
  readonly showAll = signal(false);
  /** `filter=custom`: the open record set stores a filter the builder cannot show (applied once on arrival). */
  readonly queryPreset = signal<'custom' | null>(null);
  /** `dialog=rename|move|bulkmove`: a Content dialog open on arrival (on the open folder, record set or the preselected records). */
  readonly contentDialog = signal<'rename' | 'move' | 'bulkmove' | null>(null);
  /** `panel=checks|usedby`: the record editor's Checks and Used by drawer, or the record set's Used by drawer, open on arrival. */
  readonly contentPanel = signal<'checks' | 'usedby' | null>(null);
  /** `state=notfound|revision|error|deleted` on the record editor: no such record, none at that revision, not loadable, or deleted. */
  readonly recordReview = signal<'notfound' | 'revision' | 'error' | 'deleted' | null>(null);
  /** The records of every record set, by set id: edits and deletes change them (in memory only). */
  readonly records = signal<ReadonlyMap<string, readonly SampleRecord[]>>(initialRecords());

  // ── Templates ──────────────────────────────────────────────────────────────
  /** The selected template, dataset or folder; `null` = the Templates root. */
  readonly templateId = signal<string | null>(FIXED_DATASET);
  readonly datasetTab = signal<SampleDatasetTab>('overview');
  /** The template view's CDL tab and channel tab. */
  readonly templateSection = signal<SampleCdlSection>('content');
  readonly templateChannel = signal<SampleTemplateChannel>('html');
  readonly palette = signal<SampleCodePalette>('current');
  /** The template, dataset or folder whose *Used by* drawer is open (gate round 13); `null` = closed. */
  readonly templateUsedBy = signal<string | null>(null);

  // ── Media, Navigation, Globals (their own components) ──────────────────────
  /** The breadcrumb below the area's name, set by the area's component ("Media › Products"). */
  readonly areaPath = signal<readonly SampleCrumb[]>([]);
  /** The breadcrumb segment chosen last in such an area (`target` null = its root); the area's component follows it. */
  readonly areaTarget = signal<{ readonly target: string | null } | null>(null);

  readonly devMode = signal(true);
  /** Developer mode for parts that only read it (the area components). */
  readonly developerMode = this.devMode.asReadonly();
  readonly rail = signal<SampleRail>('expanded');
  readonly theme = signal<SampleThemeChoice>('light');
  readonly density = signal<SampleDensity>('compact');
  readonly lang = signal<SampleLang>('en');
  /** The History drawer: the project's history (top bar) or the open item's (editor). */
  readonly history = signal<'project' | 'page' | 'record' | null>(null);
  /** Time travel (M35.12): the revision the whole screen shows read-only, with the banner; `null` = now. */
  readonly travel = signal<number | null>(null);
  /** The revision the full History page opens (the drawer's *Details*). */
  readonly historyRev = signal<number | null>(null);
  readonly shortcutsOpen = signal(false);

  // ── Pages (M35.18): the settings and issues drawers, the empty project, the preview, the jump from an issue ─────
  /** The Page settings / Folder settings drawer (`psettings=page|folder`). */
  readonly pageSettings = signal<'page' | 'folder' | null>(null);
  /** The Issues drawer (`issues=1`); `issuesReview` = `empty` shows the "No issues" state. */
  readonly issues = signal(false);
  readonly issuesReview = signal<'live' | 'empty'>('live');
  /** The Pages area of a project without pages (`empty=1`). */
  readonly emptyProject = signal(false);
  /** The preview cannot render yet (`preview=incomplete`): it explains what is missing. */
  readonly previewIncomplete = signal(false);
  /** The editor scrolls to this outline entry (an issue's *Jump*, the preview's *Go to field*); `n` makes each request new. */
  readonly editorJump = signal<{ readonly target: string; readonly field: string | null; readonly n: number } | null>(null);
  private jumps = 0;

  jumpTo(target: string, field: string | null = null): void {
    this.editorJump.set({ target, field, n: ++this.jumps });
  }

  /** One right-hand drawer at a time: opening one closes the others (History, Page settings, Issues). */
  closeDrawers(): void {
    this.history.set(null);
    this.pageSettings.set(null);
    this.issues.set(false);
  }

  // ── Favorites and recents (M35.15) ─────────────────────────────────────────
  /** Favorite pages: the star in the editor, the tree's context menu and the table, the tree's *Favorites* node and the palette share them. */
  readonly favorites = signal<readonly SampleFavorite[]>(FAVORITE_SEED);
  /** The pages opened last, newest first. */
  readonly recents = signal<readonly string[]>(['p-spring-harvest', 'p-single-origins', 'p-home']);

  /** The Favorites list fills the main pane (a tree's *Favorites* node was opened). */
  readonly favoritesOpen = signal(false);

  /** Whether the page or folder of the Pages store is a favorite. */
  isFavorite(id: string): boolean {
    return this.isFavoriteKey(favoriteKey('pages', id));
  }

  isFavoriteKey(key: string): boolean {
    return this.favorites().some((favorite) => favorite.key === key);
  }

  /** Stars or unstars a page or folder of the Pages store. */
  toggleFavorite(id: string): void {
    const entry = entryById(id);
    if (entry) {
      this.toggleFavoriteOf(pageFavorite(entry));
    }
  }

  /** Stars or unstars anything, from any store. */
  toggleFavoriteOf(favorite: SampleFavorite): void {
    if (this.isFavoriteKey(favorite.key)) {
      this.removeFavorite(favorite.key);
    } else {
      this.favorites.update((all) => [...all, favorite]);
      this.notice('favorites.added', { name: favorite.name });
    }
  }

  removeFavorite(key: string): void {
    const favorite = this.favorites().find((f) => f.key === key);
    if (favorite) {
      this.favorites.update((all) => all.filter((f) => f.key !== key));
      this.notice('favorites.removed', { name: favorite.name });
    }
  }

  /** A node of the *Favorites* branch: the pinned node opens the list, anything below it opens the item it stands for. */
  openFavoriteNode(favorite: SampleFavorite | undefined): void {
    if (favorite) {
      this.openFavorite(favorite);
    } else {
      this.openFavorites();
    }
  }

  /** Opens a favorite in its own area. Only pages, records and templates exist as screens of their own in the sample. */
  openFavorite(favorite: SampleFavorite): void {
    switch (favorite.kind) {
      case 'page':
        this.openPage(favorite.id);
        break;
      case 'folder':
        if (favorite.area === 'pages') {
          this.openFolder(favorite.id);
        } else if (favorite.area === 'content') {
          this.openContentFolder(favorite.id);
        } else if (favorite.area === 'templates') {
          this.openTemplate(favorite.id);
        } else {
          this.openArea(favorite.area);
          this.notice('favorites.openedIn', { name: favorite.name, area: this.t(`rail.${favorite.area}`) });
        }
        break;
      case 'recordset':
        this.openRecordSet(favorite.id);
        break;
      case 'record':
        this.openRecord(favorite.id);
        break;
      case 'template':
        this.openTemplate(favorite.id);
        break;
      default:
        this.openArea(favorite.area);
        this.notice('favorites.openedIn', { name: favorite.name, area: this.t(`rail.${favorite.area}`) });
    }
  }
  /** The `?` sheet's search text when it opens (`sheetq`). */
  readonly shortcutsQuery = signal('');
  /** The command palette (M35.14): `null` = closed, else its query including a mode prefix (`>`, `#`, `@`). */
  readonly paletteQuery = signal<string | null>(null);

  // ── Unsaved changes (M35.13) ───────────────────────────────────────────────
  private readonly guards = new Set<() => Promise<boolean>>();

  /** An editor with unsaved changes registers what asks the person before the screen changes; returns its removal. */
  registerGuard(guard: () => Promise<boolean>): () => void {
    this.guards.add(guard);
    return () => this.guards.delete(guard);
  }

  /** Whether the screen may change: every registered guard agrees (each asks only when its editor has unsaved changes). */
  async canLeave(): Promise<boolean> {
    for (const guard of [...this.guards]) {
      if (!(await guard())) {
        return false;
      }
    }
    return true;
  }

  readonly folder = computed<SampleEntry | null>(() => entryById(this.folderId()));
  readonly page = computed<SampleEntry>(() => entryById(this.pageId())!);
  readonly contentFolder = computed<SampleContentEntry | null>(() => contentEntry(this.contentFolderId()));
  readonly recordSet = computed<SampleContentEntry>(() => contentEntry(this.recordSetId())!);
  readonly record = computed<SampleRecord | null>(
    () => this.recordsOf(this.recordSetId()).find((r) => r.id === this.recordId()) ?? null,
  );

  /** The open item's path: area › folders › item. */
  readonly breadcrumb = computed<SampleCrumb[]>(() => {
    const area = this.area();
    const section = this.t(AREA_LABELS[area]);
    if (this.favoritesOpen()) {
      return [{ label: section, target: null }, { label: this.t('favorites.node') }];
    }
    let path: { readonly id: string; readonly name: string }[];
    switch (this.view()) {
      case 'editor':
        path = pathTo(this.pageId());
        break;
      case 'folder':
        path = pathTo(this.folderId());
        break;
      case 'contentfolder':
        path = contentPath(this.contentFolderId());
        break;
      case 'recordset':
        path = contentPath(this.recordSetId());
        break;
      case 'record': {
        const name = this.recordName(this.record());
        path = [...contentPath(this.recordSetId()), { id: this.recordId(), name }];
        break;
      }
      case 'dataset':
      case 'template':
        path = templatePath(this.templateId());
        break;
      default: {
        const crumbs = this.areaPath();
        return crumbs.length ? [{ label: section, target: null }, ...crumbs] : [{ label: section }];
      }
    }
    if (path.length === 0) {
      return [{ label: section }];
    }
    const crumbs: SampleCrumb[] = [{ label: section, target: null }];
    path.forEach((entry, i) => crumbs.push(i === path.length - 1 ? { label: entry.name } : { label: entry.name, target: entry.id }));
    return crumbs;
  });

  /** A `styleguide.sample.*` text. Reading it inside a `computed` tracks the language file. */
  t(key: string, params?: HashMap): string {
    this.translation();
    return this.transloco.translate(`styleguide.sample.${key}`, params);
  }

  statusLabel(status: SampleStatus): string {
    return this.t(`status.${status}`);
  }

  /** A record's display name (decision 19: never its UUID). */
  recordName(record: SampleRecord | null): string {
    const name = record?.values['name'];
    return typeof name === 'string' && name.trim() ? name : this.t('record.untitled');
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  /** Shows the Favorites list in the open area (it stays where it is; the list is the same in every store). */
  openFavorites(): void {
    this.favoritesOpen.set(true);
  }

  openFolder(id: string | null, preselect: readonly string[] = []): void {
    this.favoritesOpen.set(false);
    this.folderId.set(id);
    this.preselect.set(preselect);
    this.view.set('folder');
  }

  openPage(id: string): void {
    this.favoritesOpen.set(false);
    this.recents.update((all) => [id, ...all.filter((existing) => existing !== id)].slice(0, 8));
    this.pageId.set(id);
    this.view.set('editor');
  }

  openContentFolder(id: string | null): void {
    this.favoritesOpen.set(false);
    this.contentFolderId.set(id);
    this.view.set('contentfolder');
  }

  openRecordSet(id: string, preselect: readonly string[] = []): void {
    this.favoritesOpen.set(false);
    this.recordSetId.set(id);
    this.contentFolderId.set(contentParentOf(id));
    this.preselect.set(preselect);
    this.view.set('recordset');
  }

  openRecord(id: string): void {
    this.favoritesOpen.set(false);
    const set = recordSetOf(id);
    if (set) {
      this.recordSetId.set(set.id);
      this.contentFolderId.set(contentParentOf(set.id));
    }
    this.recordId.set(id);
    this.view.set('record');
  }

  /** The Templates main pane shows a folder's table (or the root's), not a template. */
  readonly templateIsFolder = computed(() => {
    const entry = templateEntry(this.templateId());
    return entry === null || entry.kind === 'folder';
  });

  /** The folder a *New* goes into: the open folder, else the folder of the open template; `null` = the root. */
  templateFolderOf(): string | null {
    const open = templateEntry(this.templateId());
    return open?.kind === 'folder' ? open.id : (templatePath(this.templateId()).at(-2)?.id ?? null);
  }

  /** A template, dataset or templates folder (`null` = the root). */
  openTemplate(id: string | null): void {
    this.favoritesOpen.set(false);
    this.templateId.set(id);
    this.view.set(templateEntry(id)?.kind === 'dataset' ? 'dataset' : 'template');
  }

  /** The rail: an area's start (its root folder). */
  openArea(area: SampleArea): void {
    this.favoritesOpen.set(false);
    if (area === 'pages') {
      this.openFolder(null);
    } else if (area === 'content') {
      this.openContentFolder(null);
    } else if (area === 'templates') {
      this.openTemplate(null);
    } else {
      this.areaPath.set([]);
      this.view.set(area as SampleSelfContainedArea);
    }
  }

  /** A breadcrumb segment of the current area (`null` = its root). */
  navigate(target: string | null): void {
    switch (this.area()) {
      case 'pages':
        this.openFolder(target);
        break;
      case 'content':
        if (target !== null && contentEntry(target)?.kind === 'recordset') {
          this.openRecordSet(target);
        } else {
          this.openContentFolder(target);
        }
        break;
      case 'templates':
        this.openTemplate(target);
        break;
      default:
        this.areaTarget.set({ target });
    }
  }

  /** The scripted states of the `view` query parameter (`template` picks the template of `view=template`). */
  openFixed(view: SampleView, template: SampleTemplateKey = 'article'): void {
    switch (view) {
      case 'editor':
        this.folderId.set(parentOf(FIXED_PAGE));
        this.openPage(FIXED_PAGE);
        break;
      case 'folder':
        this.openFolder(FIXED_FOLDER, FIXED_SELECTION);
        break;
      case 'contentfolder':
        this.presetFilter.set(FIXED_CONTENT_FILTER);
        this.openContentFolder(FIXED_CONTENT_FOLDER);
        break;
      case 'recordset':
        this.queryExpanded.set(true);
        this.openRecordSet(FIXED_RECORD_SET, FIXED_RECORD_SELECTION);
        break;
      case 'record':
        this.openRecord(FIXED_RECORD);
        break;
      case 'dataset':
        this.openTemplate(FIXED_DATASET);
        break;
      case 'template':
        this.openTemplate(templateDefByKey(template)?.id ?? TEMPLATE_DEFS[0].id);
        break;
      default:
        this.openArea(AREA_OF_VIEW[view]);
    }
  }


  // ── Records (in memory) ────────────────────────────────────────────────────

  recordsOf(setId: string): readonly SampleRecord[] {
    return this.records().get(setId) ?? [];
  }

  updateRecord(setId: string, next: SampleRecord): void {
    this.setRecords(setId, this.recordsOf(setId).map((r) => (r.id === next.id ? next : r)));
  }

  /** Removes records; the returned function puts them back where they were. */
  removeRecords(setId: string, ids: readonly string[]): () => void {
    const before = this.recordsOf(setId);
    const removed = before.map((r, i) => [i, r] as const).filter(([, r]) => ids.includes(r.id));
    this.setRecords(setId, before.filter((r) => !ids.includes(r.id)));
    return () => {
      const list = [...this.recordsOf(setId)];
      for (const [i, r] of removed) {
        list.splice(Math.min(i, list.length), 0, r);
      }
      this.setRecords(setId, list);
    };
  }

  private setRecords(setId: string, list: readonly SampleRecord[]): void {
    this.records.update((all) => new Map(all).set(setId, list));
  }

  /**
   * The New record set dialog (M35.20, gate round 10 — awaiting sign-off): a name and a dataset, none preselected. Creating
   * only says what would happen: nothing is saved in the prototype. `folderId` is where the set would go (`null`: the top level).
   */
  async newRecordSet(folderId: string | null): Promise<void> {
    const folder = contentEntry(folderId)?.name ?? this.t('content.title');
    const result = await this.dialogs.open<SampleNewRecordSetResult, SampleNewRecordSetData>(
      SampleNewRecordSetDialogComponent,
      { folder },
      { injector: this.injector },
    ).result;
    if (result) {
      this.notice('content.newSet.created', { name: result.name, folder });
    }
  }

  /** The Rename dialog of a record set or folder; what it returns is only announced (nothing is saved). */
  async renameContent(entry: SampleContentEntry): Promise<void> {
    const result = await this.dialogs.open<SampleContentRenameResult, SampleContentRenameData>(
      SampleContentRenameDialogComponent,
      { name: entry.name, uid: entry.uid, developer: this.devMode() },
      { injector: this.injector },
    ).result;
    if (result?.name) {
      this.notice('contentRename.renamed', { name: result.name });
    } else if (result?.uid) {
      this.toasts.undo(this.t('contentRename.uidChanged', { uid: result.uid }), () => this.notice('contentRename.uidRestored'));
    }
  }

  /** The folder Move dialog for record sets and folders; the move is only announced, with an Undo that says so. */
  async moveContent(entries: readonly SampleContentEntry[]): Promise<boolean> {
    const first = entries[0];
    const target = await this.dialogs.open<string, SampleContentMoveData>(
      SampleContentMoveDialogComponent,
      {
        mode: 'folder',
        title: this.t('contentMove.titleFolder', { count: entries.length, name: first.name }),
        current: contentParentOf(first.id) ?? CONTENT_ROOT,
        blocked: entries.filter((entry) => entry.kind === 'folder').flatMap((entry) => this.folderIds(entry)),
      },
      { injector: this.injector },
    ).result;
    if (!target) {
      return false;
    }
    const name = target === CONTENT_ROOT ? this.t('content.title') : (contentEntry(target)?.name ?? '');
    this.toasts.undo(this.t('contentMove.moved', { count: entries.length, name: first.name, target: name }), () =>
      this.notice('contentMove.movedBack'),
    );
    return true;
  }

  private folderIds(entry: SampleContentEntry): string[] {
    return [entry.id, ...(entry.children ?? []).filter((child) => child.kind === 'folder').flatMap((child) => this.folderIds(child))];
  }

  /**
   * The Move dialog for records: another record set of the same dataset. The records move in memory (and Undo moves them
   * back); resolves with the target set's id, or `null` when nothing was moved.
   */
  async moveRecordsToSet(fromSet: string, ids: readonly string[]): Promise<string | null> {
    const dataset = contentEntry(fromSet)?.dataset;
    const sets = recordSets()
      .filter((set) => set.dataset === dataset && set.id !== fromSet)
      .map((set) => ({ id: set.id, name: set.name, folder: contentEntry(contentParentOf(set.id))?.name ?? this.t('content.title') }));
    const first = this.recordsOf(fromSet).find((record) => ids.includes(record.id)) ?? null;
    const target = await this.dialogs.open<string, SampleContentMoveData>(
      SampleContentMoveDialogComponent,
      {
        mode: 'records',
        title: this.t('contentMove.titleRecords', { count: ids.length, name: this.recordName(first) }),
        current: fromSet,
        sets,
      },
      { injector: this.injector },
    ).result;
    if (!target) {
      return null;
    }
    const moved = this.recordsOf(fromSet).filter((record) => ids.includes(record.id));
    const restoreSource = this.removeRecords(fromSet, ids);
    this.setRecords(target, [...this.recordsOf(target), ...moved]);
    this.toasts.undo(
      this.t('contentMove.movedRecords', { count: ids.length, name: this.recordName(first), target: contentEntry(target)?.name ?? '' }),
      () => {
        this.removeRecords(target, ids);
        restoreSource();
        if (this.view() === 'record' && ids.includes(this.recordId())) {
          this.recordSetId.set(fromSet);
        }
      },
    );
    return target;
  }


  // ── Templates: the dialogs and changes of the tree, the folder table and the template header (gate round 13) ─────
  /**
   * The New template dialog. `kind` is what a *New ▸ kind* menu entry picked, or `null` from the header's button, which
   * asks. Creating only says what would happen: nothing is saved in the prototype.
   */
  async newTemplate(folderId: string | null, kind: SampleNewTemplateKind | null = null): Promise<void> {
    const folder = templateEntry(folderId)?.name ?? this.t('rail.templates');
    const result = await this.dialogs.open<SampleNewTemplateResult, SampleNewTemplateData>(
      SampleNewTemplateDialogComponent,
      { folder, kind },
      { injector: this.injector },
    ).result;
    if (result) {
      this.notice('templateNew.created', { name: result.name, kind: this.t(`templates.kind.${result.kind}`).toLowerCase(), folder });
    }
  }

  /** The Rename dialog of a template, dataset or folder (the UID section is always there: Templates is developer-only). */
  async renameTemplate(entry: SampleTemplateEntry): Promise<void> {
    const result = await this.dialogs.open<SampleContentRenameResult, SampleContentRenameData>(
      SampleContentRenameDialogComponent,
      { name: entry.name, uid: entry.uid, developer: true },
      { injector: this.injector },
    ).result;
    if (result?.name) {
      this.notice('contentRename.renamed', { name: result.name });
    } else if (result?.uid) {
      this.toasts.undo(this.t('contentRename.uidChanged', { uid: result.uid }), () => this.notice('contentRename.uidRestored'));
    }
  }

  /** The folder Move dialog for templates, datasets and folders; the move is only announced, with an Undo that says so. */
  async moveTemplates(entries: readonly SampleTemplateEntry[]): Promise<boolean> {
    const first = entries[0];
    const parent = templatePath(first.id).at(-2)?.id ?? CONTENT_ROOT;
    const target = await this.dialogs.open<string, SampleContentMoveData>(
      SampleContentMoveDialogComponent,
      {
        mode: 'folder',
        area: 'templates',
        title: this.t('contentMove.titleFolder', { count: entries.length, name: first.name }),
        current: parent,
        blocked: entries.filter((entry) => entry.kind === 'folder').flatMap((entry) => [entry.id, ...templatesInside(entry.id).map((e) => e.id)]),
      },
      { injector: this.injector },
    ).result;
    if (!target) {
      return false;
    }
    const name = target === CONTENT_ROOT ? this.t('rail.templates') : (templateEntry(target)?.name ?? '');
    this.toasts.undo(this.t('contentMove.moved', { count: entries.length, name: first.name, target: name }), () =>
      this.notice('contentMove.movedBack'),
    );
    return true;
  }

  /** *Duplicate* makes a copy next to the original (“Article copy”) and opens nothing; Undo removes it again. */
  duplicateTemplate(entry: SampleTemplateEntry): void {
    this.toasts.undo(this.t('templateActions.duplicated', { name: entry.name }), () => this.notice('templateActions.duplicateUndone'));
  }

  /**
   * The delete confirmation. What uses the templates is named — "3 pages use it" — because existing pages keep their
   * content but may break on the next build; a folder goes with everything inside it. Confirmed: a toast with Undo (the
   * tree shows its own, so it passes `announce = false`).
   */
  async deleteTemplates(entries: readonly SampleTemplateEntry[], announce = true): Promise<boolean> {
    const first = entries[0];
    const usages = entries.flatMap((entry) => (entry.kind === 'folder' ? templatesInside(entry.id) : [entry]).flatMap((e) => TEMPLATE_USAGES[e.id] ?? []));
    const pages = usages.filter((usage) => usage.type === 'page').length;
    const others = usages.length - pages;
    const lines: string[] = [];
    if (entries.some((entry) => entry.kind === 'folder')) {
      lines.push(this.t('templateActions.deleteFolders'));
    }
    if (usages.length > 0) {
      lines.push(this.t('templateActions.deleteInUse', { pages, others }));
    }
    lines.push(this.t('templateActions.deleteRestore'));
    const confirmed = await this.confirms.confirm({
      title: this.t('templateActions.deleteTitle', { count: entries.length, name: first.name }),
      message: lines.join(' '),
      confirmLabel: this.t('templateActions.deleteConfirm', { count: entries.length }),
      tone: 'danger',
      details: entries.map((entry) => `${entry.name}${templateUsageCount(entry) > 0 ? ` — ${this.t('templateActions.usedByCount', { count: templateUsageCount(entry) })}` : ''}`),
    });
    if (confirmed && announce) {
      this.toasts.undo(this.t('templateActions.deleted', { count: entries.length, name: first.name }), () => this.notice('folder.restored'));
    }
    return confirmed;
  }

  /** Every action that would change something says so instead: nothing is saved in the prototype. */
  notice(key = 'prototypeNotice', params?: HashMap): void {
    this.toasts.show(this.t(key, params), 'info');
  }
}
