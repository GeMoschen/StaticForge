import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import type { Subscription } from 'rxjs';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { problemOf } from '../../../core/api/problem.util';
import { LocalesStore } from '../../../core/project/locales.store';
import { ProjectAccessStore } from '../../../core/project/project-access.store';
import { ProjectMembersStore } from '../../../core/project/project-members.store';
import { ProjectPermissionsStore } from '../../../core/project/project-permissions.store';
import { ToastService } from '../../../core/ui/toast.service';
import { SfDataTableColumn, SfDataTableFilter, SfDataTableQuery } from '../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { SfRelativeTimeComponent } from '../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../shared/components/display/sf-status.component';
import { SfBannerComponent } from '../../../shared/components/layout/sf-banner.component';
import { SfMenuComponent } from '../../../shared/components/menu/sf-menu.component';
import { SfMenuItem } from '../../../shared/components/menu/sf-menu-item';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfTooltipDirective } from '../../../shared/directives/sf-tooltip.directive';
import { ChannelsService } from '../../channels/channels.service';
import { type RedirectView, RedirectsService } from '../../settings/redirects.service';
import { RedirectDialogComponent, displayPath } from './redirect-dialog.component';
import {
  NO_LANGUAGE,
  REDIRECTS_PAGE_SIZE,
  REDIRECT_KINDS,
  REDIRECT_STATES,
  REDIRECT_STATE_ICONS,
  REDIRECT_STATE_TONES,
  redirectsQueryOf,
  stateOf,
} from './redirects.util';

type ChannelView = components['schemas']['ChannelView'];

/** The dialog: `redirect: null` adds one. */
interface DialogState {
  redirect: RedirectView | null;
}

/**
 * Publishing › Redirects (gate decisions 205-209): old paths and where they lead, in a server-side `sf-data-table`
 * (50 per page) with its path search and filters (channel, language, kind, state — one value each, as the API takes)
 * in the URL. The state is "as of" the last run on the default target and explains itself in a tooltip; without a
 * published build the rows say "Not built". Automatic rows name the run that made them (a link into Runs), manual ones
 * who and when. Every row is editable by developers (⋮ or a click): Edit opens the dialog, Delete asks and sends the
 * row's version (`If-Match`). A stale version (`409`) or a vanished row shows the Reload banner. Project admins get
 * "Delete all manual redirects…" in the bar's ⋮ menu, with the project key typed; it is hidden when there are none.
 */
@Component({
  selector: 'sf-publishing-redirects',
  standalone: true,
  imports: [
    RedirectDialogComponent,
    RouterLink,
    SfBannerComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfMenuComponent,
    SfRelativeTimeComponent,
    SfStatusComponent,
    SfTooltipDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './redirects.component.html',
  styleUrl: './redirects.component.scss',
})
export class PublishingRedirectsComponent {
  readonly projectKey = input.required<string>();

  private readonly api = inject(RedirectsService);
  private readonly channelsApi = inject(ChannelsService);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly locales = inject(LocalesStore);
  protected readonly members = inject(ProjectMembersStore);
  protected readonly access = inject(ProjectAccessStore);
  protected readonly permissions = inject(ProjectPermissionsStore);

  protected readonly pageSize = REDIRECTS_PAGE_SIZE;
  protected readonly tones = REDIRECT_STATE_TONES;
  protected readonly icons = REDIRECT_STATE_ICONS;
  protected readonly stateOf = stateOf;
  protected readonly displayPath = displayPath;

  protected readonly rows = signal<readonly RedirectView[]>([]);
  protected readonly total = signal(0);
  /** The run the states are as of; `null` while nothing is published on the default target. */
  protected readonly basisRunId = signal<number | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly channels = signal<readonly ChannelView[]>([]);
  protected readonly dialog = signal<DialogState | null>(null);
  /** The list is out of date: a row was changed or deleted elsewhere (a stale `If-Match`, a `404`). */
  protected readonly conflict = signal(false);
  /** How many manual redirects exist in all (for "Delete all manual redirects…"); admins only. */
  protected readonly manualCount = signal(0);

  /** The table's query (search, filters, page): `null` until it has reported its first. */
  private readonly query = signal<SfDataTableQuery | null>(null);
  /** Bumped to read the current page again after a write. */
  private readonly reloads = signal(0);
  private request: Subscription | null = null;

  protected readonly canEdit = this.permissions.canEditRedirects;
  protected readonly notBuilt = computed(() => !this.loading() && this.basisRunId() === null);
  protected readonly rowKey = (row: RedirectView) => String(row.id);
  protected readonly rowLabel = (row: RedirectView) => displayPath(row.fromPath);

  protected readonly columns = computed<SfDataTableColumn<RedirectView>[]>(() => {
    const h = (id: string) => this.t(`columns.${id}`);
    const columns: SfDataTableColumn<RedirectView>[] = [
      { id: 'from', header: h('from'), value: (r) => displayPath(r.fromPath), hideable: false, width: 260 },
      { id: 'to', header: h('to'), value: (r) => r.resolvedTarget ?? r.toPath ?? r.toAssetName ?? '', width: 260 },
      { id: 'channel', header: h('channel'), value: (r) => this.channelName(r.channel), width: 100 },
    ];
    if (this.locales.isLocalized()) {
      columns.push({ id: 'lang', header: h('lang'), value: (r) => r.locale ?? '', width: 100 });
    }
    columns.push(
      { id: 'kind', header: h('kind'), value: (r) => this.t(`kind.${r.kind}`), width: 110 },
      { id: 'state', header: h('state'), value: (r) => r.state ?? '', width: 130 },
      { id: 'created', header: h('created'), value: (r) => r.createdAt ?? '', width: 200 },
    );
    if (this.canEdit()) {
      columns.push({ id: 'actions', header: h('actions'), width: 64, align: 'end', hideable: false });
    }
    return columns;
  });

  protected readonly filters = computed<SfDataTableFilter<RedirectView>[]>(() => {
    const filters: SfDataTableFilter<RedirectView>[] = [
      {
        id: 'channel',
        label: this.t('columns.channel'),
        single: true,
        options: this.channels().map((c) => ({ value: c.key ?? '', label: c.name || (c.key ?? '') })),
      },
      {
        id: 'kind',
        label: this.t('columns.kind'),
        single: true,
        options: REDIRECT_KINDS.map((k) => ({ value: k, label: this.t(`kind.${k}`) })),
      },
    ];
    if (this.locales.isLocalized()) {
      filters.splice(1, 0, {
        id: 'lang',
        label: this.t('columns.lang'),
        single: true,
        options: [
          ...this.locales.locales().map((l) => ({ value: l.code ?? '', label: l.label || (l.code ?? '').toUpperCase() })),
          // Channels without languages (files) keep the rows of a project with languages that have none.
          { value: NO_LANGUAGE, label: this.t('noLanguage') },
        ],
      });
    }
    // Without a published build there is no state to filter by.
    if (!this.notBuilt()) {
      filters.push({
        id: 'state',
        label: this.t('columns.state'),
        single: true,
        options: REDIRECT_STATES.map((s) => ({ value: s, label: this.t(`state.${s}`) })),
      });
    }
    return filters;
  });

  protected readonly moreActions = computed<SfMenuItem[]>(() => [
    {
      id: 'deleteManual',
      label: this.t('deleteManual'),
      icon: 'delete_sweep',
      danger: true,
      action: () => void this.deleteManual(),
    },
  ]);

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => {
        this.members.load(key);
        this.locales.load(key).subscribe({ error: () => undefined });
        this.channelsApi.list(key).subscribe({
          next: (list) => this.channels.set(list ?? []),
          error: () => this.channels.set([]),
        });
      });
    });
    effect(() => {
      const key = this.projectKey();
      const query = this.query();
      this.reloads();
      if (query) {
        untracked(() => this.load(key, query, query.page));
      }
    });
  }

  protected onQuery(query: SfDataTableQuery): void {
    this.query.set(query);
  }

  protected retry(): void {
    this.reloads.update((n) => n + 1);
  }

  protected reload(): void {
    this.conflict.set(false);
    this.retry();
  }

  protected add(): void {
    this.dialog.set({ redirect: null });
  }

  protected edit(row: RedirectView): void {
    if (this.canEdit()) {
      this.dialog.set({ redirect: row });
    }
  }

  protected onSaved(): void {
    this.toasts.show(this.t('saved'), 'success');
    this.reload();
  }

  protected rowActions(row: RedirectView): SfMenuItem[] {
    return [
      { id: 'edit', label: this.t('edit'), icon: 'edit', action: () => this.edit(row) },
      {
        id: 'delete',
        label: this.t('delete'),
        icon: 'delete',
        danger: true,
        separatorBefore: true,
        action: () => void this.remove(row),
      },
    ];
  }

  /** What the "Leads to" column names for a page: its current name, or "Deleted page"; a later page number too. */
  protected pageName(row: RedirectView): string {
    const name = row.toAssetName || this.t('deletedPage');
    return row.toPageNumber && row.toPageNumber > 1 ? `${name} (${this.t('pageNumber', { n: row.toPageNumber })})` : name;
  }

  protected channelName(key: string | null | undefined): string {
    return this.channels().find((c) => c.key === key)?.name || key || '';
  }

  private async remove(row: RedirectView): Promise<void> {
    // The row is deleted at the version read: without one there is nothing to compare with.
    if (row.id == null || row.version == null) {
      return;
    }
    const confirmed = await this.confirms.confirm({
      title: this.t('deleteOneTitle'),
      message: this.t('deleteOneMessage', { path: displayPath(row.fromPath) }),
      confirmLabel: this.t('delete'),
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    this.api.delete(this.projectKey(), row.id, row.version).subscribe({
      next: () => {
        this.toasts.show(this.t('deletedOne'), 'success');
        this.reload();
      },
      error: (err: unknown) => {
        const problem = problemOf(err, this.t('dialog.saveFailed'));
        if ((problem.status === 409 && problem.code === 'SF-API-0409') || problem.status === 404) {
          this.conflict.set(true);
        } else {
          this.toasts.show(problem.detail, 'error');
        }
      },
    });
  }

  private async deleteManual(): Promise<void> {
    const count = this.manualCount();
    const confirmed = await this.confirms.confirm({
      title: this.t('deleteTitle', { count }),
      message: this.t('deleteMessage', { key: this.projectKey() }),
      confirmLabel: this.t('deleteConfirm', { count }),
      tone: 'danger',
      typeToConfirm: this.projectKey(),
      irreversible: true,
    });
    if (!confirmed) {
      return;
    }
    this.api.deleteAllManual(this.projectKey()).subscribe({
      next: ({ deleted }) => {
        this.toasts.show(this.t('deleted', { count: deleted }), 'success');
        this.reload();
      },
    });
  }

  private load(key: string, query: SfDataTableQuery, page: number): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.request = this.api.list(key, { ...redirectsQueryOf(query), page }).subscribe({
      next: (result) => {
        const rows = result.rows ?? [];
        const total = result.totalElements ?? 0;
        if (rows.length === 0 && total > 0 && page > 0) {
          // Rows went away under the page the table is on (a delete): read the last page that exists.
          this.load(key, query, Math.max(0, Math.ceil(total / REDIRECTS_PAGE_SIZE) - 1));
          return;
        }
        this.loading.set(false);
        this.loadFailed.set(false);
        this.rows.set(rows);
        this.total.set(total);
        this.basisRunId.set(result.basisRunId ?? null);
        this.countManual(key);
      },
      error: () => {
        this.loading.set(false);
        this.loadFailed.set(true);
        this.rows.set([]);
        this.total.set(0);
      },
    });
  }

  /** The count behind "Delete all manual redirects…": a one-row read of the manual kind (admins only). */
  private countManual(key: string): void {
    if (!this.permissions.canDeleteAllRedirects()) {
      return;
    }
    this.api.list(key, { kind: 'MANUAL', size: 1 }).subscribe({
      next: (result) => this.manualCount.set(result.totalElements ?? 0),
      error: () => this.manualCount.set(0),
    });
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`publishing.redirects.${key}`, params);
  }
}
