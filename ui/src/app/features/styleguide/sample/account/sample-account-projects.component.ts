import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SfDataTableColumn } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfBannerComponent } from '../../../../shared/components/layout/sf-banner.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfSkeletonComponent } from '../../../../shared/components/layout/sf-skeleton.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../../shared/components/sf-empty-state.component';
import { injectSampleQuery, oneOf } from '../changes/sample-area.util';
import { SampleState } from '../sample-state';
import { ACCOUNT_PROJECTS, AccountProject, PROJECTS_STATUSES, ProjectRole, ProjectsStatus } from './account-data';
import { AccountState } from './account-state';

/**
 * My account › My projects: the projects the person belongs to and what they may do there, as the *human* role label
 * (Viewer, Editor, Release manager, Developer, Project admin — never the enum), each with an *Open* link. It has a
 * skeleton while loading, an error with *Try again*, and an empty state for a person in no project.
 *
 * Query parameter `acstate=loading|error|empty` opens the page in that state.
 */
@Component({
  selector: 'sf-sample-account-projects',
  standalone: true,
  imports: [
    SfBadgeComponent,
    SfBannerComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfEmptyStateComponent,
    SfPageHeaderComponent,
    SfSkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-account-projects.component.scss',
  template: `
    <sf-page-header [title]="t('sections.projects')" />

    @switch (status()) {
      @case ('loading') {
        <sf-skeleton shape="table" [rows]="4" [label]="t('projects.loading')" />
      }
      @case ('error') {
        <sf-banner tone="danger" live="assertive" [title]="t('projects.errorTitle')">
          {{ t('projects.error') }}
          <sf-button sfBannerActions variant="secondary" size="sm" icon="refresh" (click)="status.set('ready')">{{ t('projects.retry') }}</sf-button>
        </sf-banner>
      }
      @case ('empty') {
        <sf-empty-state class="page__table" icon="folder_off" [title]="t('projects.emptyTitle')" [description]="t('projects.emptyText')" />
      }
      @default {
        <p class="page__note">{{ t('projects.note') }}</p>
        <sf-data-table
          class="page__table"
          [columns]="columns()"
          [rows]="rows"
          [rowKey]="rowKey"
          [rowLabel]="rowLabel"
          [label]="t('projects.table')"
          (rowOpen)="open($event)"
        >
          <ng-template sfDataTableCell="name" [sfDataTableCellRows]="rows" let-row>
            <span class="cell-name"><span class="cell-name__text">{{ row.name }}</span></span>
          </ng-template>
          <ng-template sfDataTableCell="role" [sfDataTableCellRows]="rows" let-row>
            <sf-badge [tone]="row.role === 'PROJECT_ADMIN' ? 'accent' : 'neutral'" [label]="roleLabel(row.role)" />
          </ng-template>
          <ng-template sfDataTableCell="open" [sfDataTableCellRows]="rows" let-row>
            <sf-button variant="ghost" size="sm" icon="arrow_forward" (click)="open(row)">{{ t('projects.open') }}</sf-button>
          </ng-template>
        </sf-data-table>
      }
    }
  `,
})
export class SampleAccountProjectsComponent {
  private readonly sample = inject(SampleState);
  private readonly account = inject(AccountState);
  protected readonly t = this.account.t;

  protected readonly status = signal<ProjectsStatus>(oneOf(injectSampleQuery().get('acstate'), PROJECTS_STATUSES) ?? 'ready');
  protected readonly rows = ACCOUNT_PROJECTS;
  protected readonly rowKey = (row: AccountProject) => row.key;
  protected readonly rowLabel = (row: AccountProject) => row.name;

  protected readonly columns = computed<SfDataTableColumn<AccountProject>[]>(() => [
    { id: 'name', header: this.t('projects.columns.project'), value: (r) => r.name, sortable: true, hideable: false },
    { id: 'role', header: this.t('projects.columns.role'), value: (r) => this.roleLabel(r.role), sortable: true, width: 200 },
    { id: 'open', header: this.t('projects.columns.open'), width: 140, hideable: false },
  ]);

  /** The human label of a role (`roles.*`). */
  protected roleLabel(role: ProjectRole): string {
    return this.t(`roles.${role}`);
  }

  protected open(row: AccountProject): void {
    this.sample.notice('prototypeNotice');
  }
}
