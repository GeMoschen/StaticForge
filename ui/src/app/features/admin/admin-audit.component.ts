import { DatePipe, JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, catchError, debounceTime, map, of, switchMap } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import {
  AuditFilterState,
  INSTANCE_ONLY,
  auditApiQuery,
  auditFilterFromParams,
  paramsFromAuditFilter,
} from './admin-audit.util';

type AdminAuditEntry = components['schemas']['AdminAuditEntry'];
type AdminProjectRow = components['schemas']['AdminProjectRow'];
type AdminUserRow = components['schemas']['AdminUserRow'];
type PageMeta = components['schemas']['PageMeta'];

export const ACTOR_SEARCH_DEBOUNCE_MS = 300;

/**
 * Administration → Audit (M26, epic decision 14): every audit entry of the instance, newest first and paged on the
 * server. The filters (actions, actor, project or "instance only", day range) live in the URL query.
 */
@Component({
  selector: 'sf-admin-audit',
  standalone: true,
  imports: [DatePipe, JsonPipe, SfButtonComponent, SfSpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-audit.component.html',
  styleUrl: './admin-audit.component.scss',
})
export class AdminAuditComponent {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly instanceOnly = INSTANCE_ONLY;

  protected readonly filter = toSignal(this.route.queryParams.pipe(map(auditFilterFromParams)), {
    initialValue: auditFilterFromParams(this.route.snapshot.queryParams),
  });

  protected readonly entries = signal<AdminAuditEntry[]>([]);
  protected readonly meta = signal<PageMeta | null>(null);
  protected readonly loading = signal(true);
  protected readonly actions = signal<string[]>([]);
  protected readonly projects = signal<AdminProjectRow[]>([]);
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());

  // ── actor filter ──
  protected readonly actorQuery = signal('');
  protected readonly actorHits = signal<AdminUserRow[]>([]);
  /** The name shown for the actor filter; read from the account when the URL brought only its id. */
  protected readonly actorLabel = signal<string | null>(null);
  private readonly actorSearches = new Subject<string>();

  protected readonly hasFilters = computed(() => {
    const f = this.filter();
    return f.actions.length > 0 || f.userId !== null || f.project !== null || f.from !== null || f.to !== null;
  });

  constructor() {
    this.api.adminAuditActions().subscribe({ next: (a) => this.actions.set(a), error: () => undefined });
    this.api
      .adminListProjects({ includeArchived: true })
      .subscribe({ next: (p) => this.projects.set(p), error: () => undefined });

    this.actorSearches
      .pipe(
        debounceTime(ACTOR_SEARCH_DEBOUNCE_MS),
        switchMap((q) =>
          q.trim() === ''
            ? of([] as AdminUserRow[])
            : this.api.adminListUsers({ q: q.trim(), includeDeleted: true, size: 8 }).pipe(
                map((page) => page.content ?? []),
                catchError(() => of([] as AdminUserRow[])),
              ),
        ),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((hits) => this.actorHits.set(hits));

    effect(() => {
      const state = this.filter();
      untracked(() => this.load(state));
    });
  }

  protected setActions(select: HTMLSelectElement): void {
    const actions = Array.from(select.selectedOptions).map((o) => o.value);
    this.apply({ actions });
  }

  protected removeAction(action: string): void {
    this.apply({ actions: this.filter().actions.filter((a) => a !== action) });
  }

  protected setProject(value: string): void {
    this.apply({ project: value === '' ? null : value });
  }

  protected setFrom(value: string): void {
    this.apply({ from: value || null });
  }

  protected setTo(value: string): void {
    this.apply({ to: value || null });
  }

  protected onActorQuery(value: string): void {
    this.actorQuery.set(value);
    this.actorSearches.next(value);
  }

  protected pickActor(user: AdminUserRow): void {
    this.actorLabel.set(user.username ?? null);
    this.actorQuery.set('');
    this.actorHits.set([]);
    this.apply({ userId: user.id ?? null });
  }

  protected clearActor(): void {
    this.actorLabel.set(null);
    this.apply({ userId: null });
  }

  protected clearFilters(): void {
    this.actorLabel.set(null);
    void this.router.navigate([], { relativeTo: this.route, queryParams: {} });
  }

  protected goTo(page: number): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: paramsFromAuditFilter({ ...this.filter(), page }),
    });
  }

  protected toggle(id: number | undefined): void {
    if (id == null) {
      return;
    }
    const next = new Set(this.expanded());
    if (!next.delete(id)) {
      next.add(id);
    }
    this.expanded.set(next);
  }

  protected projectLabel(key: string | null | undefined): string {
    if (!key) {
      return 'Instance';
    }
    return this.projects().find((p) => p.key === key)?.name ?? key;
  }

  /** A filter change starts again at the first page. */
  private apply(change: Partial<AuditFilterState>): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: paramsFromAuditFilter({ ...this.filter(), ...change, page: 0 }),
    });
  }

  private load(state: AuditFilterState): void {
    this.loading.set(true);
    this.api.adminAudit(auditApiQuery(state)).subscribe({
      next: (page) => {
        this.entries.set(page.content ?? []);
        this.meta.set(page.page ?? null);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    if (state.userId !== null && this.actorLabel() === null) {
      this.api.adminGetUser(state.userId).subscribe({
        next: (user) => this.actorLabel.set(user.status === 'DELETED' ? 'Deleted user' : (user.username ?? null)),
        error: () => this.actorLabel.set(`User #${state.userId}`),
      });
    }
  }
}
