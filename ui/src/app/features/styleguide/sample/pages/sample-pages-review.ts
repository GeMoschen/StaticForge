import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ToastService } from '../../../../core/ui/toast.service';
import { DialogService } from '../../../../shared/components/dialog/dialog.service';
import type { SfTreeNode } from '../../../../shared/components/tree/tree-model';
import { TreeClipboardService } from '../../../../shared/services/tree-clipboard.service';
import { oneOf } from '../changes/sample-area.util';
import {
  SampleContentRenameData,
  SampleContentRenameDialogComponent,
  SampleContentRenameResult,
} from '../sample-content-rename-dialog.component';
import { FIXED_FOLDER, FIXED_SELECTION, SAMPLE_LANGS, SampleEntry, entryById, parentOf, pathTo } from '../sample-data';
import { SampleState } from '../sample-state';

/** What the folder table shows while it reads (`fstate=loading`), when the read failed (`error`) or when the folder has nothing in it (`empty`). */
export type FolderReviewState = 'normal' | 'loading' | 'error' | 'empty';
export const FOLDER_REVIEW_STATES: readonly FolderReviewState[] = ['normal', 'loading', 'error', 'empty'];

/**
 * The template view's review states (`tstate`, gate round 13): `loading` (skeleton), `error` (could not be read, Retry),
 * `discard` (Save asks first because the change drops translations), `saveerror` (the last save was refused with compile errors).
 */
export type TemplateReviewState = 'normal' | 'loading' | 'error' | 'discard' | 'saveerror';
export const TEMPLATE_REVIEW_STATES: readonly TemplateReviewState[] = ['normal', 'loading', 'error', 'discard', 'saveerror'];

/** The Issues drawer's check status (`istatus=checking|unavailable`); `published` adds the note that the preview shows the published page. */
export type IssuesReviewStatus = 'checked' | 'checking' | 'unavailable';

/** The revision conflict drawer: `fields` lets the person pick per field, `whole` only keeps one version. */
export type ConflictReview = 'fields' | 'whole';

/** The Pages tree's clipboard scope: the tree and the folder table cut, copy and paste through one clipboard, as in the app. */
export const SAMPLE_PAGES_CLIPBOARD = 'sample:pages';

/** Pages and folders to move (the move dialog's subject). */
export interface PagesMoveRequest {
  readonly rows: readonly SampleEntry[];
}

/**
 * The review states of the Pages area that M35.18 built beyond the signed-off sample (gate round 12). They come from the URL
 * (`fstate`, `access`, `pdialog`, `conflict`, `istatus`, `etemplates`), are read once and are not written back.
 */
@Injectable()
export class SamplePagesReview {
  private readonly route = inject(ActivatedRoute);
  private readonly state = inject(SampleState);
  private readonly toasts = inject(ToastService);
  private readonly dialogs = inject(DialogService);
  private readonly injector = inject(Injector);
  private readonly clipboard = inject(TreeClipboardService);
  private readonly params = this.route.snapshot.queryParamMap;

  /** The folder table's state. */
  readonly folder = signal<FolderReviewState>(oneOf(this.params.get('fstate'), FOLDER_REVIEW_STATES) ?? 'normal');
  /** The template view's state (`tstate`). */
  readonly template = signal<TemplateReviewState>(oneOf(this.params.get('tstate'), TEMPLATE_REVIEW_STATES) ?? 'normal');
  /** An archived project: the whole area is read-only (`access=archived`). Time travel is read-only too. */
  readonly archived = signal(this.params.get('access') === 'archived');
  /** Time travel or an archived project. */
  readonly readOnly = computed(() => this.archived() || this.state.travel() !== null);

  /** The Move dialog, while it is open. */
  readonly move = signal<PagesMoveRequest | null>(this.initialMove());
  /** The page delete dialog (`pdialog=delete`). */
  readonly deletePage = signal(this.params.get('pdialog') === 'delete');
  /** The revision conflict drawer (`conflict=fields|whole`). */
  readonly conflict = signal<ConflictReview | null>(oneOf(this.params.get('conflict'), ['fields', 'whole'] as const));

  /** The Issues drawer's status line. */
  readonly issuesStatus = signal<IssuesReviewStatus>(
    oneOf(this.params.get('istatus'), ['checking', 'unavailable'] as const) ?? 'checked',
  );
  /** The preview shows the published page, the checks the draft. */
  readonly issuesPublished = signal(this.params.get('istatus') === 'published');

  /** The project has page templates: the empty state offers *Create a page* (`etemplates=1`). */
  readonly hasTemplates = signal(this.params.get('etemplates') === '1');

  /** `pdialog=move`: the two pages of the scripted selection; `pdialog=folder-move`: the News folder. */
  private initialMove(): PagesMoveRequest | null {
    const dialog = this.params.get('pdialog');
    const ids = dialog === 'move' ? FIXED_SELECTION : dialog === 'folder-move' ? [FIXED_FOLDER] : [];
    const rows = ids.map((id) => entryById(id)).filter((entry): entry is SampleEntry => entry !== null);
    return rows.length > 0 ? { rows } : null;
  }

  openMove(rows: readonly SampleEntry[]): void {
    this.move.set({ rows });
  }

  // ── What the Pages menus do (announce only: nothing is saved) ─────────────────────────────────────────────────

  /** Whether something in `entries` (a folder: anything inside it) has changes in some language that a release would publish. */
  private hasPending(entries: readonly SampleEntry[]): boolean {
    return entries.some(
      (entry) =>
        SAMPLE_LANGS.some((lang) => entry.status[lang] === 'changed' || entry.status[lang] === 'draft') || this.hasPending(entry.children ?? []),
    );
  }

  /** *Release*: with changes waiting the shared release dialog (M35.23) would open; with nothing waiting it says so. */
  release(entries: readonly SampleEntry[]): void {
    if (this.hasPending(entries)) {
      this.state.notice();
    } else {
      this.toasts.show(this.state.t('folder.bulk.nothingToRelease'), 'info');
    }
  }

  /** The *Rename* dialog of a page or folder (name, and in developer mode the UID); what it returns is only announced. */
  async rename(entry: SampleEntry): Promise<void> {
    const result = await this.dialogs.open<SampleContentRenameResult, SampleContentRenameData>(
      SampleContentRenameDialogComponent,
      { name: entry.name, uid: entry.uid, developer: this.state.devMode() },
      { injector: this.injector },
    ).result;
    if (result?.name) {
      this.state.notice('contentRename.renamed', { name: result.name });
    } else if (result?.uid) {
      this.toasts.undo(this.state.t('contentRename.uidChanged', { uid: result.uid }), () => this.state.notice('contentRename.uidRestored'));
    }
  }

  private node(entry: SampleEntry): SfTreeNode<SampleEntry> {
    return { id: entry.id, label: entry.name, icon: entry.kind === 'folder' ? 'folder' : 'description', droppable: entry.kind === 'folder', data: entry };
  }

  cut(entries: readonly SampleEntry[]): void {
    this.clipboard.cutNodes(SAMPLE_PAGES_CLIPBOARD, entries.map((entry) => this.node(entry)));
  }

  copy(entries: readonly SampleEntry[]): void {
    this.clipboard.copyNodes(SAMPLE_PAGES_CLIPBOARD, entries.map((entry) => this.node(entry)));
  }

  private clipped(): { mode: 'cut' | 'copy'; entries: SampleEntry[] } | null {
    const clip = this.clipboard.nodes();
    if (!clip || clip.scope !== SAMPLE_PAGES_CLIPBOARD) {
      return null;
    }
    const entries = clip.nodes.flatMap((node) => ((node.data as SampleEntry | undefined) ? [node.data as SampleEntry] : []));
    return entries.length > 0 ? { mode: clip.mode, entries } : null;
  }

  /** Whether the clipboard can be pasted into the folder `target` (`null` = the root): only pages are copied; a move must change the folder and cannot go into itself. */
  canPaste(target: string | null): boolean {
    const clip = this.clipped();
    if (!clip) {
      return false;
    }
    const into = pathTo(target);
    return clip.entries.every((entry) =>
      clip.mode === 'copy' ? entry.kind === 'page' : parentOf(entry.id) !== target && !(entry.kind === 'folder' && into.some((e) => e.id === entry.id)),
    );
  }

  /** *Paste*: announces the move or the copy, with an Undo that says so. */
  paste(target: string | null): void {
    const clip = this.clipped();
    if (!clip) {
      return;
    }
    const count = clip.entries.length;
    if (clip.mode === 'copy') {
      this.toasts.undo(this.state.t('folder.bulk.duplicated', { count }), () => this.state.notice('folder.bulk.duplicatedBack'));
      return;
    }
    this.clipboard.clear();
    const name = clip.entries[0].name;
    const folder = entryById(target)?.name ?? this.state.t('rail.pages');
    this.toasts.undo(this.state.t('folder.bulk.moved', { count, name, target: folder }), () => this.state.notice('folder.bulk.movedBack'));
  }
}
