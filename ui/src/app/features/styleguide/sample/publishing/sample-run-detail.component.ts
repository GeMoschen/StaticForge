import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { SfDataTableColumn } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfTagComponent } from '../../../../shared/components/display/sf-tag.component';
import { SfComboboxComponent, SfComboboxOption } from '../../../../shared/components/forms/sf-combobox.component';
import { SfSearchInputComponent } from '../../../../shared/components/forms/sf-search-input.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfBannerComponent } from '../../../../shared/components/layout/sf-banner.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SfTab, SfTabsComponent } from '../../../../shared/components/sf-tabs.component';
import { SfTooltipDirective } from '../../../../shared/directives/sf-tooltip.directive';
import { injectSampleQuery, minutesAgo, oneOf } from '../changes/sample-area.util';
import {
  FindingSeverity,
  QUALITY_CATEGORIES,
  QualityCategory,
  RebuiltPage,
  RebuiltRoot,
  RunFinding,
  SampleRun,
  findingCounts,
  heldBackOf,
  isActiveRun,
  outputPathOf,
  pageById,
  promoteTargetOf,
  targetById,
} from './publishing-data';
import { PublishingState } from './publishing-state';
import { RUN_STATUS_ICONS, RUN_STATUS_TONES, formatDuration } from './publishing-status';
import { SampleRunLogComponent } from './sample-run-log.component';

export type RunTab = 'summary' | 'rebuilt' | 'findings' | 'log';
const RUN_TABS: readonly RunTab[] = ['summary', 'rebuilt', 'findings', 'log'];
const SEVERITIES: readonly FindingSeverity[] = ['error', 'warning'];
const ROOT_ICONS: Readonly<Record<RebuiltRoot, string>> = {
  page: 'description',
  template: 'code',
  navigation: 'menu',
  media: 'image',
  settings: 'tune',
};
/** The changes listed in the Rebuilt tab before "+ N more". */
const TOP_CHANGES = 5;

interface RebuiltRow extends RebuiltPage {
  readonly key: string;
  readonly name: string;
  readonly path: string;
}

/** One finding of one page, with what the filters look at. */
interface FindingRow {
  readonly finding: RunFinding;
  readonly pageId: string;
  readonly name: string;
  readonly lang: string;
  readonly message: string;
  readonly carried: boolean;
  readonly outputPath: string;
}

/** A removable chip of the active Findings filters. */
interface FilterChip {
  readonly id: string;
  readonly label: string;
  readonly remove: () => void;
}

/**
 * A run's detail: a summary header (status, counts, duration; Cancel for a queued or running run, Promote for a
 * succeeded or partial one) and `sf-tabs` Summary | Rebuilt | Findings | Log. The queued and running runs open on
 * their Log.
 *
 * - **Summary**: the facts (finished, channels, redirects added, a findings line that links to the Findings tab) and,
 *   for a partial run, the pages it held back because of Error findings.
 * - **Rebuilt**: a plan line, the changes the pages were rebuilt because of (grouped, top groups), the kinds of change
 *   at their root and the pages; or one of three empty states (no plan stored, plan removed by retention, nothing rebuilt).
 * - **Findings**: severity and category facets with counts, a rule select, a language select and an output-path search,
 *   removable chips and *Clear filters*; grouped by code with the pages named and linked, how to fix, a "Carried" chip
 *   for pages checked in an earlier build, and a notice when the run hit the findings limit.
 *
 * Query parameters (read once, when the run named by `run=` opens; written back as the user clicks): `rtab` — the tab,
 * `fsev=error|warning`, `fcat=links|seo|accessibility`, `frule=<code>[,<code>]`, `flang=DE|EN`, `fpath=<prefix>`.
 */
@Component({
  selector: 'sf-sample-run-detail',
  standalone: true,
  imports: [
    SampleRunLogComponent,
    SfBadgeComponent,
    SfBannerComponent,
    SfButtonComponent,
    SfComboboxComponent,
    SfDataTableComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    SfRelativeTimeComponent,
    SfSearchInputComponent,
    SfSegmentedComponent,
    SfSelectComponent,
    SfStatusComponent,
    SfTabsComponent,
    SfTagComponent,
    SfTooltipDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-run-detail.component.html',
  styleUrl: './sample-run-detail.component.scss',
})
export class SampleRunDetailComponent implements OnInit {
  readonly run = input.required<SampleRun>();

  protected readonly state = inject(PublishingState);
  protected readonly t = this.state.t;
  protected readonly tones = RUN_STATUS_TONES;
  protected readonly icons = RUN_STATUS_ICONS;
  protected readonly rootIcons = ROOT_ICONS;
  private readonly query = injectSampleQuery();
  private readonly now = Date.now();

  private readonly picked = signal<RunTab | null>(null);
  /** The chosen tab; else the opener's (Live log, `rtab`); by default Log for a queued or running run, else Summary. */
  protected readonly tab = computed<RunTab>(
    () => this.picked() ?? this.state.runTab() ?? (isActiveRun(this.run()) ? 'log' : 'summary'),
  );

  // Findings filters.
  protected readonly severity = signal<FindingSeverity | null>(null);
  protected readonly category = signal<QualityCategory | null>(null);
  protected readonly rules = signal<string[]>([]);
  protected readonly lang = signal<string | null>(null);
  protected readonly path = signal('');

  protected readonly counts = computed(() => findingCounts(this.run()));
  protected readonly target = computed(() => targetById(this.run().targetId));
  protected readonly promoteTarget = computed(() => promoteTargetOf(this.run()).name);
  protected readonly started = computed(() => minutesAgo(this.run().startedMinutes, this.now));
  protected readonly finished = computed(() => {
    const seconds = this.run().durationSeconds;
    return seconds === null ? null : this.started() + seconds * 1000;
  });
  protected readonly duration = computed(() => {
    const run = this.run();
    if (run.durationSeconds !== null) {
      return formatDuration(run.durationSeconds);
    }
    return this.t(run.status === 'queued' ? 'runs.waiting' : 'runs.inProgress');
  });
  protected readonly channels = computed(() => this.run().channels?.join(', ') ?? this.t('detail.channelsAll'));

  protected readonly tabs = computed<SfTab[]>(() => {
    const counts = this.counts();
    return [
      { id: 'summary', label: this.t('detail.tabs.summary') },
      { id: 'rebuilt', label: this.t('detail.tabs.rebuilt') },
      { id: 'findings', label: this.t('detail.tabs.findings'), errors: counts.errors || undefined },
      { id: 'log', label: this.t('detail.tabs.log') },
    ];
  });

  /** Pages a partial run did not publish because of Error findings. */
  protected readonly heldBack = computed(() =>
    this.run().status === 'partial'
      ? heldBackOf(this.run()).map((h) => ({ ...h, name: pageById(h.pageId)?.name ?? h.pageId }))
      : [],
  );

  // ── Findings ───────────────────────────────────────────────────────────────

  private readonly rows = computed<FindingRow[]>(() =>
    this.run().findings.flatMap((finding) =>
      finding.pages.map((p) => ({
        finding,
        pageId: p.pageId,
        name: pageById(p.pageId)?.name ?? p.pageId,
        lang: p.lang,
        message: p.message,
        carried: !!p.carried,
        outputPath: outputPathOf(p.pageId, p.lang),
      })),
    ),
  );

  /** Whether a finding passes the filters, except the one named (so a facet shows what picking it would give). */
  private passes(row: FindingRow, except?: 'severity' | 'category'): boolean {
    const prefix = this.path().trim().toLowerCase();
    return (
      (except === 'severity' || !this.severity() || row.finding.severity === this.severity()) &&
      (except === 'category' || !this.category() || row.finding.category === this.category()) &&
      (!this.rules().length || this.rules().includes(row.finding.code)) &&
      (!this.lang() || row.lang === this.lang()) &&
      (!prefix || row.outputPath.toLowerCase().startsWith(prefix))
    );
  }

  private readonly shown = computed(() => this.rows().filter((r) => this.passes(r)));

  /** Findings by code, in the run's order, with the pages that pass the filters. */
  protected readonly groups = computed(() => {
    const shown = this.shown();
    return this.run()
      .findings.map((finding) => ({ finding, pages: shown.filter((r) => r.finding === finding) }))
      .filter((g) => g.pages.length);
  });

  protected readonly shownCount = computed(() => this.shown().length);
  protected readonly hasFilter = computed(
    () => !!(this.severity() || this.category() || this.rules().length || this.lang() || this.path().trim()),
  );

  protected readonly severityOptions = computed<SfSegmentedOption<string>[]>(() => {
    const rows = this.rows().filter((r) => this.passes(r, 'severity'));
    return [
      { value: 'all', label: this.t('findings.all', { count: rows.length }) },
      ...SEVERITIES.map((s) => ({
        value: s,
        label: this.t(`findings.severity.${s}`, { count: rows.filter((r) => r.finding.severity === s).length }),
      })),
    ];
  });

  protected readonly categoryOptions = computed<SfSegmentedOption<string>[]>(() => {
    const rows = this.rows().filter((r) => this.passes(r, 'category'));
    return [
      { value: 'all', label: this.t('findings.all', { count: rows.length }) },
      ...QUALITY_CATEGORIES.map((c) => ({
        value: c,
        label: this.t(`findings.category.${c}`, { count: rows.filter((r) => r.finding.category === c).length }),
      })),
    ];
  });

  protected readonly ruleOptions = computed<SfComboboxOption<string>[]>(() =>
    this.run().findings.map((f) => ({ value: f.code, label: f.rule, description: f.code })),
  );

  protected readonly langOptions = computed<SfSelectOption<string>[]>(() => {
    const langs = [...new Set(this.rows().map((r) => r.lang))].sort();
    return langs.map((l) => ({ value: l, label: l }));
  });

  protected readonly chips = computed<FilterChip[]>(() => {
    const chips: FilterChip[] = [];
    const severity = this.severity();
    if (severity) {
      chips.push({ id: 'severity', label: this.t(`findings.chip.severity.${severity}`), remove: () => this.severity.set(null) });
    }
    const category = this.category();
    if (category) {
      chips.push({ id: 'category', label: this.t(`findings.chip.category`, { name: this.t(`quality.categories.${category}`) }), remove: () => this.category.set(null) });
    }
    for (const code of this.rules()) {
      const rule = this.run().findings.find((f) => f.code === code)?.rule ?? code;
      chips.push({ id: `rule-${code}`, label: this.t('findings.chip.rule', { name: rule }), remove: () => this.rules.update((r) => r.filter((c) => c !== code)) });
    }
    if (this.lang()) {
      chips.push({ id: 'lang', label: this.t('findings.chip.lang', { lang: this.lang() }), remove: () => this.lang.set(null) });
    }
    if (this.path().trim()) {
      chips.push({ id: 'path', label: this.t('findings.chip.path', { path: this.path().trim() }), remove: () => this.path.set('') });
    }
    return chips;
  });

  // ── Rebuilt ────────────────────────────────────────────────────────────────

  protected readonly rebuiltRows = computed<RebuiltRow[]>(() =>
    this.run().rebuilt.map((r) => ({
      ...r,
      key: `${r.pageId}-${r.lang}`,
      name: pageById(r.pageId)?.name ?? r.pageId,
      path: outputPathOf(r.pageId, r.lang),
    })),
  );

  /** Which of the Rebuilt tab's four views applies. */
  protected readonly rebuiltView = computed<'pending' | 'none' | 'pruned' | 'nothing' | 'plan'>(() => {
    const run = this.run();
    const state = run.planState ?? 'stored';
    if (state !== 'stored') {
      return state;
    }
    return run.rebuilt.length ? 'plan' : 'nothing';
  });

  /** The changes the pages were rebuilt because of, the biggest first. */
  protected readonly changes = computed(() => {
    const byVia = new Map<string, { via: string; root: RebuiltRoot; count: number }>();
    for (const r of this.run().rebuilt) {
      const group = byVia.get(r.via) ?? { via: r.via, root: r.root, count: 0 };
      group.count++;
      byVia.set(r.via, group);
    }
    return [...byVia.values()].sort((a, b) => b.count - a.count);
  });
  protected readonly topChanges = computed(() => this.changes().slice(0, TOP_CHANGES));
  protected readonly moreChanges = computed(() => Math.max(0, this.changes().length - TOP_CHANGES));

  /** Pages per kind of change at the root. */
  protected readonly roots = computed(() => {
    const kinds = new Map<RebuiltRoot, number>();
    for (const r of this.run().rebuilt) {
      kinds.set(r.root, (kinds.get(r.root) ?? 0) + 1);
    }
    return [...kinds].map(([root, count]) => ({ root, count })).sort((a, b) => b.count - a.count);
  });

  protected readonly rebuiltColumns = computed<SfDataTableColumn<RebuiltRow>[]>(() => {
    const h = (id: string) => this.t(`detail.rebuiltColumns.${id}`);
    const columns: SfDataTableColumn<RebuiltRow>[] = [
      { id: 'name', header: h('page'), value: (r) => r.name, sortable: true, hideable: false, width: 240 },
      { id: 'lang', header: h('lang'), value: (r) => r.lang, sortable: true, width: 100 },
      { id: 'reason', header: h('reason'), value: (r) => r.reason, sortable: true, width: 130 },
      { id: 'via', header: h('via'), value: (r) => r.via, sortable: true, width: 260 },
    ];
    if (this.state.devMode()) {
      columns.push({ id: 'path', header: h('path'), value: (r) => r.path, width: 260 });
    }
    return columns;
  });
  protected readonly rebuiltKey = (row: RebuiltRow) => row.key;

  constructor() {
    const destroyed = inject(DestroyRef);
    effect(() => {
      this.query.set({
        rtab: this.tab(),
        fsev: this.severity(),
        fcat: this.category(),
        frule: this.rules().join(',') || null,
        flang: this.lang(),
        fpath: this.path().trim() || null,
      });
    });
    destroyed.onDestroy(() => this.query.set({ rtab: null, fsev: null, fcat: null, frule: null, flang: null, fpath: null }));
  }

  /** The URL's tab and filters apply to the run it opened with, once. */
  ngOnInit(): void {
    if (this.state.runParamsRead || this.query.get('run') !== this.run().id) {
      return;
    }
    this.state.runParamsRead = true;
    this.picked.set(oneOf(this.query.get('rtab'), RUN_TABS));
    this.severity.set(oneOf(this.query.get('fsev'), SEVERITIES));
    this.category.set(oneOf(this.query.get('fcat'), QUALITY_CATEGORIES));
    const codes = this.run().findings.map((f) => f.code);
    this.rules.set((this.query.get('frule') ?? '').split(',').filter((c) => codes.includes(c)));
    this.lang.set(this.query.get('flang')?.toUpperCase() || null);
    this.path.set(this.query.get('fpath') ?? '');
  }

  protected selectTab(id: string): void {
    this.picked.set(id as RunTab);
  }

  /** "Show findings" in the Summary: the Findings tab, optionally only the errors. */
  protected showFindings(errorsOnly = false): void {
    if (errorsOnly) {
      this.severity.set('error');
    }
    this.picked.set('findings');
  }

  protected setSeverity(value: string | null): void {
    this.severity.set(oneOf(value, SEVERITIES));
  }

  protected setCategory(value: string | null): void {
    this.category.set(oneOf(value, QUALITY_CATEGORIES));
  }

  protected setRules(value: string | string[] | null): void {
    this.rules.set(value === null ? [] : Array.isArray(value) ? value : [value]);
  }

  protected clearFilters(): void {
    this.severity.set(null);
    this.category.set(null);
    this.rules.set([]);
    this.lang.set(null);
    this.path.set('');
  }

  protected openPage(): void {
    this.state.notice('detail.openNotice');
  }
}
