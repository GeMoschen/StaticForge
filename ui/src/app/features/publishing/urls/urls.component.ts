import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { Subscription } from 'rxjs';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { problemOf } from '../../../core/api/problem.util';
import { LocalesStore } from '../../../core/project/locales.store';
import { ProjectAccessStore } from '../../../core/project/project-access.store';
import { ProjectPermissionsStore } from '../../../core/project/project-permissions.store';
import { ToastService } from '../../../core/ui/toast.service';
import { SfDataTableColumn, SfDataTableFilter, SfDataTableQuery } from '../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../shared/components/display/sf-relative-time.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfBannerComponent } from '../../../shared/components/layout/sf-banner.component';
import { SfMenuComponent } from '../../../shared/components/menu/sf-menu.component';
import { SfMenuItem } from '../../../shared/components/menu/sf-menu-item';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { ChannelsService } from '../../channels/channels.service';
import {
  type UrlRegistryEntryView,
  type UrlTargetType,
  UrlRegistryService,
} from '../../settings/url-registry.service';
import {
  NO_LANGUAGE,
  TYPE_ICONS,
  URLS_PAGE_SIZE,
  URL_AREAS,
  URL_TARGET_TYPES,
  enumKey,
  isUrlFormatValid,
  urlText,
  urlsQueryOf,
} from './urls.util';

type ChannelView = components['schemas']['ChannelView'];
type UrlResetRequest = components['schemas']['UrlRegistryResetRequest'];

/** The URL cell being edited inline. */
interface UrlEdit {
  id: number;
  value: string;
  /** Save was tried: the format error shows. */
  submitted: boolean;
  saving: boolean;
  /** What the server refused (the URL is taken, not valid for this target). */
  serverError: string | null;
}

/** What a reset removes: the confirmation's texts and the request. */
interface ResetScope {
  title: string;
  message: string;
  confirmLabel: string;
  request: UrlResetRequest;
}

/**
 * Publishing › URLs (gate decision 208): the URL registry — every URL a page, folder or file was given, per channel,
 * language and area — in a server-side `sf-data-table` (20 per page) with its search and filters (type, channel,
 * language, area — one value each, as the API takes) in the URL. Each row has **Override** (developers: the URL cell
 * becomes an input with Save and Cancel, its format error and the server's refusal), **Reset** (admins; only on overridden
 * rows) and **Reset asset** (admins; every URL of that page, folder or file). The bar's ⋮ menu (admins) holds **Reset
 * channel** and **Reset area** — they need that filter set — and **Reset all** (the project key typed). Every reset
 * asks, cannot be undone, and says that the next build or preview assigns the computed URLs again.
 */
@Component({
  selector: 'sf-publishing-urls',
  standalone: true,
  imports: [
    SfBadgeComponent,
    SfBannerComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfIconComponent,
    SfInputComponent,
    SfMenuComponent,
    SfRelativeTimeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './urls.component.html',
  styleUrl: './urls.component.scss',
})
export class PublishingUrlsComponent {
  readonly projectKey = input.required<string>();

  private readonly api = inject(UrlRegistryService);
  private readonly channelsApi = inject(ChannelsService);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly locales = inject(LocalesStore);
  protected readonly access = inject(ProjectAccessStore);
  protected readonly permissions = inject(ProjectPermissionsStore);

  protected readonly pageSize = URLS_PAGE_SIZE;
  protected readonly typeIcons = TYPE_ICONS;
  protected readonly urlText = urlText;
  protected readonly enumKey = enumKey;

  protected readonly rows = signal<readonly UrlRegistryEntryView[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly channels = signal<readonly ChannelView[]>([]);
  protected readonly editing = signal<UrlEdit | null>(null);
  /** A reset is running: the menu and the row buttons wait for it. */
  protected readonly resetting = signal(false);

  /** The table's query (search, filters, page): `null` until it has reported its first. */
  protected readonly query = signal<SfDataTableQuery | null>(null);
  /** Bumped to read the current page again after a reset. */
  private readonly reloads = signal(0);
  private request: Subscription | null = null;

  protected readonly canOverride = this.permissions.canOverrideUrls;
  protected readonly canReset = this.permissions.canResetUrls;
  protected readonly rowKey = (row: UrlRegistryEntryView) => String(row.id);
  protected readonly rowLabel = (row: UrlRegistryEntryView) => urlText(row.url);

  protected readonly columns = computed<SfDataTableColumn<UrlRegistryEntryView>[]>(() => {
    const h = (id: string) => this.t(`columns.${id}`);
    const columns: SfDataTableColumn<UrlRegistryEntryView>[] = [
      { id: 'target', header: h('target'), value: (r) => r.targetLabel ?? '', hideable: false, width: 240 },
      { id: 'type', header: h('type'), value: (r) => this.t(`type.${enumKey(r.targetType)}`), hidden: true, width: 100 },
      { id: 'channel', header: h('channel'), value: (r) => r.channelKey ?? '', width: 100 },
    ];
    if (this.locales.isLocalized()) {
      columns.push({ id: 'lang', header: h('lang'), value: (r) => r.locale ?? '', width: 100 });
    }
    columns.push(
      { id: 'area', header: h('area'), value: (r) => this.t(`area.${enumKey(r.area)}`), width: 110 },
      { id: 'url', header: h('url'), value: (r) => urlText(r.url), width: 340 },
      { id: 'overridden', header: h('overridden'), value: (r) => (r.overridden ? 'manual' : 'auto'), width: 110 },
      { id: 'assigned', header: h('assigned'), value: (r) => r.assignedAt ?? '', width: 130 },
    );
    if (this.canOverride() || this.canReset()) {
      columns.push({ id: 'actions', header: h('actions'), width: 128, align: 'end', hideable: false });
    }
    return columns;
  });

  protected readonly filters = computed<SfDataTableFilter<UrlRegistryEntryView>[]>(() => {
    const filters: SfDataTableFilter<UrlRegistryEntryView>[] = [
      {
        id: 'type',
        label: this.t('columns.type'),
        single: true,
        options: URL_TARGET_TYPES.map((v) => ({ value: v, label: this.t(`type.${v}`) })),
      },
      {
        id: 'channel',
        label: this.t('columns.channel'),
        single: true,
        options: this.channels().map((c) => ({ value: c.key ?? '', label: c.name || (c.key ?? '') })),
      },
    ];
    if (this.locales.isLocalized()) {
      filters.push({
        id: 'lang',
        label: this.t('columns.lang'),
        single: true,
        options: [
          ...this.locales.locales().map((l) => ({ value: l.code ?? '', label: l.label || (l.code ?? '').toUpperCase() })),
          { value: NO_LANGUAGE, label: this.t('noLanguage') },
        ],
      });
    }
    filters.push({
      id: 'area',
      label: this.t('columns.area'),
      single: true,
      options: URL_AREAS.map((v) => ({ value: v, label: this.t(`area.${v}`) })),
    });
    return filters;
  });

  protected readonly moreActions = computed<SfMenuItem[]>(() => {
    const filters = this.query()?.filters ?? {};
    const channel = filters['channel']?.[0];
    const area = filters['area']?.[0];
    return [
      {
        id: 'resetChannel',
        label: this.t('resetChannel'),
        icon: 'restart_alt',
        disabledReason: channel ? undefined : this.t('needChannel'),
        action: () => channel && void this.reset(this.channelScope(channel)),
      },
      {
        id: 'resetArea',
        label: this.t('resetArea'),
        icon: 'restart_alt',
        disabledReason: area ? undefined : this.t('needArea'),
        action: () => area && void this.reset(this.areaScope(area)),
      },
      {
        id: 'resetAll',
        label: this.t('resetAll'),
        icon: 'restart_alt',
        danger: true,
        separatorBefore: true,
        action: () => void this.resetAll(),
      },
    ];
  });

  /** The error of the inline edit: the server's refusal, else the format error once Save was tried. */
  protected readonly editError = computed(() => {
    const edit = this.editing();
    if (!edit) {
      return null;
    }
    if (edit.serverError) {
      return edit.serverError;
    }
    return edit.submitted && !isUrlFormatValid(edit.value) ? this.t('errors.format') : null;
  });

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => {
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
    // Another page or filter drops an edit that was open on a row now gone from view.
    this.editing.set(null);
    this.query.set(query);
  }

  protected retry(): void {
    this.reloads.update((n) => n + 1);
  }

  protected targetName(row: UrlRegistryEntryView): string {
    const name = row.targetLabel || row.targetUid || row.targetUuid || '';
    if (row.variant) {
      return `${name} · ${this.t('variant', { name: row.variant })}`;
    }
    return (row.pageNumber ?? 1) > 1 ? `${name} · ${this.t('pageNumber', { n: row.pageNumber })}` : name;
  }

  protected typeIcon(row: UrlRegistryEntryView): string {
    return this.typeIcons[enumKey(row.targetType) as UrlTargetType] ?? 'link';
  }

  // ── Override ──────────────────────────────────────────────────────────────

  protected startEdit(row: UrlRegistryEntryView): void {
    if (row.id != null && this.canOverride()) {
      this.editing.set({ id: row.id, value: urlText(row.url), submitted: false, saving: false, serverError: null });
    }
  }

  protected setEdit(value: string): void {
    this.editing.update((e) => (e ? { ...e, value, submitted: false, serverError: null } : e));
  }

  protected cancelEdit(): void {
    this.editing.set(null);
  }

  protected saveEdit(): void {
    const edit = this.editing();
    if (!edit || edit.saving) {
      return;
    }
    if (!isUrlFormatValid(edit.value)) {
      this.editing.set({ ...edit, submitted: true });
      return;
    }
    this.editing.set({ ...edit, saving: true });
    this.api.override(this.projectKey(), edit.id, edit.value.trim(), true).subscribe({
      next: (updated) => {
        this.rows.update((rows) => rows.map((r) => (r.id === edit.id ? updated : r)));
        this.editing.set(null);
        this.toasts.show(this.t('saved'), 'success');
      },
      error: (err: unknown) => {
        const problem = problemOf(err, this.t('errors.failed'));
        this.editing.set({ ...edit, saving: false, serverError: problem.detail });
      },
    });
  }

  // ── Reset (irreversible: always asked) ────────────────────────────────────

  protected resetRow(row: UrlRegistryEntryView): Promise<void> {
    return this.reset({
      title: this.t('resetRowTitle'),
      message: this.t('resetRowMessage', { url: urlText(row.url) }),
      confirmLabel: this.t('resetRow'),
      request: { entryId: row.id },
    });
  }

  protected resetAsset(row: UrlRegistryEntryView): Promise<void> {
    const name = row.targetLabel || row.targetUid || '';
    return this.reset({
      title: this.t('resetAssetTitle', { name }),
      message: this.t('resetAssetMessage', { name }),
      confirmLabel: this.t('resetAsset'),
      request: { targetUuid: row.targetUuid },
    });
  }

  private channelScope(key: string): ResetScope {
    const channel = this.channels().find((c) => c.key === key)?.name || key;
    return {
      title: this.t('resetChannelTitle', { channel }),
      message: this.t('resetChannelMessage', { channel }),
      confirmLabel: this.t('resetChannel'),
      request: { channelKey: key },
    };
  }

  private areaScope(area: string): ResetScope {
    const label = this.t(`area.${enumKey(area)}`);
    return {
      title: this.t('resetAreaTitle', { area: label }),
      message: this.t('resetAreaMessage', { area: label }),
      confirmLabel: this.t('resetArea'),
      request: { area },
    };
  }

  private async reset(scope: ResetScope, typeToConfirm?: string): Promise<void> {
    if (this.resetting()) {
      return;
    }
    const confirmed = await this.confirms.confirm({
      title: scope.title,
      message: scope.message,
      confirmLabel: scope.confirmLabel,
      tone: 'danger',
      irreversible: true,
      typeToConfirm,
    });
    if (!confirmed) {
      return;
    }
    this.resetting.set(true);
    this.api.reset(this.projectKey(), scope.request, true).subscribe({
      next: () => {
        this.resetting.set(false);
        this.toasts.show(this.t('resetComplete'), 'success');
        this.editing.set(null);
        this.retry();
      },
      error: () => {
        this.resetting.set(false);
        this.toasts.show(this.t('resetFailed'), 'error');
      },
    });
  }

  private resetAll(): Promise<void> {
    return this.reset(
      {
        title: this.t('resetAllTitle'),
        message: this.t('resetAllMessage', { key: this.projectKey() }),
        confirmLabel: this.t('resetAllConfirm'),
        request: {},
      },
      this.projectKey(),
    );
  }

  private load(key: string, query: SfDataTableQuery, page: number): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.request = this.api.list(key, { ...urlsQueryOf(query), page, quiet: true }).subscribe({
      next: (result) => {
        const rows = result.content ?? [];
        const total = result.totalElements ?? 0;
        if (rows.length === 0 && total > 0 && page > 0) {
          // Rows went away under the page the table is on (a reset): read the last page that exists.
          this.load(key, query, Math.max(0, Math.ceil(total / URLS_PAGE_SIZE) - 1));
          return;
        }
        this.loading.set(false);
        this.loadFailed.set(false);
        this.rows.set(rows);
        this.total.set(total);
      },
      error: () => {
        this.loading.set(false);
        this.loadFailed.set(true);
        this.rows.set([]);
        this.total.set(0);
      },
    });
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`publishing.urls.${key}`, params);
  }
}
