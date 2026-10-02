import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Subject, catchError, debounceTime, map, of, switchMap } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import type { SfDataTableColumn } from '../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { SfAvatarComponent } from '../../shared/components/display/sf-avatar.component';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../shared/components/display/sf-relative-time.component';
import { SfComboboxComponent, SfComboboxOption } from '../../shared/components/forms/sf-combobox.component';
import { SfDateInputComponent } from '../../shared/components/forms/sf-date-input.component';
import { SfSelectComponent, SfSelectOption } from '../../shared/components/forms/sf-select.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfTooltipDirective } from '../../shared/directives/sf-tooltip.directive';
import {
  AUDIT_PAGE_SIZE,
  AuditFilterState,
  INSTANCE_ONLY,
  KNOWN_AUDIT_ACTIONS,
  auditApiQuery,
  auditFilterFromParams,
  auditRangeInvalid,
  humanizeAuditAction,
  paramsFromAuditFilter,
  summarizeAuditDetail,
} from './admin-audit.util';

type AdminAuditEntry = components['schemas']['AdminAuditEntry'];
type AdminProjectRow = components['schemas']['AdminProjectRow'];
type AdminUserRow = components['schemas']['AdminUserRow'];

export const ACTOR_SEARCH_DEBOUNCE_MS = 300;

/**
 * Administration → Audit (M26, epic decision 14; M35.16, gate decisions 69 and 71): every audit entry of the instance,
 * newest first and paged on the server. The filter bar is a multi-select combobox for the actions (human labels), a
 * user combobox you can type into, a project select and an inline From / To date range (either may stay empty); the
 * controls are as tall as the search fields elsewhere. The filters (actions, user, project or "instance only", day
 * range) and the page live in the URL query. The table shows when (relative, the exact time in its tooltip), who,
 * what, the target, the project and a short summary of the detail.
 */
@Component({
  selector: 'sf-admin-audit',
  standalone: true,
  imports: [
    SfAvatarComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfComboboxComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfDateInputComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    SfSelectComponent,
    SfTooltipDirective,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-audit.component.html',
  styleUrl: './admin-audit.component.scss',
})
export class AdminAuditComponent {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  private readonly table = viewChild(SfDataTableComponent<AdminAuditEntry>);
  /** Re-reads the labels when the language file arrives or changes. */
  private readonly translation = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly pageSize = AUDIT_PAGE_SIZE;

  protected readonly filter = toSignal(this.route.queryParams.pipe(map(auditFilterFromParams)), {
    initialValue: auditFilterFromParams(this.route.snapshot.queryParams),
  });

  protected readonly entries = signal<AdminAuditEntry[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly actionCodes = signal<string[]>([]);
  protected readonly projects = signal<AdminProjectRow[]>([]);

  // ── user filter ──
  protected readonly userHits = signal<AdminUserRow[]>([]);
  protected readonly userSearching = signal(false);
  /** The name shown for the user filter; read from the account when the URL brought only its id. */
  protected readonly userLabel = signal<string | null>(null);
  private readonly userSearches = new Subject<string>();

  protected readonly filtered = computed(() => {
    const f = this.filter();
    return f.actions.length > 0 || f.userId !== null || f.project !== null || f.from !== null || f.to !== null;
  });
  protected readonly rangeInvalid = computed(() => auditRangeInvalid(this.filter()));

  protected readonly actionOptions = computed<SfComboboxOption<string>[]>(() => {
    this.translation();
    // The known actions always, plus whatever else the log holds.
    const codes = [...new Set([...this.actionCodes(), ...this.filter().actions])];
    return codes.map((value) => ({ value, label: this.actionLabel(value) })).sort((a, b) => a.label.localeCompare(b.label));
  });

  protected readonly userOptions = computed<SfComboboxOption<number>[]>(() => {
    const options = this.userHits().map((u) => ({
      value: u.id as number,
      label: u.displayName || (u.username as string),
      description: `@${u.username}`,
    }));
    const chosen = this.filter().userId;
    if (chosen !== null && !options.some((o) => o.value === chosen)) {
      options.unshift({ value: chosen, label: this.userLabel() ?? `#${chosen}`, description: '' });
    }
    return options;
  });

  protected readonly projectOptions = computed<SfSelectOption<string>[]>(() => {
    this.translation();
    return [
      { value: '', label: this.transloco.translate('admin.audit.allProjects') },
      { value: INSTANCE_ONLY, label: this.transloco.translate('admin.audit.instanceOnly') },
      ...this.projects().map((p) => ({ value: p.key as string, label: `${p.name} (${p.key})` })),
    ];
  });

  protected readonly columns = computed<SfDataTableColumn<AdminAuditEntry>[]>(() => {
    this.translation();
    const header = (id: string) => this.transloco.translate(`admin.audit.columns.${id}`);
    return [
      { id: 'time', header: header('time'), value: (e) => e.timestamp ?? '', hideable: false, width: 150 },
      { id: 'user', header: header('user'), value: (e) => this.userName(e), width: 190 },
      { id: 'action', header: header('action'), value: (e) => this.actionLabel(e.action), width: 220 },
      { id: 'target', header: header('target'), value: (e) => e.target ?? '', width: 200 },
      { id: 'project', header: header('project'), value: (e) => e.projectKey ?? '', width: 160 },
      { id: 'details', header: header('details'), value: (e) => summarizeAuditDetail(e.detail), width: 280 },
    ];
  });
  protected readonly rowKey = (entry: AdminAuditEntry) => String(entry.id);
  protected readonly rowLabel = (entry: AdminAuditEntry) => `${this.actionLabel(entry.action)} · ${entry.target ?? ''}`;

  protected readonly error = computed(() => {
    this.translation();
    return this.failed() ? this.transloco.translate('admin.audit.error') : null;
  });

  constructor() {
    this.api.adminAuditActions().subscribe({ next: (a) => this.actionCodes.set([...new Set([...KNOWN_AUDIT_ACTIONS, ...a])]), error: () => this.actionCodes.set([...KNOWN_AUDIT_ACTIONS]) });
    this.api
      .adminListProjects({ includeArchived: true })
      .subscribe({ next: (p) => this.projects.set(p), error: () => undefined });

    this.userSearches
      .pipe(
        debounceTime(ACTOR_SEARCH_DEBOUNCE_MS),
        switchMap((q) => {
          if (q.trim() === '') {
            this.userSearching.set(false);
            return of([] as AdminUserRow[]);
          }
          this.userSearching.set(true);
          return this.api.adminListUsers({ q: q.trim(), includeDeleted: true, size: 8 }).pipe(
            map((page) => page.content ?? []),
            catchError(() => of([] as AdminUserRow[])),
          );
        }),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((hits) => {
        this.userSearching.set(false);
        this.userHits.set(hits);
      });

    effect(() => {
      const state = this.filter();
      untracked(() => this.load(state));
    });

    // The table owns its pager: bring it to the page the URL names once the total is known (a reload, back/forward).
    effect(() => {
      const page = this.filter().page;
      this.total();
      untracked(() => setTimeout(() => this.table()?.goToPage(page)));
    });
  }

  protected setActions(value: string | string[] | null): void {
    this.apply({ actions: Array.isArray(value) ? value : value ? [value] : [] });
  }

  protected setUser(value: number | number[] | null): void {
    const id = Array.isArray(value) ? (value[0] ?? null) : value;
    const hit = this.userHits().find((u) => u.id === id);
    this.userLabel.set(hit ? hit.displayName || (hit.username ?? null) : id === null ? null : this.userLabel());
    this.apply({ userId: id });
  }

  protected setProject(value: string | null): void {
    this.apply({ project: value ? value : null });
  }

  protected setFrom(value: string | null): void {
    this.apply({ from: value || null });
  }

  protected setTo(value: string | null): void {
    this.apply({ to: value || null });
  }

  protected onUserQuery(value: string): void {
    this.userSearching.set(value.trim() !== '');
    this.userSearches.next(value);
  }

  protected clearFilters(): void {
    this.userLabel.set(null);
    this.userHits.set([]);
    void this.router.navigate([], { relativeTo: this.route, queryParams: {} });
  }

  protected retry(): void {
    this.load(this.filter());
  }

  /** The table's pager moved: the URL follows (the URL's own page change comes back here as no change). */
  protected onPage(page: number): void {
    if (page !== this.filter().page) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: paramsFromAuditFilter({ ...this.filter(), page }) });
    }
  }

  protected actionLabel(code: string | null | undefined): string {
    this.translation();
    if (!code) {
      return '';
    }
    return KNOWN_AUDIT_ACTIONS.includes(code) ? this.transloco.translate(`admin.audit.actions.${code}`) : humanizeAuditAction(code);
  }

  protected userName(entry: AdminAuditEntry): string {
    return entry.actor ? (entry.actor.username ?? `#${entry.actor.id}`) : this.transloco.translate('admin.audit.system');
  }

  protected projectName(key: string | null | undefined): string | null {
    return key ? (this.projects().find((p) => p.key === key)?.name ?? key) : null;
  }

  protected summary(entry: AdminAuditEntry): string {
    return summarizeAuditDetail(entry.detail);
  }

  protected detailJson(entry: AdminAuditEntry): string {
    return entry.detail == null ? '' : JSON.stringify(entry.detail, null, 2);
  }

  /** A filter change starts again at the first page. */
  private apply(change: Partial<AuditFilterState>): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: paramsFromAuditFilter({ ...this.filter(), ...change, page: 0 }),
    });
    this.table()?.goToPage(0);
  }

  private load(state: AuditFilterState): void {
    this.failed.set(false);
    if (auditRangeInvalid(state)) {
      // An end before the start matches nothing; the message under the range says so.
      this.entries.set([]);
      this.total.set(0);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.api.adminAudit(auditApiQuery(state)).subscribe({
      next: (page) => {
        this.entries.set(page.content ?? []);
        this.total.set(page.page?.totalElements ?? 0);
        this.loading.set(false);
      },
      error: () => {
        this.entries.set([]);
        this.total.set(0);
        this.failed.set(true);
        this.loading.set(false);
      },
    });
    if (state.userId !== null && this.userLabel() === null) {
      this.api.adminGetUser(state.userId).subscribe({
        next: (user) =>
          this.userLabel.set(user.status === 'DELETED' ? this.transloco.translate('admin.audit.deletedUser') : (user.displayName || user.username || null)),
        error: () => this.userLabel.set(`#${state.userId}`),
      });
    }
  }
}
