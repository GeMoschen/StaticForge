import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { SfDataTableColumn } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { SfAvatarComponent } from '../../../../shared/components/display/sf-avatar.component';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfComboboxComponent, SfComboboxOption } from '../../../../shared/components/forms/sf-combobox.component';
import { SfDateInputComponent } from '../../../../shared/components/forms/sf-date-input.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { injectSampleQuery, minutesAgo } from '../changes/sample-area.util';
import {
  AUDIT_ACTIONS,
  AuditAction,
  AuditEvent,
  AuditFilters,
  NO_AUDIT_FILTERS,
  filterAudit,
  formatAuditFilter,
  parseAuditFilter,
  userById,
} from './admin-data';
import { AdminState } from './admin-state';

/**
 * Administration › Audit (M35.16): who did what, when. The filter bar is a **multi-select combobox** for the actions
 * (human labels such as "Signed in" — never the enum constants, never a native listbox), a user combobox you can type
 * into, a project select and an **inline date range** (From and To, either may stay empty). The filters live in the URL
 * (`afilter=act:signedIn.userCreated,by:u-ada,project:lumen,from:2026-09-01,to:2026-09-30`); the controls are as tall as
 * the search fields elsewhere (gate decision 43). The table has the time (relative, the exact time in its tooltip), user,
 * action, target, project and details, with a pager.
 */
@Component({
  selector: 'sf-sample-admin-audit',
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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-admin-audit.component.html',
  styleUrl: './sample-admin-audit.component.scss',
})
export class SampleAdminAuditComponent {
  protected readonly admin = inject(AdminState);
  protected readonly t = this.admin.t;
  private readonly query = injectSampleQuery();

  protected readonly filters = signal<AuditFilters>(NO_AUDIT_FILTERS);

  protected readonly rows = computed(() => (this.admin.review() !== 'live' ? [] : filterAudit(this.filters(), this.admin.now)));
  protected readonly filtered = computed(() => formatAuditFilter(this.filters()) !== null || this.admin.review() === 'empty');
  protected readonly error = computed(() => (this.admin.review() === 'error' ? this.t('audit.error') : null));

  protected readonly actionOptions = computed<SfComboboxOption<AuditAction>[]>(() => AUDIT_ACTIONS.map((value) => ({ value, label: this.t(`audit.actions.${value}`) })));
  protected readonly userOptions = computed<SfComboboxOption<string>[]>(() =>
    this.admin.users().map((u) => ({ value: u.id, label: u.displayName, description: `@${u.username}` })),
  );
  /** `''` stands for "all projects". */
  protected readonly projectOptions = computed<SfSelectOption<string>[]>(() => [
    { value: '', label: this.t('audit.allProjects') },
    ...this.admin.projects().map((p) => ({ value: p.key, label: p.name })),
  ]);

  protected readonly columns = computed<SfDataTableColumn<AuditEvent>[]>(() => {
    const header = (id: string) => this.t(`audit.columns.${id}`);
    return [
      { id: 'time', header: header('time'), value: (e) => -e.minutes, sortable: true, hideable: false, width: 150 },
      { id: 'user', header: header('user'), value: (e) => this.userName(e), sortable: true, width: 190 },
      { id: 'action', header: header('action'), value: (e) => this.t(`audit.actions.${e.action}`), sortable: true, width: 190 },
      { id: 'target', header: header('target'), value: (e) => e.target, sortable: true, width: 200 },
      { id: 'project', header: header('project'), value: (e) => e.project ?? '', sortable: true, width: 150 },
      { id: 'details', header: header('details'), value: (e) => e.details, width: 260 },
    ];
  });
  protected readonly rowKey = (event: AuditEvent) => event.id;
  protected readonly rowLabel = (event: AuditEvent) => `${this.t(`audit.actions.${event.action}`)} · ${event.target}`;

  constructor() {
    this.filters.set(parseAuditFilter(this.query.get('afilter')));
    effect(() => this.query.set({ afilter: formatAuditFilter(this.filters()) }));
    inject(DestroyRef).onDestroy(() => this.query.set({ afilter: null }));
  }

  protected setActions(value: AuditAction | AuditAction[] | null): void {
    const actions = Array.isArray(value) ? value : value ? [value] : [];
    this.filters.update((f) => ({ ...f, actions }));
  }

  protected setUser(value: string | string[] | null): void {
    const by = Array.isArray(value) ? (value[0] ?? null) : value;
    this.filters.update((f) => ({ ...f, by }));
  }

  protected setProject(value: string | null): void {
    this.filters.update((f) => ({ ...f, project: value || null }));
  }

  protected setFrom(from: string | null): void {
    this.filters.update((f) => ({ ...f, from }));
  }

  protected setTo(to: string | null): void {
    this.filters.update((f) => ({ ...f, to }));
  }

  protected clear(): void {
    this.filters.set(NO_AUDIT_FILTERS);
    this.admin.review.set('live');
  }

  protected userName(event: AuditEvent): string {
    return event.by ? (userById(event.by)?.displayName ?? event.by) : this.t('audit.system');
  }

  protected projectName(key: string | null): string | null {
    return key ? this.admin.projectName(key) : null;
  }

  protected ago(minutes: number): number {
    return minutesAgo(minutes, this.admin.now);
  }
}
