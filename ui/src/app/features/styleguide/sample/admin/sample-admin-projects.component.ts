import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { SfTableIdentityComponent } from '../../../../shared/components/data-table/sf-table-identity.component';
import { ToastService } from '../../../../core/ui/toast.service';
import { SfDataTableColumn } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfSearchInputComponent } from '../../../../shared/components/forms/sf-search-input.component';
import { SfSwitchComponent } from '../../../../shared/components/forms/sf-switch.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfMenuComponent } from '../../../../shared/components/menu/sf-menu.component';
import { SfMenuItem } from '../../../../shared/components/menu/sf-menu-item';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { injectSampleQuery, minutesAgo } from '../changes/sample-area.util';
import { AdminProject, NO_PROJECT_FILTERS, ProjectFilters, filterProjects, formatProjectFilter, parseProjectFilter } from './admin-data';
import { AdminState } from './admin-state';
import { SampleAdminProjectDialogComponent } from './sample-admin-project-dialog.component';

/**
 * Administration › Projects (M35.16): `sf-data-table` of the instance's projects — name and key, members, the last
 * change (relative time and revision) and the status — with a search and a *Show archived* switch kept in the URL
 * (`pfilter=q:coffee,archived:1`). A row's ⋮ menu opens the project, archives it (a confirmation, then Undo) or unarchives
 * it (secondary: no confirmation); archived rows are muted.
 */
@Component({
  selector: 'sf-sample-admin-projects',
  standalone: true,
  imports: [
    SfTableIdentityComponent,
    SampleAdminProjectDialogComponent,
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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-admin-projects.component.html',
  styleUrl: './sample-admin-projects.component.scss',
})
export class SampleAdminProjectsComponent {
  protected readonly admin = inject(AdminState);
  protected readonly t = this.admin.t;
  private readonly query = injectSampleQuery();
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);

  protected readonly filters = signal<ProjectFilters>(NO_PROJECT_FILTERS);
  protected readonly creating = signal(false);
  /** The project being edited (*Edit project…* in the row's menu). */
  protected readonly editing = signal<AdminProject | null>(null);
  protected readonly rows = computed(() =>
    this.admin.review() !== 'live' ? [] : filterProjects(this.admin.projects(), this.admin.archivedProjects(), this.filters()),
  );
  protected readonly filtered = computed(() => formatProjectFilter(this.filters()) !== null || this.admin.review() === 'empty');
  protected readonly error = computed(() => (this.admin.review() === 'error' ? this.t('projects.error') : null));

  protected readonly columns = computed<SfDataTableColumn<AdminProject>[]>(() => {
    const header = (id: string) => this.t(`projects.columns.${id}`);
    return [
      { id: 'project', header: header('project'), value: (p) => p.name, sortable: true, hideable: false, width: 340 },
      { id: 'description', header: header('description'), value: (p) => p.description, width: 300 },
      { id: 'members', header: header('members'), value: (p) => this.admin.memberCounts().get(p.key) ?? 0, sortable: true, align: 'end', width: 110 },
      { id: 'lastChange', header: header('lastChange'), value: (p) => p.lastChangeMinutes ?? Number.MAX_SAFE_INTEGER, sortable: true, width: 190 },
      { id: 'status', header: header('status'), value: (p) => (this.admin.isArchived(p.key) ? 1 : 0), sortable: true, width: 130 },
      { id: 'actions', header: header('actions'), width: 72, hideable: false },
    ];
  });

  protected readonly rowKey = (project: AdminProject) => project.key;
  protected readonly rowLabel = (project: AdminProject) => project.name;

  constructor() {
    this.filters.set(parseProjectFilter(this.query.get('pfilter')));
    effect(() => this.query.set({ pfilter: formatProjectFilter(this.filters()) }));
    inject(DestroyRef).onDestroy(() => this.query.set({ pfilter: null }));
  }

  protected edited(project: AdminProject): void {
    this.admin.projects.update((all) => all.map((p) => (p.key === project.key ? project : p)));
  }

  protected created(project: AdminProject): void {
    this.admin.projects.update((all) => [project, ...all]);
  }

  protected setSearch(q: string): void {
    this.filters.update((f) => ({ ...f, q }));
  }

  protected setArchived(archived: boolean): void {
    this.filters.update((f) => ({ ...f, archived }));
  }

  protected clear(): void {
    this.filters.set(NO_PROJECT_FILTERS);
    this.admin.review.set('live');
  }

  protected ago(minutes: number): number {
    return minutesAgo(minutes, this.admin.now);
  }

  protected members(project: AdminProject): number {
    return this.admin.memberCounts().get(project.key) ?? 0;
  }

  protected menuItems(project: AdminProject): SfMenuItem[] {
    return [
      { id: 'edit', label: this.t('projects.menu.edit'), icon: 'edit' },
      { id: 'open', label: this.t('projects.menu.open'), icon: 'open_in_new' },
      this.admin.isArchived(project.key)
        ? { id: 'unarchive', label: this.t('projects.menu.unarchive'), icon: 'unarchive' }
        : { id: 'archive', label: this.t('projects.menu.archive'), icon: 'archive' },
    ];
  }

  protected open(project: AdminProject): void {
    this.admin.notice(this.t('projects.opens', { name: project.name }));
  }

  protected async onMenu(project: AdminProject, item: SfMenuItem): Promise<void> {
    if (item.id === 'edit') {
      this.editing.set(project);
    } else if (item.id === 'open') {
      this.open(project);
    } else if (item.id === 'unarchive') {
      this.admin.setArchived(project.key, false);
      this.toasts.undo(this.t('projects.unarchived', { name: project.name }), () => this.admin.setArchived(project.key, true));
    } else if (item.id === 'archive') {
      const confirmed = await this.confirms.confirm({
        title: this.t('projects.archiveTitle', { name: project.name }),
        message: this.t('projects.archiveMessage'),
        confirmLabel: this.t('projects.menu.archive'),
      });
      if (confirmed) {
        this.admin.setArchived(project.key, true);
        this.toasts.undo(this.t('projects.archived', { name: project.name }), () => this.admin.setArchived(project.key, false));
      }
    }
  }
}
