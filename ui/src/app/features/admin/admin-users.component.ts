import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { AdminCreateUserDialogComponent } from './admin-create-user-dialog.component';
import { USER_STATUSES, statusChipClass, statusLabel } from './admin-user.util';

type AdminUserRow = components['schemas']['AdminUserRow'];
type AdminUserDetail = components['schemas']['AdminUserDetail'];
type PageMeta = components['schemas']['PageMeta'];

export const USER_SEARCH_DEBOUNCE_MS = 300;
export const USER_PAGE_SIZE = 25;

/** Administration → Users (M26): every account, paged and filtered on the server. */
@Component({
  selector: 'sf-admin-users',
  standalone: true,
  imports: [DatePipe, RouterLink, SfButtonComponent, SfSpinnerComponent, AdminCreateUserDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-users.component.html',
  styleUrl: './admin-users.component.scss',
})
export class AdminUsersComponent {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);

  protected readonly statuses = USER_STATUSES;
  protected readonly statusLabel = statusLabel;
  protected readonly statusChipClass = statusChipClass;

  protected readonly q = signal('');
  protected readonly status = signal('');
  protected readonly systemRole = signal('');
  protected readonly includeDeleted = signal(false);
  protected readonly page = signal(0);

  protected readonly rows = signal<AdminUserRow[]>([]);
  protected readonly meta = signal<PageMeta | null>(null);
  protected readonly loading = signal(true);
  protected readonly creating = signal(false);

  private readonly searches = new Subject<string>();

  constructor() {
    this.searches
      .pipe(debounceTime(USER_SEARCH_DEBOUNCE_MS), takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((q) => {
        this.q.set(q);
        this.page.set(0);
        this.load();
      });
    this.load();
  }

  protected onSearch(value: string): void {
    this.searches.next(value.trim());
  }

  protected setStatus(value: string): void {
    this.status.set(value);
    this.page.set(0);
    this.load();
  }

  protected setRole(value: string): void {
    this.systemRole.set(value);
    this.page.set(0);
    this.load();
  }

  protected setIncludeDeleted(value: boolean): void {
    this.includeDeleted.set(value);
    this.page.set(0);
    this.load();
  }

  protected goTo(page: number): void {
    this.page.set(page);
    this.load();
  }

  protected open(row: AdminUserRow): void {
    if (row.id != null) {
      void this.router.navigate(['/admin/users', row.id]);
    }
  }

  /** The dialog already showed a generated password, if any: open the new account. */
  protected created(user: AdminUserDetail): void {
    this.creating.set(false);
    this.load();
    if (user.id != null) {
      void this.router.navigate(['/admin/users', user.id]);
    }
  }

  private load(): void {
    this.loading.set(true);
    this.api
      .adminListUsers({
        q: this.q() || undefined,
        status: this.status() || undefined,
        systemRole: this.systemRole() || undefined,
        includeDeleted: this.includeDeleted() || undefined,
        page: this.page(),
        size: USER_PAGE_SIZE,
        sort: 'username',
      })
      .subscribe({
        next: (result) => {
          this.rows.set(result.content ?? []);
          this.meta.set(result.page ?? null);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }
}
