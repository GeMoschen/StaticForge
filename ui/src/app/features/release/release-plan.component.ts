import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { assetRoute } from '../../shared/asset-route.util';
import { assetName, itemKey, toItem } from './release-choice.util';
import { localeTag, statusLabel } from './release-status.util';

type Item = components['schemas']['Item'];
type ReleasePlanView = components['schemas']['ReleasePlanView'];
type Dependency = components['schemas']['Dependency'];
type Incomplete = components['schemas']['Incomplete'];
type ReleaseTargetView = components['schemas']['ReleaseTargetView'];

const PLAN_DEBOUNCE_MS = 250;

/** The groups of the dependency list, in display order (epic decision 9). */
const REASONS: readonly { reason: string; label: string }[] = [
  { reason: 'REFERENCE', label: 'Referenced by the selection' },
  { reason: 'CONTAINER', label: 'Folders and sets it sits in' },
  { reason: 'SET_MEMBER', label: 'Records of the selected sets' },
  { reason: 'DESCENDANT', label: 'Descendants of a changed folder' },
];

/** What the dialog around the plan needs to decide its button. */
export interface ReleasePlanState {
  /** A plan for the current items is shown (not loading, not failed, not stale). */
  ready: boolean;
  /** The ticked dependencies, as request items. */
  includeDependencies: Item[];
  /**
   * Incomplete items or ticked dependencies: releasing them is refused (`SF-DOM-0150`) — or rule warnings the user
   * hasn't confirmed (`SF-DOM-0156`, M33.8).
   */
  blocked: boolean;
  /** The user confirmed releasing with rule warnings (sent as `acceptWarnings`). */
  acceptWarnings: boolean;
}

interface DependencyRow {
  key: string;
  dependency: Dependency;
  name: string;
  via: string | null;
}

/**
 * The dependency-aware dry run of a release (M27.6.1, epic decisions 9, 10) — shared by the release dialog and the
 * schedule dialog: re-plans (debounced) whenever the selection changes, lists the unreleased dependencies grouped by
 * reason with the server's default tick (the user can untick any), and the completeness findings that block.
 */
@Component({
  selector: 'sf-release-plan',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SfSpinnerComponent],
  templateUrl: './release-plan.component.html',
  styleUrl: './release-plan.component.scss',
})
export class ReleasePlanComponent implements OnDestroy {
  private readonly api = inject(ApiClient);

  readonly projectKey = input.required<string>();
  readonly items = input.required<Item[]>();
  /**
   * Whether rule warnings need the "Release with warnings" confirmation (the release dialog). A scheduled release
   * always accepts them and records them with its run (M33.6), so the schedule dialog only shows them.
   */
  readonly confirmWarnings = input(true);

  readonly stateChange = output<ReleasePlanState>();
  /** An incomplete asset's "Open" link was followed: the dialog closes. */
  readonly navigated = output<void>();

  protected readonly plan = signal<ReleasePlanView | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The items key the shown plan was computed for. */
  private readonly planKey = signal<string | null>(null);
  /** The user's ticks and unticks, by dependency key; untouched dependencies follow the server's default. */
  private readonly overrides = signal<ReadonlyMap<string, boolean>>(new Map());

  private readonly itemsKey = computed(() =>
    this.items()
      .map((item) => itemKey(item.assetUuid, item.locale))
      .sort()
      .join(','),
  );

  private timer: ReturnType<typeof setTimeout> | null = null;
  private request: Subscription | null = null;

  /** Every target the plan names, by uuid — for names of `via` and incomplete assets. */
  private readonly targets = computed(() => {
    const byUuid = new Map<string, ReleaseTargetView>();
    const plan = this.plan();
    for (const target of [...(plan?.items ?? []), ...(plan?.dependencies ?? []).map((d) => d.target ?? {})]) {
      if (target.uuid && !byUuid.has(target.uuid)) {
        byUuid.set(target.uuid, target);
      }
    }
    return byUuid;
  });

  protected readonly groups = computed(() => {
    const dependencies = this.plan()?.dependencies ?? [];
    const targets = this.targets();
    return REASONS.map(({ reason, label }) => ({
      reason,
      label,
      rows: dependencies
        .filter((dependency) => dependency.reason === reason)
        .map<DependencyRow>((dependency) => ({
          key: itemKey(dependency.target?.uuid, dependency.target?.locale),
          dependency,
          name: assetName(dependency.target),
          via: dependency.via ? assetName(targets.get(dependency.via) ?? { uuid: dependency.via }) : null,
        })),
    })).filter((group) => group.rows.length > 0);
  });

  protected readonly warnings = computed(() => this.plan()?.warnings ?? []);

  protected readonly dependencyCount = computed(() => this.plan()?.dependencies?.length ?? 0);

  private readonly tickedKeys = computed(() => {
    const overrides = this.overrides();
    const keys = new Set<string>();
    for (const dependency of this.plan()?.dependencies ?? []) {
      const key = itemKey(dependency.target?.uuid, dependency.target?.locale);
      if (overrides.get(key) ?? dependency.includedByDefault ?? true) {
        keys.add(key);
      }
    }
    return keys;
  });

  protected readonly incomplete = computed(() => {
    const targets = this.targets();
    const selected = new Set(this.items().map((item) => item.assetUuid));
    const ticked = this.tickedKeys();
    return (this.plan()?.incomplete ?? []).map((entry: Incomplete) => {
      const target = entry.uuid ? targets.get(entry.uuid) : undefined;
      const blocking =
        selected.has(entry.uuid) || ticked.has(itemKey(entry.uuid, entry.locale)) || ticked.has(itemKey(entry.uuid, ''));
      return {
        entry,
        blocking,
        name: assetName(target ?? { uuid: entry.uuid }),
        route: assetRoute(this.projectKey(), { uuid: entry.uuid, type: target?.type }),
      };
    });
  });

  /** The user's "Release with warnings" tick (M33.8). */
  protected readonly accepted = signal(false);

  /** Rule findings of one level for the selection, with names and "Open" links (M33.8). */
  private findingRows(entries: readonly Incomplete[]) {
    const targets = this.targets();
    return entries.map((entry) => {
      const target = entry.uuid ? targets.get(entry.uuid) : undefined;
      return {
        entry,
        name: assetName(target ?? { uuid: entry.uuid }),
        route: assetRoute(this.projectKey(), { uuid: entry.uuid, type: target?.type }),
      };
    });
  }

  protected readonly ruleWarnings = computed(() => this.findingRows(this.plan()?.warningFindings ?? []));
  protected readonly ruleInfos = computed(() => this.findingRows(this.plan()?.infoFindings ?? []));
  /** The values the release fills would write, per asset. */
  protected readonly fills = computed(() => {
    const targets = this.targets();
    return (this.plan()?.fills ?? []).map((fill) => ({
      fill,
      name: assetName(targets.get(fill.uuid ?? '') ?? { uuid: fill.uuid }),
      value: typeof fill.value === 'string' ? fill.value : JSON.stringify(fill.value ?? null),
    }));
  });
  /** How many warnings wait for confirmation. */
  protected readonly warningCount = computed(() =>
    this.ruleWarnings().reduce((sum, row) => sum + (row.entry.issues?.length ?? 0), 0),
  );

  protected onAccept(event: Event): void {
    this.accepted.set((event.target as HTMLInputElement).checked);
  }

  protected readonly state = computed<ReleasePlanState>(() => {
    const plan = this.plan();
    const ready = plan !== null && !this.loading() && this.error() === null && this.planKey() === this.itemsKey();
    const ticked = this.tickedKeys();
    return {
      ready,
      includeDependencies: (plan?.dependencies ?? [])
        .filter((dependency) => ticked.has(itemKey(dependency.target?.uuid, dependency.target?.locale)))
        .map((dependency) => toItem(dependency.target?.uuid, dependency.target?.locale)),
      blocked:
        this.incomplete().some((row) => row.blocking) ||
        (this.confirmWarnings() && this.warningCount() > 0 && !this.accepted()),
      acceptWarnings: this.accepted() || !this.confirmWarnings(),
    };
  });

  protected readonly localeTag = localeTag;
  protected readonly statusLabel = statusLabel;

  constructor() {
    effect(() => {
      const key = this.itemsKey();
      const projectKey = this.projectKey();
      untracked(() => this.schedule(projectKey, key));
    });
    effect(() => this.stateChange.emit(this.state()));
  }

  ngOnDestroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.request?.unsubscribe();
  }

  protected isTicked(row: DependencyRow): boolean {
    return this.tickedKeys().has(row.key);
  }

  protected toggle(row: DependencyRow, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.overrides.update((current) => new Map(current).set(row.key, checked));
  }

  /** Re-plans now (e.g. after a refused release showed that something changed). */
  refresh(): void {
    this.schedule(this.projectKey(), this.itemsKey(), 0);
  }

  private schedule(projectKey: string, key: string, delay = PLAN_DEBOUNCE_MS): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.request?.unsubscribe();
    if (!key) {
      this.plan.set(null);
      this.planKey.set(null);
      this.loading.set(false);
      this.error.set(null);
      return;
    }
    this.loading.set(true);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.request = this.api.releasePlan(projectKey, { items: this.items() }).subscribe({
        next: (plan) => {
          if (key !== this.planKey()) {
            // Another selection: its warnings need their own confirmation.
            this.accepted.set(false);
          }
          this.plan.set(plan);
          this.planKey.set(key);
          this.loading.set(false);
          this.error.set(null);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(problemOf(err, 'Could not compute what the release takes along.').detail);
        },
      });
    }, delay);
  }
}
