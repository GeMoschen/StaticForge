import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AuthStore, type Membership } from '../../core/auth/auth.store';
import { SessionService } from '../../core/auth/session.service';
import { SfDataTableColumn } from '../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfBannerComponent } from '../../shared/components/layout/sf-banner.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfSkeletonComponent } from '../../shared/components/layout/sf-skeleton.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';

type Status = 'loading' | 'error' | 'ready';

/**
 * My account › My projects: the projects the person belongs to and what they may do there, as the *human* role label
 * (Viewer, Editor, Developer, Project admin — never the enum), each with an *Open* link. A skeleton while the profile
 * loads, an error with *Try again*, and an empty state for a person in no project.
 */
@Component({
  selector: 'sf-account-projects',
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
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './account-projects.component.scss',
  template: `
    <sf-page-header [title]="'account.sections.projects' | transloco" />

    @switch (status()) {
      @case ('loading') {
        <sf-skeleton shape="table" [rows]="4" [label]="'account.projects.loading' | transloco" />
      }
      @case ('error') {
        <sf-banner tone="danger" live="assertive" [title]="'account.projects.errorTitle' | transloco">
          {{ 'account.projects.error' | transloco }}
          <sf-button sfBannerActions variant="secondary" size="sm" icon="refresh" (click)="load()">{{ 'account.projects.retry' | transloco }}</sf-button>
        </sf-banner>
      }
      @default {
        @if (rows().length === 0) {
          <sf-empty-state
            class="page__table"
            icon="folder_off"
            [title]="'account.projects.emptyTitle' | transloco"
            [description]="'account.projects.emptyText' | transloco"
          />
        } @else {
          <p class="page__note">{{ 'account.projects.note' | transloco }}</p>
          <sf-data-table
            class="page__table"
            [columns]="columns()"
            [rows]="rows()"
            [rowKey]="rowKey"
            [rowLabel]="rowLabel"
            [label]="'account.projects.table' | transloco"
            (rowOpen)="open($event)"
          >
            <ng-template sfDataTableCell="name" [sfDataTableCellRows]="rows()" let-row>
              <span class="cell-name"><span class="cell-name__text">{{ rowLabel(row) }}</span></span>
            </ng-template>
            <ng-template sfDataTableCell="role" [sfDataTableCellRows]="rows()" let-row>
              <sf-badge [tone]="row.role === 'PROJECT_ADMIN' ? 'accent' : 'neutral'" [label]="roleLabel(row.role)" />
            </ng-template>
            <ng-template sfDataTableCell="open" [sfDataTableCellRows]="rows()" let-row>
              <sf-button variant="ghost" size="sm" icon="arrow_forward" (click)="open(row); $event.stopPropagation()">{{
                'account.projects.open' | transloco
              }}</sf-button>
            </ng-template>
          </sf-data-table>
        }
      }
    }
  `,
})
export class AccountProjectsComponent {
  private readonly auth = inject(AuthStore);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  protected readonly status = signal<Status>('ready');
  protected readonly rows = computed(() => this.auth.memberships());
  protected readonly rowKey = (row: Membership) => row.projectKey ?? '';
  protected readonly rowLabel = (row: Membership) => row.projectName ?? row.projectKey ?? '';

  protected readonly columns = computed<SfDataTableColumn<Membership>[]>(() => [
    { id: 'name', header: this.transloco.translate('account.projects.columns.project'), value: (r) => this.rowLabel(r), sortable: true, hideable: false },
    { id: 'role', header: this.transloco.translate('account.projects.columns.role'), value: (r) => this.roleLabel(r.role), sortable: true, width: 200 },
    { id: 'open', header: this.transloco.translate('account.projects.columns.open'), width: 140, hideable: false },
  ]);

  constructor() {
    this.load();
  }

  /** The memberships aren't in the token: read the profile fresh. */
  protected load(): void {
    this.status.set(this.rows().length === 0 ? 'loading' : 'ready');
    this.session.reloadUser().subscribe({
      next: () => this.status.set('ready'),
      error: () => this.status.set(this.rows().length === 0 ? 'error' : 'ready'),
    });
  }

  /** The human label of a role (`enum.projectRole.*`); an unknown role shows as it is. */
  protected roleLabel(role: string | null | undefined): string {
    const key = `enum.projectRole.${role}`;
    const label = this.transloco.translate(key);
    return label === key ? (role ?? this.transloco.translate('account.projects.unknownRole')) : label;
  }

  protected open(row: Membership): void {
    void this.router.navigate(['/p', row.projectKey, 'pages']);
  }
}
