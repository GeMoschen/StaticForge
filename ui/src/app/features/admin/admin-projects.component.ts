import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { ApiClient } from '../../core/api/api.client';
import { problemOf } from '../../core/api/problem.util';
import { AuthStore } from '../../core/auth/auth.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfDataTableColumn } from '../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { SfTableIdentityComponent } from '../../shared/components/data-table/sf-table-identity.component';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../shared/components/display/sf-status.component';
import { SfSearchInputComponent } from '../../shared/components/forms/sf-search-input.component';
import { SfSwitchComponent } from '../../shared/components/forms/sf-switch.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfMenuComponent } from '../../shared/components/menu/sf-menu.component';
import { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { AdminProjectDialogComponent } from './admin-project-dialog.component';
import {
  AdminProjectRow,
  NO_PROJECT_FILTERS,
  ProjectFilters,
  filterProjects,
  projectFiltersActive,
  projectFiltersFromQuery,
  projectFiltersToQuery,
} from './admin-projects.util';

/**
 * Administration → Projects (M26, M35.16): every project of the instance as an `sf-data-table` — name and key, description,
 * members, the last change (relative time and revision) and the status — with a search and a *Show archived* switch kept
 * in the URL (`?q=coffee&archived=1`). *New project* is the primary button; a row's ⋮ menu edits the project (name and
 * description), opens it, archives it (a confirmation, then Undo) or unarchives it (secondary: no confirmation). Archived
 * projects are muted and say so in words. A row opens the project.
 */
@Component({
  selector: 'sf-admin-projects',
  standalone: true,
  imports: [
    AdminProjectDialogComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfMenuComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    SfSearchInputComponent,
    SfStatusComponent,
    SfSwitchComponent,
    SfTableIdentityComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-projects.component.html',
  styleUrl: './admin-projects.component.scss',
})
export class AdminProjectsComponent {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly toasts = inject(ToastService);
  private readonly confirms = inject(ConfirmService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);

  protected readonly projects = signal<readonly AdminProjectRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly filters = signal<ProjectFilters>(projectFiltersFromQuery((name) => this.route.snapshot.queryParamMap.get(name)));
  protected readonly creating = signal(false);
  /** The project being edited (*Edit project…* in the row's menu). */
  protected readonly editing = signal<AdminProjectRow | null>(null);
  private readonly busy = signal(false);

  /** Filtered on the client: the list is every project of the instance, loaded once. */
  protected readonly rows = computed(() => filterProjects(this.projects(), this.filters()));
  protected readonly filtered = computed(() => projectFiltersActive(this.filters()));
  protected readonly takenKeys = computed(() => this.projects().map((p) => p.key ?? ''));
  protected readonly error = computed(() => (this.failed() ? this.t('error') : null));

  protected readonly columns = computed<SfDataTableColumn<AdminProjectRow>[]>(() => {
    const header = (id: string) => this.t(`columns.${id}`);
    return [
      { id: 'project', header: header('project'), value: (p) => p.name ?? '', sortable: true, hideable: false, width: 340 },
      { id: 'description', header: header('description'), value: (p) => p.description ?? '', width: 300 },
      { id: 'members', header: header('members'), value: (p) => p.memberCount ?? 0, sortable: true, align: 'end', width: 110 },
      { id: 'lastChange', header: header('lastChange'), value: (p) => p.lastChangeAt ?? '', sortable: true, width: 190 },
      { id: 'status', header: header('status'), value: (p) => (p.archived ? 1 : 0), sortable: true, width: 130 },
      { id: 'actions', header: header('actions'), width: 72, hideable: false },
    ];
  });

  protected readonly rowKey = (project: AdminProjectRow) => project.key ?? '';
  protected readonly rowLabel = (project: AdminProjectRow) => project.name ?? project.key ?? '';

  constructor() {
    effect(() => {
      const query = projectFiltersToQuery(this.filters());
      void this.router.navigate([], { relativeTo: this.route, queryParams: query, queryParamsHandling: 'merge', replaceUrl: true });
    });
    this.load();
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`admin.projects.${key}`, params);
  }

  protected setSearch(q: string): void {
    this.filters.update((f) => ({ ...f, q }));
  }

  protected setArchived(archived: boolean): void {
    this.filters.update((f) => ({ ...f, archived }));
  }

  protected clear(): void {
    this.filters.set(NO_PROJECT_FILTERS);
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.api.adminListProjects({ includeArchived: true }).subscribe({
      next: (projects) => {
        this.projects.set(projects);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  protected menuItems(project: AdminProjectRow): SfMenuItem[] {
    return [
      { id: 'edit', label: this.t('menu.edit'), icon: 'edit' },
      { id: 'open', label: this.t('menu.open'), icon: 'open_in_new' },
      project.archived
        ? { id: 'unarchive', label: this.t('menu.unarchive'), icon: 'unarchive' }
        : { id: 'archive', label: this.t('menu.archive'), icon: 'archive' },
    ];
  }

  protected open(project: AdminProjectRow): void {
    if (project.key) {
      void this.router.navigate(['/p', project.key, 'pages']);
    }
  }

  protected async onMenu(project: AdminProjectRow, item: SfMenuItem): Promise<void> {
    if (item.id === 'edit') {
      this.editing.set(project);
    } else if (item.id === 'open') {
      this.open(project);
    } else if (item.id === 'unarchive') {
      this.changeArchived(project, false);
    } else if (item.id === 'archive') {
      const name = project.name ?? project.key ?? '';
      const confirmed = await this.confirms.confirm({
        title: this.t('archiveTitle', { name }),
        message: this.t('archiveMessage'),
        confirmLabel: this.t('menu.archive'),
      });
      if (confirmed) {
        this.changeArchived(project, true);
      }
    }
  }

  /** Created or edited in the dialog: say so and read the list again. */
  protected saved(name: string, created: boolean): void {
    this.toasts.show(this.transloco.translate(created ? 'admin.projects.dialog.created' : 'admin.projects.dialog.saved', { name }), 'success');
    this.load();
  }

  /** Archives or unarchives; archiving offers Undo (which unarchives), unarchiving offers Undo (which archives again). */
  private changeArchived(project: AdminProjectRow, archived: boolean): void {
    const key = project.key;
    if (!key || this.busy()) {
      return;
    }
    const name = project.name ?? key;
    this.run(key, archived, () => {
      this.toasts.undo(this.t(archived ? 'archived' : 'unarchived', { name }), () => this.run(key, !archived));
    });
  }

  private run(key: string, archived: boolean, done?: () => void): void {
    this.busy.set(true);
    (archived ? this.api.archiveProject(key) : this.api.unarchiveProject(key)).subscribe({
      next: () => {
        this.busy.set(false);
        this.auth.setProjectArchived(key, archived);
        done?.();
        this.load();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.toasts.show(problemOf(err, this.t('actionFailed')).detail, 'error');
      },
    });
  }
}
