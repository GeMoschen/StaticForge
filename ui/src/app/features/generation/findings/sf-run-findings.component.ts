import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, distinctUntilChanged, map } from 'rxjs';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { EditingLocaleStore } from '../../../core/project/editing-locale.store';
import { LocalesStore } from '../../../core/project/locales.store';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { GenerationService } from '../generation.service';
import {
  FINDINGS_PAGE_SIZE,
  FINDING_CATEGORIES,
  NO_FINDING_FILTER,
  categoryCount,
  categoryLabel,
  findingFilterFromParams,
  hasFindingFilters,
  paramsFromFindingFilter,
  severityCountLabel,
  type FindingCategory,
  type FindingFilter,
  type FindingPageView,
  type FindingSeverity,
  type FindingView,
  type QualityRuleItem,
} from './findings.util';

type GenerationRunView = components['schemas']['GenerationRunView'];

const PATH_FILTER_DELAY_MS = 250;

/** One chosen filter as a removable chip. */
interface ChosenFilter {
  key: string;
  label: string;
  clear: Partial<FindingFilter>;
}

/**
 * A run's quality check findings (M30.6.2, epic decision 10): the counts by severity and category as filter chips,
 * filters for rule, channel, language and output path, and a paged table that links each finding to its page in the
 * page editor. The filters live in the URL query (`fSeverity`, `fCode`, …), so a findings view can be shared; every
 * chosen filter shows as a removable chip.
 */
@Component({
  selector: 'sf-run-findings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SfButtonComponent],
  templateUrl: './sf-run-findings.component.html',
  styleUrl: './sf-run-findings.component.scss',
})
export class SfRunFindingsComponent {
  readonly projectKey = input.required<string>();
  readonly run = input.required<GenerationRunView>();

  private readonly api = inject(GenerationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly localesStore = inject(LocalesStore);
  private readonly editingLocale = inject(EditingLocaleStore);

  protected readonly categories = FINDING_CATEGORIES;
  protected readonly categoryLabel = categoryLabel;
  protected readonly severityLabel = severityCountLabel;

  /** The filters in the URL; a navigation that leaves them as they are (`run`, `tab`) doesn't reload. */
  protected readonly filter = toSignal(
    this.route.queryParams.pipe(
      map(findingFilterFromParams),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    ),
    {
      initialValue: findingFilterFromParams(this.route.snapshot.queryParams),
    },
  );

  /** The run's id alone, so a refreshed run object doesn't reload the table. */
  private readonly runId = computed(() => this.run().id ?? 0);
  protected readonly counts = computed(() => this.run().findingCounts ?? null);
  protected readonly result = signal<FindingPageView | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly rules = signal<QualityRuleItem[]>([]);
  protected readonly totalPages = computed(() => Math.max(1, this.result()?.page?.totalPages ?? 1));

  /** The channels the run built: what the channel filter offers. */
  protected readonly channels = computed(() => {
    const run = this.run();
    return run.planSummary?.channels ?? run.channels ?? [];
  });
  protected readonly locales = computed(() =>
    this.localesStore.locales().map((locale) => ({ code: locale.code ?? '', label: locale.label ?? locale.code ?? '' })),
  );

  /** The rules the rule filter offers: every rule not chosen yet, in code order. */
  protected readonly ruleOptions = computed(() => {
    const chosen = new Set(this.filter().codes);
    return this.rules().filter((rule) => rule.code && !chosen.has(rule.code));
  });

  private readonly ruleNames = computed(
    () => new Map(this.rules().map((rule) => [rule.code ?? '', rule.name ?? ''] as const)),
  );

  /**
   * The name of the page the asset filter names: read from the findings on screen (all of them are on that page once
   * it applies), else a short uuid.
   */
  private readonly assetName = computed(() => {
    const asset = this.filter().asset;
    if (!asset) {
      return null;
    }
    const page = (this.result()?.content ?? []).find((f) => f.page?.uuid === asset)?.page;
    return page ? (page.displayName ?? page.uid ?? asset) : asset.slice(0, 8);
  });

  protected readonly chosen = computed<ChosenFilter[]>(() => {
    const f = this.filter();
    const chips: ChosenFilter[] = [];
    if (f.severity) {
      chips.push({ key: 'severity', label: f.severity === 'ERROR' ? 'Errors' : 'Warnings', clear: { severity: null } });
    }
    if (f.category) {
      chips.push({ key: 'category', label: categoryLabel(f.category), clear: { category: null } });
    }
    for (const code of f.codes) {
      const name = this.ruleNames().get(code);
      chips.push({
        key: `code:${code}`,
        label: name ? `${code} ${name}` : code,
        clear: { codes: f.codes.filter((c) => c !== code) },
      });
    }
    if (f.asset) {
      chips.push({ key: 'asset', label: `Page: ${this.assetName()}`, clear: { asset: null } });
    }
    if (f.channel) {
      chips.push({ key: 'channel', label: `Channel: ${f.channel}`, clear: { channel: null } });
    }
    if (f.locale) {
      chips.push({ key: 'locale', label: `Language: ${this.localesStore.labelOf(f.locale)}`, clear: { locale: null } });
    }
    if (f.path) {
      chips.push({ key: 'path', label: `Path: ${f.path}*`, clear: { path: null } });
    }
    return chips;
  });

  protected readonly hasFilters = computed(() => hasFindingFilters(this.filter()));

  private request: Subscription | null = null;
  private pathTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const projectKey = this.projectKey();
      const runId = this.runId();
      const filter = this.filter();
      untracked(() => this.load(projectKey, runId, filter));
    });
    effect(() => {
      const projectKey = this.projectKey();
      untracked(() =>
        this.api.qualityRules(projectKey).subscribe({
          next: (rules) => this.rules.set(rules),
          // Without the rule list findings show their codes only, and the rule filter offers nothing.
          error: () => this.rules.set([]),
        }),
      );
    });
    inject(DestroyRef).onDestroy(() => {
      this.request?.unsubscribe();
      if (this.pathTimer) {
        clearTimeout(this.pathTimer);
      }
    });
  }

  protected ruleName(code: string | undefined): string {
    return this.ruleNames().get(code ?? '') ?? '';
  }

  protected rowKey(finding: FindingView): string {
    return String(finding.id ?? `${finding.outputPath}|${finding.code}|${finding.selector}`);
  }

  protected toggleSeverity(severity: FindingSeverity): void {
    this.apply({ severity: this.filter().severity === severity ? null : severity });
  }

  protected toggleCategory(category: FindingCategory): void {
    this.apply({ category: this.filter().category === category ? null : category });
  }

  protected categoryCount(category: FindingCategory): number {
    return categoryCount(this.counts(), category);
  }

  protected addCode(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const code = select.value;
    select.value = '';
    if (code && !this.filter().codes.includes(code)) {
      this.apply({ codes: [...this.filter().codes, code] });
    }
  }

  protected setChannel(event: Event): void {
    this.apply({ channel: (event.target as HTMLSelectElement).value || null });
  }

  protected setLocale(event: Event): void {
    this.apply({ locale: (event.target as HTMLSelectElement).value || null });
  }

  protected setPath(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (this.pathTimer) {
      clearTimeout(this.pathTimer);
    }
    this.pathTimer = setTimeout(() => {
      this.pathTimer = null;
      this.apply({ path: value.trim() === '' ? null : value });
    }, PATH_FILTER_DELAY_MS);
  }

  protected clearFilter(chip: ChosenFilter): void {
    this.apply(chip.clear);
  }

  protected clearFilters(): void {
    this.apply(NO_FINDING_FILTER);
  }

  protected goTo(page: number): void {
    this.navigate({ ...this.filter(), page: Math.max(0, page) });
  }

  /** The page editor works in the finding's language when it opens (M24 editing language). */
  protected openPage(finding: FindingView): void {
    if (finding.locale && this.localesStore.locales().some((locale) => locale.code === finding.locale)) {
      this.editingLocale.set(this.projectKey(), finding.locale);
    }
  }

  /** A filter change starts again at the first page. */
  private apply(change: Partial<FindingFilter>): void {
    this.navigate({ ...this.filter(), ...change, page: 0 });
  }

  private navigate(filter: FindingFilter): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: paramsFromFindingFilter(filter),
      queryParamsHandling: 'merge',
    });
  }

  private load(projectKey: string, runId: number, filter: FindingFilter): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.request = this.api.findings(projectKey, runId, filter, FINDINGS_PAGE_SIZE).subscribe({
      next: (page) => {
        this.result.set(page);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Could not load the findings — try again in a moment.');
      },
    });
  }
}
