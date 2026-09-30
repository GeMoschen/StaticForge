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
import { Subject, catchError, debounceTime, map, of, switchMap, tap } from 'rxjs';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import type { PreviewView } from '../../core/api/api.client';
import { DraftChecksService, type DraftCheckRequest } from './draft-checks.service';
import {
  bySeverity,
  checkedAtLabel,
  errorCount,
  findingTarget,
  fixHintLabel,
  hasTarget,
  issueTarget,
  severityLabel,
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

/**
 * The page editor's Issues panel (M30.3.2, epic decision 13): the page's content findings (completeness, from the page)
 * and the quality checks of its draft (`POST …/preview/pages/{uuid}/checks`), grouped as *Content* and *Output*.
 *
 * <p>The draft is checked again {@link CHECK_DEBOUNCE_MS} after each completed autosave ({@link refreshKey}), on a
 * language switch and on time travel; a newer request cancels the one in flight. A failed check shows "Checks
 * unavailable" and never blocks editing. Clicking an issue expands it and, when it points somewhere, asks the editor to
 * go there ({@link issueSelect}); read-only states (time travel, archived, viewer) still list everything.
 */
@Component({
  selector: 'sf-page-issues-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './page-issues-panel.component.html',
  styleUrl: './page-issues-panel.component.scss',
})
export class PageIssuesPanelComponent {
  private readonly checks = inject(DraftChecksService);
  private readonly editingLocale = inject(EditingLocaleStore);
  private static nextId = 0;

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

  /** An issue that points somewhere was clicked. */
  readonly issueSelect = output<IssueTarget>();
  /** A check finished: the page editor takes the completeness it returned (fresh after every save). */
  readonly checked = output<DraftCheckView>();

  protected readonly headingId = `sf-page-issues-${PageIssuesPanelComponent.nextId++}`;
  protected readonly open = signal(true);
  protected readonly state = signal<CheckState>({ kind: 'idle' });
  /** The expanded issue, by `content:<index>` or `output:<index>`. */
  protected readonly expanded = signal<string | null>(null);

  /** The rule scopes the panel shows (M33): all four unless the user turned some off; remembered per browser. */
  protected readonly scopes = signal<ReadonlySet<IssueScope>>(readScopes());
  protected readonly scopeChips = ISSUE_SCOPES;

  /** The content findings in a shown scope, most severe first; hints only show at their field (M33.8). */
  protected readonly content = computed(() => {
    const shown = this.scopes();
    return bySeverity(
      this.completeness().filter((issue) => issue.severity !== 'HINT' && inScopes(issue.scopes, shown)),
    );
  });
  /** The draft's output findings — what a build would report: shown with the generation scope. */
  protected readonly findings = computed<DraftFindingView[]>(() => {
    const state = this.state();
    return state.kind === 'checked' && this.scopes().has('GENERATION') ? bySeverity(state.result.findings ?? []) : [];
  });

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
  protected readonly skipped = computed<string[]>(() => {
    const state = this.state();
    return state.kind === 'checked' ? (state.result.skippedRules ?? []) : [];
  });
  /** Infos are listed, not counted (M33.8). */
  protected readonly count = computed(
    () => this.content().filter((issue) => issue.severity !== 'INFO').length + this.findings().length,
  );
  protected readonly errors = computed(() => errorCount(this.content()) + errorCount(this.findings()));
  protected readonly status = computed(() => {
    const state = this.state();
    switch (state.kind) {
      case 'checking':
        return 'Checking…';
      case 'checked':
        return checkedAtLabel(state.at);
      case 'error':
        return 'Checks unavailable';
      default:
        return '';
    }
  });

  protected readonly fixHint = fixHintLabel;
  protected readonly severity = severityLabel;

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
  }

  protected toggle(): void {
    this.open.update((open) => !open);
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

  protected isExpanded(key: string): boolean {
    return this.expanded() === key;
  }

  protected selectContent(issue: ContentIssue, index: number): void {
    this.activate(`content:${index}`, issueTarget(issue));
  }

  protected selectFinding(finding: DraftFindingView, index: number): void {
    this.activate(`output:${index}`, findingTarget(finding));
  }

  /** Expands the issue (or collapses it again) and sends the editor to where it points, if anywhere. */
  private activate(key: string, target: IssueTarget): void {
    this.expanded.update((current) => (current === key ? null : key));
    if (hasTarget(target)) {
      this.issueSelect.emit(target);
    }
  }
}

/** A rule scope the Issues panel filters by (M33). */
export type IssueScope = 'EDIT' | 'SAVE' | 'RELEASE' | 'GENERATION';

const ISSUE_SCOPES: readonly { scope: IssueScope; label: string }[] = [
  { scope: 'EDIT', label: 'Edit' },
  { scope: 'SAVE', label: 'Save' },
  { scope: 'RELEASE', label: 'Release' },
  { scope: 'GENERATION', label: 'Generation' },
];

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
