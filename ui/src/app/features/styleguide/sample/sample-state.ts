import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HashMap, TranslocoService } from '@jsverse/transloco';
import { ToastService } from '../../../core/ui/toast.service';
import {
  FIXED_CONTENT_FILTER,
  FIXED_CONTENT_FOLDER,
  FIXED_DATASET,
  FIXED_RECORD,
  FIXED_RECORD_SELECTION,
  FIXED_RECORD_SET,
  SampleContentEntry,
  SampleRecord,
  contentEntry,
  contentParentOf,
  contentPath,
  recordSetOf,
  recordSets,
  templateEntry,
  templatePath,
} from './sample-content-data';
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
  | 'history';
/** Areas whose own component fills the main region (with its own tree and query parameters); their view is the area. */
export const SELF_CONTAINED_AREAS = ['media', 'navigation', 'globals', 'changes', 'schedules', 'publishing', 'settings', 'history'] as const;
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
  /** Re-evaluates the translated labels once the language file is in. */
  private readonly translation = toSignal(this.transloco.selectTranslation(), { initialValue: null });

  readonly view = signal<SampleView>('folder');
  readonly area = computed<SampleArea>(() => AREA_OF_VIEW[this.view()]);

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

  openFolder(id: string | null, preselect: readonly string[] = []): void {
    this.folderId.set(id);
    this.preselect.set(preselect);
    this.view.set('folder');
  }

  openPage(id: string): void {
    this.pageId.set(id);
    this.view.set('editor');
  }

  openContentFolder(id: string | null): void {
    this.contentFolderId.set(id);
    this.view.set('contentfolder');
  }

  openRecordSet(id: string, preselect: readonly string[] = []): void {
    this.recordSetId.set(id);
    this.contentFolderId.set(contentParentOf(id));
    this.preselect.set(preselect);
    this.view.set('recordset');
  }

  openRecord(id: string): void {
    const set = recordSetOf(id);
    if (set) {
      this.recordSetId.set(set.id);
      this.contentFolderId.set(contentParentOf(set.id));
    }
    this.recordId.set(id);
    this.view.set('record');
  }

  /** A template, dataset or templates folder (`null` = the root). */
  openTemplate(id: string | null): void {
    this.templateId.set(id);
    this.view.set(templateEntry(id)?.kind === 'dataset' ? 'dataset' : 'template');
  }

  /** The rail: an area's start (its root folder). */
  openArea(area: SampleArea): void {
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

  /** Every action that would change something says so instead: nothing is saved in the prototype. */
  notice(key = 'prototypeNotice', params?: HashMap): void {
    this.toasts.show(this.t(key, params), 'info');
  }
}
