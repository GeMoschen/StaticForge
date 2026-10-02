import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Subject, catchError, debounceTime, map, of, switchMap, tap } from 'rxjs';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import type { PreviewView } from '../../core/api/api.client';
import { SfDrawerComponent } from '../../shared/components/dialog/sf-drawer.component';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfAssetImpactComponent } from '../generation/insight/sf-asset-impact.component';
import { DraftChecksService, type DraftCheckRequest } from './draft-checks.service';
import {
  bySeverity,
  findingTarget,
  hasTarget,
  issueTarget,
  type ContentIssue,
  type DraftCheckView,
  type DraftFindingView,
  type IssueTarget,
} from './page-issues.util';

/** How long the panel waits after a save (or a language switch) before it checks: like the preview's debounce. */
export const CHECK_DEBOUNCE_MS = 400;

/** The channel the page editor edits and previews. */
const CHANNEL = 'html';

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'checked'; result: DraftCheckView; at: Date }
  | { kind: 'error' };

/** The levels the drawer groups by (hints are left to their fields, M33.8). */
export type IssueLevel = 'error' | 'warning' | 'info';
const LEVELS: readonly IssueLevel[] = ['error', 'warning', 'info'];
const LEVEL_ICONS: Readonly<Record<IssueLevel, string>> = { error: 'error', warning: 'warning', info: 'info' };

/** One row of the drawer: a content finding of the page or an output finding of the draft's check. */
interface IssueRow {
  readonly id: string;
  readonly level: IssueLevel;
  readonly kind: 'content' | 'output';
  readonly message: string;
  /** What the rule is called (an output check's name). */
  readonly name: string | null;
  readonly target: IssueTarget;
  /** Where it points, in words ("Hero › Image"); `null` for a finding about the whole page. */
  readonly where: string | null;
  readonly scopes: readonly IssueScope[];
  readonly fix: 'content' | 'template' | 'either' | null;
  /** The check's code (developer mode). */
  readonly code: string | null;
}

interface IssueGroup {
  readonly level: IssueLevel;
  readonly rows: readonly IssueRow[];
}

/**
 * The page editor's Issues drawer (M30.3.2, M35.18): a header drawer, like History, that starts below the top bar. It lists
 * what is wrong with the page — the content findings (completeness, from the page) and the quality checks of its draft
 * (`POST …/preview/pages/{uuid}/checks`) — **grouped by level** (Errors, Warnings, Info), each group heading carrying its
 * count, under a summary of the counts. A row says what is wrong, **where** (*Go to it* scrolls the form there and keeps
 * the drawer open), whether the content or the template can fix it and **when it is checked**; the scope chips ("Checked
 * when: editing / saving / releasing / building") are explained by a legend and double as filters. At the bottom, a
 * collapsed **Pages affected by this change** section.
 *
 * <p>The panel is always mounted: it checks the draft {@link CHECK_DEBOUNCE_MS} after each completed autosave
 * ({@link refreshKey}), on a language switch and on time travel (a newer request cancels the one in flight), and reports
 * what the Issues button shows through {@link summaryChange}. A failed check shows "Checks unavailable" and never blocks
 * editing; read-only states (time travel, archived, viewer) still list everything.
 */
@Component({
  selector: 'sf-page-issues-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfAssetImpactComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfDrawerComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    TranslocoPipe,
  ],
  templateUrl: './page-issues-panel.component.html',
  styleUrl: './page-issues-panel.component.scss',
})
export class PageIssuesPanelComponent {
  private readonly checks = inject(DraftChecksService);
  private readonly editingLocale = inject(EditingLocaleStore);
  private readonly transloco = inject(TranslocoService);

  readonly projectKey = input.required<string>();
  readonly pageUuid = input.required<string>();
  /** The revision being viewed while time travelling; `null` checks the current drafts. */
  readonly revision = input<number | null>(null);
  /** Changing it checks the draft again (the page editor passes the revision each autosave returns). */
  readonly refreshKey = input<unknown>(null);
  /** The page's content findings (`PageView.issues`, refreshed with every save and every check). */
  readonly completeness = input<readonly ContentIssue[]>([]);
  /** The view the preview shows: the checks always cover the draft, so the Published view gets a note. */
  readonly previewView = input<PreviewView>('draft');
  /** Whether the drawer is shown; the checks run either way. */
  readonly open = input(false);
  /** Where an issue points, in words ("Hero › Image"); the page editor knows its sections and fields. */
  readonly describe = input<(target: IssueTarget) => string | null>(() => null);
  /** Developer mode: rows show the check's code. */
  readonly devMode = input(false);

  /** An issue that points somewhere was chosen (*Go to it*). */
  readonly issueSelect = output<IssueTarget>();
  /** A check finished: the page editor takes the completeness it returned (fresh after every save). */
  readonly checked = output<DraftCheckView>();
  /** The drawer wants to close (Escape, ×). */
  readonly closed = output<void>();
  /** What the Issues button shows: the issues counted (infos are listed, not counted) and how many are errors. */
  readonly summaryChange = output<{ count: number; errors: number }>();

  protected readonly state = signal<CheckState>({ kind: 'idle' });
  protected readonly impactOpen = signal(false);

  /** The rule scopes the drawer shows (M33): all four unless the user turned some off; remembered per browser. */
  protected readonly scopes = signal<ReadonlySet<IssueScope>>(readScopes());
  protected readonly scopeChips = ISSUE_SCOPES;
  protected readonly levels = LEVELS;
  protected readonly icons = LEVEL_ICONS;

  /** The content findings in a shown scope; hints only show at their field (M33.8). */
  private readonly content = computed<IssueRow[]>(() => {
    const shown = this.scopes();
    return this.completeness()
      .filter((issue) => issue.severity !== 'HINT' && inScopes(issue.scopes, shown))
      .map((issue, index) => {
        const target = issueTarget(issue);
        return {
          id: `content:${index}`,
          level: levelOf(issue.severity),
          kind: 'content' as const,
          message: issue.message ?? '',
          name: null,
          target,
          where: this.where(target),
          scopes: (issue.scopes ?? []) as IssueScope[],
          fix: 'content' as const,
          code: issue.code ?? null,
        };
      });
  });

  /** The draft's output findings — what a build would report: shown with the generation scope. */
  private readonly output = computed<IssueRow[]>(() => {
    const state = this.state();
    if (state.kind !== 'checked' || !this.scopes().has('GENERATION')) {
      return [];
    }
    return (state.result.findings ?? []).map((finding: DraftFindingView, index) => {
      const target = findingTarget(finding);
      return {
        id: `output:${index}`,
        level: levelOf(finding.severity),
        kind: 'output' as const,
        message: finding.message ?? '',
        name: finding.name ?? null,
        target,
        where: this.where(target) ?? finding.selector ?? null,
        scopes: ['GENERATION' as IssueScope],
        fix: fixOf(finding.fixHint),
        code: finding.code ?? null,
      };
    });
  });

  /** Every row, errors first (the server's order within a level). */
  private readonly rows = computed<IssueRow[]>(() =>
    bySeverity([...this.content(), ...this.output()].map((row) => ({ ...row, severity: row.level.toUpperCase() }))),
  );

  protected readonly groups = computed<IssueGroup[]>(() =>
    LEVELS.map((level) => ({ level, rows: this.rows().filter((row) => row.level === level) })).filter((group) => group.rows.length > 0),
  );

  protected readonly skipped = computed<string[]>(() => {
    const state = this.state();
    return state.kind === 'checked' ? (state.result.skippedRules ?? []) : [];
  });

  /** Infos are listed, not counted (M33.8). */
  protected readonly summary = computed(() => {
    const rows = this.rows();
    return { count: rows.filter((row) => row.level !== 'info').length, errors: rows.filter((row) => row.level === 'error').length };
  });

  /** True once there is nothing to report at all: no content finding, and the check came back clean. */
  protected readonly clean = computed(() => this.rows().length === 0 && this.state().kind === 'checked');

  protected readonly status = computed(() => {
    const state = this.state();
    switch (state.kind) {
      case 'checking':
        return this.transloco.translate('pages.issues.checking');
      case 'checked':
        return this.transloco.translate('pages.issues.checkedAt', {
          time: state.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });
      default:
        return '';
    }
  });

  private readonly requests = new Subject<DraftCheckRequest>();

  constructor() {
    this.requests
      .pipe(
        tap(() => this.state.set({ kind: 'checking' })),
        debounceTime(CHECK_DEBOUNCE_MS),
        // A newer save cancels the check still running for an older one: the panel never shows a stale draft.
        switchMap((request) =>
          this.checks.check(request).pipe(
            map((result): CheckState => ({ kind: 'checked', result, at: new Date() })),
            catchError(() => of<CheckState>({ kind: 'error' })),
          ),
        ),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((state) => {
        this.state.set(state);
        if (state.kind === 'checked') {
          this.checked.emit(state.result);
        }
      });

    effect(() => {
      const request: DraftCheckRequest = {
        projectKey: this.projectKey(),
        pageUuid: this.pageUuid(),
        channel: CHANNEL,
        locale: this.editingLocale.locale(),
        revision: this.revision(),
      };
      this.refreshKey();
      if (request.projectKey && request.pageUuid) {
        untracked(() => this.requests.next(request));
      }
    });

    effect(() => {
      const summary = this.summary();
      untracked(() => this.summaryChange.emit(summary));
    });
  }

  /** How many findings of a level there are at the moments that are on. */
  protected count(level: IssueLevel): number {
    return this.rows().filter((row) => row.level === level).length;
  }

  /** Turns a scope chip on or off; at least one stays on. */
  protected toggleScope(scope: IssueScope): void {
    const next = new Set(this.scopes());
    if (next.has(scope)) {
      if (next.size === 1) {
        return;
      }
      next.delete(scope);
    } else {
      next.add(scope);
    }
    this.scopes.set(next);
    writeScopes(next);
  }

  protected isScopeOn(scope: IssueScope): boolean {
    return this.scopes().has(scope);
  }

  /** "saving or releasing": the moments a finding is checked at, in words. */
  protected whenOf(row: IssueRow): string {
    const scopes = row.scopes.length > 0 ? row.scopes : ISSUE_SCOPES.map((chip) => chip.scope);
    return scopes.map((scope) => this.transloco.translate(`pages.issues.when.${scope.toLowerCase()}`)).join(', ');
  }

  /** Checks again now (after "Checks unavailable"). */
  protected retry(): void {
    this.requests.next({
      projectKey: this.projectKey(),
      pageUuid: this.pageUuid(),
      channel: CHANNEL,
      locale: this.editingLocale.locale(),
      revision: this.revision(),
    });
  }

  /** *Go to it*: sends the editor to where the issue points, if anywhere; the drawer stays open. */
  protected jump(row: IssueRow): void {
    if (hasTarget(row.target)) {
      this.issueSelect.emit(row.target);
    }
  }

  protected canJump(row: IssueRow): boolean {
    return hasTarget(row.target);
  }

  private where(target: IssueTarget): string | null {
    return this.describe()(target);
  }
}

function levelOf(severity: string | null | undefined): IssueLevel {
  switch (severity) {
    case 'ERROR':
      return 'error';
    case 'INFO':
    case 'HINT':
      return 'info';
    default:
      return 'warning';
  }
}

function fixOf(hint: string | null | undefined): IssueRow['fix'] {
  switch (hint) {
    case 'CONTENT':
      return 'content';
    case 'TEMPLATE':
      return 'template';
    case 'CONTENT_OR_TEMPLATE':
      return 'either';
    default:
      return null;
  }
}

/** A rule scope the Issues drawer filters by (M33). */
export type IssueScope = 'EDIT' | 'SAVE' | 'RELEASE' | 'GENERATION';

const ISSUE_SCOPES: readonly { scope: IssueScope }[] = [{ scope: 'EDIT' }, { scope: 'SAVE' }, { scope: 'RELEASE' }, { scope: 'GENERATION' }];

const SCOPES_KEY = 'sf-issues-scopes';

/** Whether a finding with `scopes` shows: one of them is on. A finding without scopes applies everywhere. */
export function inScopes(scopes: readonly string[] | null | undefined, shown: ReadonlySet<IssueScope>): boolean {
  if (!scopes || scopes.length === 0) {
    return shown.size > 0;
  }
  return scopes.some((scope) => shown.has(scope as IssueScope));
}

function readScopes(): ReadonlySet<IssueScope> {
  const all = new Set<IssueScope>(ISSUE_SCOPES.map((chip) => chip.scope));
  try {
    const stored = JSON.parse(localStorage.getItem(SCOPES_KEY) ?? 'null');
    if (Array.isArray(stored)) {
      const kept = stored.filter((scope): scope is IssueScope => all.has(scope as IssueScope));
      if (kept.length > 0) {
        return new Set(kept);
      }
    }
  } catch {
    // Unreadable or blocked storage: show every scope.
  }
  return all;
}

function writeScopes(scopes: ReadonlySet<IssueScope>): void {
  try {
    localStorage.setItem(SCOPES_KEY, JSON.stringify([...scopes]));
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}
