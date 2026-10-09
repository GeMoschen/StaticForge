import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import { DeveloperModeService } from '../../../../core/frame/developer-mode.service';
import { EditingLocaleStore } from '../../../../core/project/editing-locale.store';
import { LocalesStore } from '../../../../core/project/locales.store';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfTagComponent } from '../../../../shared/components/display/sf-tag.component';
import { SfComboboxComponent, SfComboboxOption } from '../../../../shared/components/forms/sf-combobox.component';
import { SfSearchInputComponent } from '../../../../shared/components/forms/sf-search-input.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfBannerComponent } from '../../../../shared/components/layout/sf-banner.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SfTooltipDirective } from '../../../../shared/directives/sf-tooltip.directive';
import { GenerationService, type FindingFacetsView } from '../../../generation/generation.service';
import { GenerationRunView, isActiveRun } from '../runs.util';
import {
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  NO_RUN_FINDINGS_FILTER,
  filterFromParams,
  isFiltered,
  paramsFromFilter,
  type FindingView,
  type QualityRuleItem,
  type RunFindingsFilter,
} from './run-findings.util';

/** Typing in the path box settles for this long before the URL (and the list) follow. */
const PATH_DELAY_MS = 250;

/** One rule's findings: the findings in the order the server sends them (by output path). */
interface FindingGroup {
  readonly code: string;
  readonly name: string;
  readonly severity: 'error' | 'warning';
  readonly fix: string | null;
  /** How many findings the rule has under the filter (all of them, not only the ones loaded). */
  readonly count: number;
  readonly findings: readonly FindingView[];
}

/** A removable chip of an active filter. */
interface FilterChip {
  readonly id: string;
  readonly label: string;
  readonly remove: Partial<RunFindingsFilter>;
}

/**
 * A run's Findings tab (gate decision 193): severity and category segments with counts from the facets endpoint, a rule
 * select, a language select and an output-path box, removable chips and *Clear filters*; the findings grouped by rule
 * with the pages named and linked, how to fix, a "Carried" chip for pages checked in an earlier build, and a notice when
 * the run hit the findings limit. The filter lives in the URL (`fsev`, `fcat`, `frule`, `flang`, `fpath`). The server
 * sends the findings in pages of 200 by output path; the rest is read with *Show more*.
 */
@Component({
  selector: 'sf-run-findings',
  standalone: true,
  imports: [
    RouterLink,
    SfBadgeComponent,
    SfBannerComponent,
    SfButtonComponent,
    SfComboboxComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    SfSearchInputComponent,
    SfSegmentedComponent,
    SfSelectComponent,
    SfTagComponent,
    SfTooltipDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './run-findings.component.html',
  styleUrl: './run-findings.component.scss',
})
export class RunFindingsComponent {
  readonly projectKey = input.required<string>();
  readonly run = input.required<GenerationRunView>();

  private readonly api = inject(GenerationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  private readonly localesStore = inject(LocalesStore);
  private readonly editingLocale = inject(EditingLocaleStore);
  protected readonly developerMode = inject(DeveloperModeService).enabled;

  private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  protected readonly filter = computed(() => filterFromParams(this.query()));
  protected readonly filtered = computed(() => isFiltered(this.filter()));
  /** The path box shows what is typed; the URL follows after a pause. */
  protected readonly pathText = signal(this.filter().path);

  private readonly runId = computed(() => this.run().id ?? 0);
  protected readonly active = computed(() => isActiveRun(this.run()));
  /** The run's checks ran: its findings counts exist. */
  protected readonly checked = computed(() => this.run().findingCounts != null);
  protected readonly truncated = computed(() => this.run().findingCounts?.truncated ?? 0);

  protected readonly items = signal<readonly FindingView[]>([]);
  /** Findings under the filter, all pages. */
  protected readonly total = signal(0);
  protected readonly facets = signal<FindingFacetsView | null>(null);
  protected readonly rules = signal<readonly QualityRuleItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  private page = 0;

  /** The first page of findings arrived. */
  protected readonly loaded = signal(false);
  /** The run has no findings at all (nothing is filtered away). */
  protected readonly empty = computed(() => !this.filtered() && this.loaded() && !this.loading() && !this.failed() && this.total() === 0);

  protected readonly ruleValue = computed(() => [...this.filter().rules]);
  private readonly ruleInfo = computed(() => new Map(this.rules().map((rule) => [rule.code ?? '', rule] as const)));

  protected readonly groups = computed<FindingGroup[]>(() => {
    const byCode = new Map<string, FindingView[]>();
    for (const finding of this.items()) {
      const code = finding.code ?? '';
      byCode.set(code, [...(byCode.get(code) ?? []), finding]);
    }
    const counts = new Map((this.facets()?.code ?? []).map((facet) => [facet.code ?? '', facet] as const));
    return [...byCode]
      .map(([code, findings]) => {
        const rule = this.ruleInfo().get(code);
        return {
          code,
          name: rule?.name ?? counts.get(code)?.name ?? code,
          severity: findings[0]?.severity === 'ERROR' ? ('error' as const) : ('warning' as const),
          fix: rule?.fixHint ?? null,
          count: Math.max(counts.get(code)?.count ?? 0, findings.length),
          findings,
        };
      })
      .sort((a, b) => Number(b.severity === 'error') - Number(a.severity === 'error') || a.code.localeCompare(b.code));
  });

  protected readonly hasMore = computed(() => this.items().length < this.total());

  protected readonly severityOptions = computed<SfSegmentedOption<string>[]>(() => {
    const facets = this.facets();
    return [
      { value: 'all', label: this.t('all', { count: facets?.total ?? 0 }) },
      ...FINDING_SEVERITIES.map((severity) => ({
        value: severity,
        label: this.t(`severity.${severity}`, { count: facets?.severity?.[severity.toUpperCase()] ?? 0 }),
      })),
    ];
  });

  protected readonly categoryOptions = computed<SfSegmentedOption<string>[]>(() => {
    const facets = this.facets();
    return [
      { value: 'all', label: this.t('all', { count: facets?.total ?? 0 }) },
      ...FINDING_CATEGORIES.map((category) => ({
        value: category,
        label: this.t(`category.${category}`, { count: facets?.category?.[category.toUpperCase()] ?? 0 }),
      })),
    ];
  });

  protected readonly ruleOptions = computed<SfComboboxOption<string>[]>(() =>
    (this.facets()?.code ?? []).map((facet) => ({
      value: facet.code ?? '',
      label: this.ruleInfo().get(facet.code ?? '')?.name ?? facet.name ?? facet.code ?? '',
      description: facet.code ?? '',
    })),
  );

  protected readonly langOptions = computed<SfSelectOption<string>[]>(() => {
    const langs = new Set(Object.keys(this.facets()?.locale ?? {}));
    const picked = this.filter().lang;
    if (picked) {
      langs.add(picked);
    }
    return [...langs].sort().map((lang) => ({ value: lang, label: lang.toUpperCase() }));
  });

  protected readonly chips = computed<FilterChip[]>(() => {
    const filter = this.filter();
    const chips: FilterChip[] = [];
    if (filter.severity) {
      chips.push({ id: 'severity', label: this.t(`chip.severity.${filter.severity}`), remove: { severity: null } });
    }
    if (filter.category) {
      chips.push({ id: 'category', label: this.t('chip.category', { name: this.t(`categoryName.${filter.category}`) }), remove: { category: null } });
    }
    for (const code of filter.rules) {
      const name = this.ruleInfo().get(code)?.name ?? code;
      chips.push({ id: `rule-${code}`, label: this.t('chip.rule', { name }), remove: { rules: filter.rules.filter((c) => c !== code) } });
    }
    if (filter.lang) {
      chips.push({ id: 'lang', label: this.t('chip.lang', { lang: filter.lang.toUpperCase() }), remove: { lang: null } });
    }
    if (filter.path.trim()) {
      chips.push({ id: 'path', label: this.t('chip.path', { path: filter.path.trim() }), remove: { path: '' } });
    }
    return chips;
  });

  private pageRequest: Subscription | null = null;
  private facetRequest: Subscription | null = null;
  private pathTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const key = this.projectKey();
      const id = this.runId();
      const filter = this.filter();
      // A run that finishes while its findings are open reads them then; one that never checked has none.
      const waiting = this.active() || !this.checked();
      untracked(() => (waiting ? this.reset() : this.load(key, id, filter)));
    });
    effect(() => {
      const key = this.projectKey();
      untracked(() =>
        this.api.qualityRules(key).subscribe({
          next: (rules) => this.rules.set(rules),
          // Without the rule list the findings show the names the facets carry, and no fix hints.
          error: () => this.rules.set([]),
        }),
      );
    });
    effect(() => {
      const path = this.filter().path;
      untracked(() => (this.pathTimer === null ? this.pathText.set(path) : undefined));
    });
    inject(DestroyRef).onDestroy(() => {
      this.pageRequest?.unsubscribe();
      this.facetRequest?.unsubscribe();
      if (this.pathTimer) {
        clearTimeout(this.pathTimer);
      }
    });
  }

  private reset(): void {
    this.loaded.set(false);
    this.items.set([]);
    this.total.set(0);
    this.facets.set(null);
  }

  private load(key: string, id: number, filter: RunFindingsFilter): void {
    this.pageRequest?.unsubscribe();
    this.facetRequest?.unsubscribe();
    this.page = 0;
    this.failed.set(false);
    this.loading.set(true);
    this.pageRequest = this.api.findings(key, id, filter).subscribe({
      next: (result) => {
        this.items.set(result.content ?? []);
        this.total.set(result.page?.totalElements ?? 0);
        this.loading.set(false);
        this.loaded.set(true);
      },
      error: () => {
        this.loading.set(false);
        this.failed.set(true);
      },
    });
    this.facetRequest = this.api.findingFacets(key, id, filter).subscribe({
      next: (facets) => this.facets.set(facets),
      // The counts are a convenience: the findings still show.
      error: () => this.facets.set(null),
    });
  }

  protected showMore(): void {
    this.pageRequest?.unsubscribe();
    this.loading.set(true);
    this.pageRequest = this.api.findings(this.projectKey(), this.runId(), this.filter(), this.page + 1).subscribe({
      next: (result) => {
        this.page++;
        this.items.update((items) => [...items, ...(result.content ?? [])]);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.failed.set(true);
      },
    });
  }

  protected retry(): void {
    this.load(this.projectKey(), this.runId(), this.filter());
  }

  protected setSeverity(value: string | null): void {
    this.apply({ severity: FINDING_SEVERITIES.find((s) => s === value) ?? null });
  }

  protected setCategory(value: string | null): void {
    this.apply({ category: FINDING_CATEGORIES.find((c) => c === value) ?? null });
  }

  protected setRules(value: string | string[] | null): void {
    this.apply({ rules: value === null ? [] : Array.isArray(value) ? value : [value] });
  }

  protected setLang(value: string | null): void {
    this.apply({ lang: value });
  }

  protected setPath(value: string): void {
    this.pathText.set(value);
    if (this.pathTimer) {
      clearTimeout(this.pathTimer);
    }
    this.pathTimer = setTimeout(() => {
      this.pathTimer = null;
      this.apply({ path: value });
    }, PATH_DELAY_MS);
  }

  protected clearFilters(): void {
    this.apply(NO_RUN_FINDINGS_FILTER);
  }

  protected remove(chip: FilterChip): void {
    this.apply(chip.remove);
  }

  /** The page editor works in the finding's language when it opens (the editing language, M24). */
  protected openPage(finding: FindingView): void {
    if (finding.locale && this.localesStore.locales().some((locale) => locale.code === finding.locale)) {
      this.editingLocale.set(this.projectKey(), finding.locale);
    }
  }

  protected rowKey(finding: FindingView): string {
    return String(finding.id ?? `${finding.outputPath}|${finding.code}|${finding.selector}`);
  }

  protected severityCount(group: FindingGroup): string {
    return this.t(group.severity === 'error' ? 'errorCount' : 'warningCount', { count: group.count });
  }

  private apply(change: Partial<RunFindingsFilter>): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: paramsFromFilter({ ...this.filter(), ...change }),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`publishing.findings.${key}`, params);
  }

  protected tr(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`publishing.${key}`, params);
  }
}
