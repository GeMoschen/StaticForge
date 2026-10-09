import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { ToastService } from '../../../../core/ui/toast.service';
import { SfDataTableColumn, SfDataTableFilter, SfDataTableQuery } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfMenuComponent, SfMenuItem } from '../../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { injectSampleQuery, minutesAgo } from '../changes/sample-area.util';
import { PROJECT_KEY, RegisteredUrl, URLS } from './publishing-data';
import { PublishingState } from './publishing-state';

const TYPE_ICONS: Readonly<Record<RegisteredUrl['type'], string>> = { page: 'description', media: 'image', folder: 'folder' };
/** The language filter's value for URLs without a language. */
const NO_LANGUAGE = '—';
/** Rows per page: small enough that the sample shows the pager. */
export const URL_PAGE_SIZE = 5;

/** The URL cell being edited inline. */
interface UrlEdit {
  id: string;
  value: string;
  /** Save was tried: the error shows. */
  submitted: boolean;
}

/** What a reset removes: a confirmation text and the rows it applies to. */
interface ResetScope {
  title: string;
  message: string;
  confirmLabel: string;
  matches: (row: RegisteredUrl) => boolean;
}

/**
 * Publishing › URLs: the URL registry — every URL a page, folder or file was given, per channel, language and area —
 * in an `sf-data-table` with its search and filters in one aligned bar, paged. Each row has **Override** (the URL cell
 * becomes an input with Save and Cancel and its validation error), **Reset** (only on overridden rows) and **Reset
 * asset** (every URL of that page, folder or file). The bar's ⋮ menu holds **Reset channel** and **Reset area** (they
 * need that filter set) and **Reset all** (typed project key; hidden when the registry is empty). The resets ask in a
 * plain danger confirm; a target that no longer exists is marked "deleted".
 *
 * Query parameters: `uedit=<url id>` (that row's URL being edited), `uerror=1` (the edit shows "already used by
 * another target"), `uerror=2` (every reset fails: the error toast), `uempty=1` (an empty registry).
 */
@Component({
  selector: 'sf-sample-urls',
  standalone: true,
  imports: [
    SfBadgeComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfIconComponent,
    SfInputComponent,
    SfMenuComponent,
    SfRelativeTimeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-urls.component.html',
  styleUrl: './sample-urls.component.scss',
})
export class SampleUrlsComponent {
  protected readonly state = inject(PublishingState);
  protected readonly t = this.state.t;
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly query = injectSampleQuery();
  private readonly now = Date.now();
  /** Every reset fails (`uerror=2`). */
  private readonly resetFails = this.query.get('uerror') === '2';

  protected readonly rows = signal<readonly RegisteredUrl[]>(this.query.get('uempty') === '1' ? [] : URLS);
  protected readonly editing = signal<UrlEdit | null>(null);
  /** The filter chips the table holds (channel and area decide which resets are available). */
  protected readonly picked = signal<SfDataTableQuery['filters']>({});
  protected readonly pageSize = URL_PAGE_SIZE;
  protected readonly typeIcons = TYPE_ICONS;
  protected readonly rowKey = (row: RegisteredUrl) => row.id;
  protected readonly rowLabel = (row: RegisteredUrl) => row.url;

  protected readonly columns = computed<SfDataTableColumn<RegisteredUrl>[]>(() => {
    const h = (id: string) => this.t(`urls.columns.${id}`);
    return [
      { id: 'target', header: h('target'), value: (r) => r.target, sortable: true, hideable: false, width: 240 },
      { id: 'type', header: h('type'), value: (r) => r.type, hidden: true, width: 100 },
      { id: 'channel', header: h('channel'), value: (r) => r.channel, sortable: true, width: 100 },
      { id: 'lang', header: h('lang'), value: (r) => r.lang, sortable: true, width: 100 },
      { id: 'area', header: h('area'), value: (r) => r.area, sortable: true, width: 110 },
      { id: 'url', header: h('url'), value: (r) => r.url, sortable: true, width: 340 },
      { id: 'overridden', header: h('overridden'), value: (r) => (r.overridden ? 'manual' : 'auto'), width: 110 },
      { id: 'assigned', header: h('assigned'), value: (r) => r.assignedMinutes, sortable: true, width: 130 },
      { id: 'actions', header: h('actions'), width: 128, align: 'end', hideable: false, searchable: false },
    ];
  });

  protected readonly filters = computed<SfDataTableFilter<RegisteredUrl>[]>(() => [
    {
      id: 'type',
      label: this.t('urls.columns.type'),
      options: (['page', 'folder', 'media'] as const).map((v) => ({ value: v, label: this.t(`urls.type.${v}`) })),
    },
    {
      id: 'channel',
      label: this.t('urls.columns.channel'),
      options: ['html', 'rss', 'all'].map((v) => ({ value: v, label: v === 'all' ? this.t('urls.allChannels') : v })),
    },
    {
      id: 'lang',
      label: this.t('urls.columns.lang'),
      options: [
        { value: 'DE', label: 'DE' },
        { value: 'EN', label: 'EN' },
        { value: NO_LANGUAGE, label: this.t('urls.noLanguage') },
      ],
    },
    {
      id: 'area',
      label: this.t('urls.columns.area'),
      options: (['generated', 'preview'] as const).map((v) => ({ value: v, label: this.t(`urls.area.${v}`) })),
    },
  ]);

  protected readonly moreActions = computed<SfMenuItem[]>(() => {
    const channels = this.picked()['channel'] ?? [];
    const areas = this.picked()['area'] ?? [];
    return [
      {
        id: 'resetChannel',
        label: this.t('urls.resetChannel'),
        icon: 'restart_alt',
        disabledReason: channels.length ? undefined : this.t('urls.needChannel'),
        action: () => void this.reset(this.channelScope(channels)),
      },
      {
        id: 'resetArea',
        label: this.t('urls.resetArea'),
        icon: 'restart_alt',
        disabledReason: areas.length ? undefined : this.t('urls.needArea'),
        action: () => void this.reset(this.areaScope(areas)),
      },
      { id: 'resetAll', label: this.t('urls.resetAll'), icon: 'restart_alt', danger: true, separatorBefore: true, action: () => void this.resetAll() },
    ];
  });

  /** The error of the inline edit, once Save was tried. */
  protected readonly editError = computed(() => {
    const edit = this.editing();
    if (!edit?.submitted) {
      return null;
    }
    const value = edit.value.trim();
    if (!value.startsWith('/') || /[\s?#]/.test(value)) {
      return this.t('urls.errors.format');
    }
    const row = this.rows().find((r) => r.id === edit.id);
    const clash = this.rows().find((r) => r.id !== edit.id && r.url === value && r.area === row?.area);
    return clash ? this.t('urls.errors.used', { target: clash.target }) : null;
  });

  constructor() {
    const id = this.query.get('uedit') ?? (this.query.get('uerror') === '1' ? 'u-4' : null);
    const row = this.rows().find((r) => r.id === id);
    if (row) {
      // `uerror=1`: a URL another target already has.
      const clash = this.query.get('uerror') === '1';
      this.editing.set({ id: row.id, value: clash ? '/en/about/team.html' : row.url, submitted: clash });
    }
    effect(() => this.query.set({ uedit: this.editing()?.id ?? null }));
    inject(DestroyRef).onDestroy(() => this.query.set({ uedit: null, uerror: null, uempty: null }));
  }

  protected assigned(row: RegisteredUrl): number {
    return minutesAgo(row.assignedMinutes, this.now);
  }

  protected startEdit(row: RegisteredUrl): void {
    this.editing.set({ id: row.id, value: row.url, submitted: false });
  }

  protected setEdit(value: string): void {
    this.editing.update((e) => (e ? { ...e, value, submitted: false } : e));
  }

  protected saveEdit(): void {
    const edit = this.editing();
    if (!edit) {
      return;
    }
    this.editing.set({ ...edit, submitted: true });
    if (this.editError()) {
      return;
    }
    const url = edit.value.trim();
    this.rows.update((rows) => rows.map((r) => (r.id === edit.id ? { ...r, url, overridden: true } : r)));
    this.editing.set(null);
    this.state.notice();
  }

  protected resetRow(row: RegisteredUrl): Promise<void> {
    return this.reset({
      title: this.t('urls.resetRowTitle'),
      message: this.t('urls.resetRowMessage', { url: row.url }),
      confirmLabel: this.t('urls.resetRow'),
      matches: (r) => r.id === row.id,
    });
  }

  protected resetAsset(row: RegisteredUrl): Promise<void> {
    return this.reset({
      title: this.t('urls.resetAssetTitle', { name: row.target }),
      message: this.t('urls.resetAssetMessage', { count: this.rows().filter((r) => r.target === row.target).length, name: row.target }),
      confirmLabel: this.t('urls.resetAsset'),
      matches: (r) => r.target === row.target,
    });
  }

  private channelScope(channels: readonly string[]): ResetScope {
    const list = channels.join(', ');
    return {
      title: this.t('urls.resetChannelTitle', { channel: list }),
      message: this.t('urls.resetChannelMessage', { channel: list }),
      confirmLabel: this.t('urls.resetChannel'),
      matches: (r) => channels.includes(r.channel),
    };
  }

  private areaScope(areas: readonly string[]): ResetScope {
    const list = areas.map((a) => this.t(`urls.area.${a}`)).join(', ');
    return {
      title: this.t('urls.resetAreaTitle', { area: list }),
      message: this.t('urls.resetAreaMessage', { area: list }),
      confirmLabel: this.t('urls.resetArea'),
      matches: (r) => areas.includes(r.area),
    };
  }

  /** Asks (plainly: the resets cannot be undone), then removes the matching URLs or, with `uerror=2`, fails. */
  private async reset(scope: ResetScope): Promise<void> {
    const confirmed = await this.confirms.confirm({
      title: scope.title,
      message: scope.message,
      confirmLabel: scope.confirmLabel,
      tone: 'danger',
      irreversible: true,
    });
    if (confirmed) {
      this.finish(() => this.rows.update((rows) => rows.filter((r) => !scope.matches(r))));
    }
  }

  private async resetAll(): Promise<void> {
    const confirmed = await this.confirms.confirm({
      title: this.t('urls.resetAllTitle'),
      message: this.t('urls.resetAllMessage', { count: this.rows().length, key: PROJECT_KEY }),
      confirmLabel: this.t('urls.resetAllConfirm'),
      tone: 'danger',
      typeToConfirm: PROJECT_KEY,
      irreversible: true,
    });
    if (confirmed) {
      this.finish(() => this.rows.set([]));
    }
  }

  private finish(apply: () => void): void {
    if (this.resetFails) {
      this.toasts.show(this.t('urls.resetFailed'), 'error');
      return;
    }
    apply();
    this.toasts.show(this.t('urls.resetComplete'), 'success');
  }
}
