import { Injectable, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { oneOf } from '../changes/sample-area.util';
import { FIXED_FOLDER, FIXED_SELECTION, SampleEntry, entryById } from '../sample-data';
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
}
