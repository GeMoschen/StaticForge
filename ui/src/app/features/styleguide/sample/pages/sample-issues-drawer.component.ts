import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfDrawerComponent } from '../../../../shared/components/dialog/sf-drawer.component';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { injectSampleText } from '../changes/sample-area.util';
import { SampleState } from '../sample-state';
import { SamplePagesReview } from './sample-pages-review';
import {
  AFFECTED,
  AFFECTED_FILES,
  ISSUES,
  ISSUE_LEVELS,
  ISSUE_LEVEL_ICONS,
  ISSUE_SCOPES,
  IssueLevel,
  IssueScopeKey,
  SKIPPED_RULES,
  SampleIssue,
} from './pages-data';

/** The clock time of the last check, as the status line shows it. */
const CHECKED_AT = '12:04';

/** One group of the drawer: a level, its heading with the count, and its rows. */
interface IssueGroup {
  readonly level: IssueLevel;
  readonly issues: readonly SampleIssue[];
}

/**
 * The Issues drawer (M35.18 review round 8): a header drawer, like History, that starts below the top bar. It lists what
 * is wrong with the open page — content rules and output checks — **grouped by level** (Errors, Warnings, Info, Hints), each
 * group heading carrying its count, under a summary of the counts. A row says what is wrong, **where** (the section and
 * field; *Jump to it* scrolls the editor there and keeps the drawer open), whether the content or the template can fix it,
 * and **when it is checked** — the scope chips ("Checked when: editing / saving / releasing / building") are explained by
 * a legend and double as filters. Nothing to report is a clear empty state. At the bottom, a collapsed section
 * **"Pages affected by this change"** (formerly "Impact as of now") says which other pages and URLs a change rebuilds.
 */
@Component({
  selector: 'sf-sample-issues-drawer',
  standalone: true,
  imports: [SfBadgeComponent, SfButtonComponent, SfDrawerComponent, SfEmptyStateComponent, SfIconComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-issues-drawer.component.scss',
  template: `
    <sf-drawer [title]="t('issues.title')" [width]="460" (closed)="closed.emit()">
      @if (review.issuesPublished()) {
        <p class="issues__note">{{ t('issues.publishedNote') }}</p>
      }
      <p class="issues__status" role="status">
        {{ statusText() }}
        @if (review.issuesStatus() === 'unavailable') {
          <sf-button variant="ghost" size="sm" (click)="review.issuesStatus.set('checked')">{{ t('issues.retry') }}</sf-button>
        }
      </p>

      @if (review.issuesStatus() !== 'checked') {
        <!-- Nothing to list while the draft is being checked or the check failed. -->
      } @else if (empty()) {
        <sf-empty-state icon="task_alt" [title]="t('issues.empty.title')" [description]="t('issues.empty.description')" [level]="3" />
      } @else {
        <p class="issues__summary" role="status">
          @for (level of levels; track level) {
            @if (count(level) > 0) {
              <span class="issues__count is-{{ level }}">
                <sf-icon [name]="icons[level]" />
                {{ t('issues.summary.' + level, { count: count(level) }) }}
              </span>
            }
          }
        </p>

        <div class="issues__filter">
          <p class="issues__filter-label" id="issues-scope-label">{{ t('issues.scope.label') }}</p>
          <div class="issues__chips" role="group" aria-labelledby="issues-scope-label">
            @for (scope of scopes; track scope) {
              <button
                type="button"
                class="issues__chip"
                [class.is-on]="shown().has(scope)"
                [attr.aria-pressed]="shown().has(scope)"
                (click)="toggle(scope)"
              >
                {{ t('issues.scope.' + scope) }}
              </button>
            }
          </div>
          <p class="issues__legend">{{ t('issues.scope.legend') }}</p>
        </div>

        @for (group of groups(); track group.level) {
          <section class="issues__group" [attr.aria-labelledby]="'issues-group-' + group.level">
            <h3 class="issues__group-heading" [id]="'issues-group-' + group.level">
              <sf-icon class="is-{{ group.level }}" [name]="icons[group.level]" />
              {{ t('issues.levels.' + group.level) }}
              <sf-badge [tone]="group.level === 'error' ? 'danger' : group.level === 'warning' ? 'warning' : 'neutral'" [label]="'' + group.issues.length" />
            </h3>
            <ul class="issues__list">
              @for (issue of group.issues; track issue.id) {
                <li>
                  <button type="button" class="issues__row" (click)="jump(issue)">
                    <span class="issues__message">
                      <span class="sf-sr-only">{{ t('issues.levels.' + issue.level) }}: </span>{{ t('issues.items.' + issue.id + '.message') }}
                    </span>
                    <span class="issues__where">
                      <sf-icon name="my_location" />
                      {{ where(issue) }}
                      <span class="issues__jump">{{ t('issues.jump') }}</span>
                    </span>
                    <span class="issues__meta">
                      <span>{{ t('issues.kind.' + issue.kind) }}</span>
                      <span aria-hidden="true">·</span>
                      <span>{{ t('issues.checkedWhen', { when: whenOf(issue) }) }}</span>
                      @if (issue.fix) {
                        <span aria-hidden="true">·</span>
                        <span>{{ t('issues.fix.' + issue.fix) }}</span>
                      }
                      @if (issue.code && state.devMode()) {
                        <code class="issues__code">{{ issue.code }}</code>
                      }
                    </span>
                  </button>
                </li>
              }
            </ul>
          </section>
        } @empty {
          <p class="issues__none">{{ t('issues.noneShown') }}</p>
        }
        <p class="issues__skipped">{{ t('issues.skipped', { rules: skipped }) }}</p>
      }

      <section class="issues__impact" aria-labelledby="issues-impact-heading">
        <h3 class="issues__impact-heading" id="issues-impact-heading">
          <button type="button" class="issues__impact-toggle" [attr.aria-expanded]="impactOpen()" (click)="impactOpen.set(!impactOpen())">
            <sf-icon [name]="impactOpen() ? 'expand_more' : 'chevron_right'" />
            {{ t('issues.impact.title') }}
            <sf-badge tone="neutral" [label]="'' + affected.length" />
          </button>
        </h3>
        @if (impactOpen()) {
          <p class="issues__impact-headline">{{ t('issues.impact.headline', { pages: affected.length, files: files }) }}</p>
          <ul class="issues__affected">
            @for (page of affected; track page.url) {
              <li class="issues__affected-row">
                <span class="issues__affected-name">{{ page.name }}</span>
                <code class="issues__affected-url">{{ page.url }}</code>
                <span class="issues__affected-reason">{{ t('issues.impact.reasons.' + page.reason) }}</span>
              </li>
            }
          </ul>
        }
      </section>
    </sf-drawer>
  `,
})
export class SampleIssuesDrawerComponent {
  protected readonly state = inject(SampleState);
  protected readonly review = inject(SamplePagesReview);
  protected readonly t = injectSampleText('styleguide.sample.pages');
  readonly closed = output<void>();

  protected readonly levels = ISSUE_LEVELS;
  protected readonly scopes = ISSUE_SCOPES;
  protected readonly icons = ISSUE_LEVEL_ICONS;
  protected readonly affected = AFFECTED;
  protected readonly files = AFFECTED_FILES;

  /** The scopes whose findings show; the chips toggle them (all four to begin with). */
  protected readonly shown = signal<ReadonlySet<IssueScopeKey>>(new Set(ISSUE_SCOPES));
  protected readonly impactOpen = signal(false);

  protected readonly empty = computed(() => this.state.issuesReview() === 'empty');
  protected readonly skipped = SKIPPED_RULES.join(', ');
  /** The status line under the title: when the draft was last checked, that it is being checked, or that the check failed. */
  protected readonly statusText = computed(() => {
    const status = this.review.issuesStatus();
    return status === 'checking'
      ? this.t('issues.checking')
      : status === 'unavailable'
        ? this.t('issues.unavailable')
        : this.t('issues.checkedAt', { time: CHECKED_AT });
  });

  private readonly visible = computed(() => ISSUES.filter((issue) => issue.scopes.some((scope) => this.shown().has(scope))));
  protected readonly groups = computed<IssueGroup[]>(() =>
    ISSUE_LEVELS.map((level) => ({ level, issues: this.visible().filter((issue) => issue.level === level) })).filter((group) => group.issues.length > 0),
  );

  /** How many findings of a level there are in all (the summary does not follow the filter). */
  protected count(level: IssueLevel): number {
    return ISSUES.filter((issue) => issue.level === level).length;
  }

  protected toggle(scope: IssueScopeKey): void {
    this.shown.update((set) => {
      const next = new Set(set);
      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }
      return next;
    });
  }

  /** "Hero › Image", "Page fields › Meta description", "Product teasers". */
  protected where(issue: SampleIssue): string {
    const target = this.t(`issues.targets.${issue.target}`);
    return issue.field ? `${target} › ${this.t(`issues.fields.${issue.field}`)}` : target;
  }

  /** "saving or releasing": the scopes of a finding in words. */
  protected whenOf(issue: SampleIssue): string {
    return issue.scopes.map((scope) => this.t(`issues.when.${scope}`)).join(', ');
  }

  protected jump(issue: SampleIssue): void {
    this.state.jumpTo(issue.target, issue.field);
  }
}
