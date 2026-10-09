import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { SfDataTableColumn, SfDataTableFilter } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfComboboxComponent, SfComboboxOption } from '../../../../shared/components/forms/sf-combobox.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfRadioGroupComponent, SfRadioOption } from '../../../../shared/components/forms/sf-radio-group.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfBannerComponent } from '../../../../shared/components/layout/sf-banner.component';
import { SfMenuComponent, SfMenuItem } from '../../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SfTooltipDirective } from '../../../../shared/directives/sf-tooltip.directive';
import { injectSampleQuery, minutesAgo } from '../changes/sample-area.util';
import { DEFAULT_TARGET, LAST_FINISHED_RUN, PAGES, PROJECT_KEY, REDIRECTS, RedirectState, SAMPLE_CHANNELS, SampleRedirect, pageById, runById } from './publishing-data';
import { PublishingState } from './publishing-state';
import { REDIRECT_STATE_ICONS, REDIRECT_STATE_TONES } from './publishing-status';

const STATES: readonly RedirectState[] = ['active', 'shadowed', 'dangling', 'loop'];
/** The language filter's value for redirects on a channel without languages. */
const NO_LANGUAGE = '—';
/** How long the demo Save shows its spinner. */
export const SAVE_DELAY = 700;

/** The dialog's form: `id` null is a new redirect. */
interface RedirectDraft {
  id: string | null;
  from: string;
  channel: string;
  lang: string;
  toKind: 'page' | 'path';
  page: string | null;
  path: string;
  /** Save was tried: the errors show. */
  submitted: boolean;
  saving: boolean;
}

/**
 * The old path as it is saved: a leading slash, no doubled slashes, and a trailing slash unless the last segment is a
 * file name (it has a dot) — `news/old` is saved as `/news/old/`.
 */
export function normalizeOldPath(value: string): string {
  const path = '/' + value.trim().replace(/\/{2,}/g, '/').replace(/^\//, '');
  const last = path.split('/').pop() ?? '';
  return path === '/' || last === '' || last.includes('.') ? path : `${path}/`;
}

/**
 * Publishing › Redirects: old paths and where they lead, in an `sf-data-table` with its path search and filters
 * (channel, language, kind, state) as removable chips; the state explains itself in a tooltip and is "as of" the last
 * run on the default target. Every row is editable (the ⋮ menu, or a click on it): the Add / Edit dialog takes the old
 * path (normalised as typed), the channel and language, and a page or a path / absolute URL to lead to. Automatic
 * rows name the run that made them (a link into Runs), manual ones who and when. "Delete all manual redirects" sits in
 * the bar's ⋮ menu, asks for the project key, and is hidden when there is nothing to delete.
 *
 * Query parameters: `rdialog=new` or `rdialog=<redirect id>` (the dialog), `rerror=1` (the dialog with an old path
 * that has a query) or `rerror=2` (an empty old path), `rsaving=1` (the dialog while saving), `rconflict=1` (the
 * conflict banner), `nobuild=1` (nothing published yet), `rempty=1` (no redirects at all).
 */
@Component({
  selector: 'sf-sample-redirects',
  standalone: true,
  imports: [
    SfBannerComponent,
    SfButtonComponent,
    SfComboboxComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfDialogComponent,
    SfDialogFooterDirective,
    SfFieldComponent,
    SfInputComponent,
    SfMenuComponent,
    SfRadioGroupComponent,
    SfRelativeTimeComponent,
    SfSelectComponent,
    SfStatusComponent,
    SfTooltipDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-redirects.component.html',
  styleUrl: './sample-redirects.component.scss',
})
export class SampleRedirectsComponent {
  protected readonly state = inject(PublishingState);
  protected readonly t = this.state.t;
  private readonly confirms = inject(ConfirmService);
  private readonly query = injectSampleQuery();
  private readonly destroyRef = inject(DestroyRef);
  private readonly now = Date.now();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly run = LAST_FINISHED_RUN;
  protected readonly target = DEFAULT_TARGET;
  /** Nothing is published on the default target yet, so no state can be told. */
  protected readonly noBuild = signal(this.query.get('nobuild') === '1');
  protected readonly conflict = signal(this.query.get('rconflict') === '1');
  protected readonly rows = signal<readonly SampleRedirect[]>(this.query.get('rempty') === '1' ? [] : REDIRECTS);
  protected readonly draft = signal<RedirectDraft | null>(null);
  protected readonly tones = REDIRECT_STATE_TONES;
  protected readonly icons = REDIRECT_STATE_ICONS;
  protected readonly rowKey = (row: SampleRedirect) => row.id;
  protected readonly rowLabel = (row: SampleRedirect) => row.from;

  protected readonly columns = computed<SfDataTableColumn<SampleRedirect>[]>(() => {
    const h = (id: string) => this.t(`redirects.columns.${id}`);
    return [
      { id: 'from', header: h('from'), value: (r) => r.from, sortable: true, hideable: false, width: 260 },
      { id: 'to', header: h('to'), value: (r) => r.to, width: 260 },
      { id: 'channel', header: h('channel'), value: (r) => this.channelName(r.channel), sortable: true, searchable: false, width: 100 },
      { id: 'lang', header: h('lang'), value: (r) => r.lang, sortable: true, searchable: false, width: 100 },
      { id: 'kind', header: h('kind'), value: (r) => r.kind, sortable: true, searchable: false, width: 110 },
      { id: 'state', header: h('state'), value: (r) => r.state, sortable: true, searchable: false, width: 130 },
      { id: 'created', header: h('created'), value: (r) => r.createdMinutes, sortable: true, searchable: false, width: 200 },
      { id: 'actions', header: h('actions'), width: 64, align: 'end', hideable: false, searchable: false },
    ];
  });

  protected readonly filters = computed<SfDataTableFilter<SampleRedirect>[]>(() => {
    const filters: SfDataTableFilter<SampleRedirect>[] = [
      {
        id: 'channel',
        label: this.t('redirects.columns.channel'),
        options: SAMPLE_CHANNELS.map((c) => ({ value: c.name, label: c.name })),
      },
      {
        id: 'lang',
        label: this.t('redirects.columns.lang'),
        options: [
          { value: 'DE', label: 'DE' },
          { value: 'EN', label: 'EN' },
          { value: NO_LANGUAGE, label: this.t('redirects.noLanguage') },
        ],
      },
      {
        id: 'kind',
        label: this.t('redirects.columns.kind'),
        options: (['auto', 'manual'] as const).map((k) => ({ value: k, label: this.t(`redirects.kind.${k}`) })),
      },
    ];
    // Without a published build there is no state to filter by.
    if (!this.noBuild()) {
      filters.push({
        id: 'state',
        label: this.t('redirects.columns.state'),
        options: STATES.map((s) => ({ value: s, label: this.t(`redirects.state.${s}`) })),
      });
    }
    return filters;
  });

  protected readonly manualCount = computed(() => this.rows().filter((r) => r.kind === 'manual').length);

  protected readonly moreActions = computed<SfMenuItem[]>(() => [
    { id: 'deleteManual', label: this.t('redirects.deleteManual'), icon: 'delete_sweep', danger: true, action: () => void this.deleteManual() },
  ]);

  protected readonly channelOptions = computed<SfSelectOption<string>[]>(() => SAMPLE_CHANNELS.map((c) => ({ value: c.id, label: c.name })));
  protected readonly langOptions: SfSelectOption<string>[] = [
    { value: 'DE', label: 'DE' },
    { value: 'EN', label: 'EN' },
  ];
  protected readonly toOptions = computed<SfRadioOption<'page' | 'path'>[]>(() => [
    { value: 'page', label: this.t('redirects.dialog.toPage') },
    { value: 'path', label: this.t('redirects.dialog.toPath') },
  ]);
  protected readonly pageOptions = computed<SfComboboxOption<string>[]>(() =>
    PAGES.map((p) => ({ value: p.id, label: p.name, description: p.path })),
  );

  protected readonly dialogTitle = computed(() => (this.draft()?.id ? this.t('redirects.dialog.editTitle') : this.t('redirects.dialog.newTitle')));
  protected readonly localized = computed(() => SAMPLE_CHANNELS.find((c) => c.id === this.draft()?.channel)?.localized ?? true);
  /** The old path as it would be saved, once it is valid. */
  protected readonly savedAs = computed(() => {
    const d = this.draft();
    return d && !this.fromError(d) ? this.t('redirects.dialog.savedAs', { path: normalizeOldPath(d.from) }) : '';
  });
  protected readonly errors = computed(() => {
    const d = this.draft();
    return {
      from: d?.submitted ? this.fromError(d) : null,
      to: d?.submitted ? this.toError(d) : null,
    };
  });

  constructor() {
    const open = this.query.get('rdialog');
    const rerror = this.query.get('rerror');
    if (open === 'new' || rerror) {
      this.newRedirect();
    } else if (open) {
      const row = this.rows().find((r) => r.id === open);
      if (row) {
        this.edit(row);
      }
    }
    if (rerror) {
      this.patch({ from: rerror === '2' ? '' : '/old/page?utm=1', submitted: true });
    }
    if (this.query.get('rsaving') === '1' && this.draft()) {
      this.patch({ submitted: true, saving: true });
    }

    effect(() => this.query.set({ rdialog: this.draft()?.id ?? (this.draft() ? 'new' : null) }));
    this.destroyRef.onDestroy(() => {
      this.query.set({ rdialog: null, rerror: null, rsaving: null, rconflict: null, nobuild: null, rempty: null });
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
      }
    });
  }

  protected created(row: SampleRedirect): number {
    return minutesAgo(row.createdMinutes, this.now);
  }

  protected channelName(id: string): string {
    return SAMPLE_CHANNELS.find((c) => c.id === id)?.name ?? id;
  }

  protected rowActions(row: SampleRedirect): SfMenuItem[] {
    return [
      { id: 'edit', label: this.t('redirects.edit'), icon: 'edit', action: () => this.edit(row) },
      { id: 'delete', label: this.t('redirects.delete'), icon: 'delete', danger: true, separatorBefore: true, action: () => void this.delete(row) },
    ];
  }

  protected openRun(row: SampleRedirect): void {
    const run = runById(`r-${row.run}`);
    if (run) {
      this.state.openRun(run.id);
    }
  }

  protected reload(): void {
    this.conflict.set(false);
    this.state.notice('redirects.reloaded');
  }

  protected newRedirect(): void {
    this.draft.set({ id: null, from: '', channel: 'html', lang: 'EN', toKind: 'page', page: null, path: '', submitted: false, saving: false });
  }

  protected edit(row: SampleRedirect): void {
    const page = row.toPageId ?? null;
    this.draft.set({
      id: row.id,
      from: row.from,
      channel: row.channel,
      lang: row.lang === NO_LANGUAGE ? 'EN' : row.lang,
      toKind: page ? 'page' : 'path',
      page,
      path: page ? '' : row.to,
      submitted: false,
      saving: false,
    });
  }

  protected patch(change: Partial<RedirectDraft>): void {
    this.draft.update((d) => (d ? { ...d, ...change } : d));
  }

  protected close(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.draft.set(null);
  }

  /** Validates, then shows the spinner for a moment (the real Save is a request) and closes with the toast. */
  protected save(): void {
    const d = this.draft();
    if (!d || d.saving) {
      return;
    }
    this.patch({ submitted: true });
    if (this.fromError(d) || this.toError(d)) {
      return;
    }
    this.patch({ saving: true });
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.close();
      this.state.notice();
    }, SAVE_DELAY);
  }

  private fromError(d: RedirectDraft): string | null {
    const value = d.from.trim();
    if (!value) {
      return this.t('redirects.dialog.errors.fromEmpty');
    }
    return /[?#]/.test(value) ? this.t('redirects.dialog.errors.fromQuery') : null;
  }

  private toError(d: RedirectDraft): string | null {
    if (d.toKind === 'page') {
      return d.page && pageById(d.page) ? null : this.t('redirects.dialog.errors.pageEmpty');
    }
    return /^(\/|https?:\/\/)\S+$/.test(d.path.trim()) ? null : this.t('redirects.dialog.errors.pathInvalid');
  }

  private async delete(row: SampleRedirect): Promise<void> {
    const confirmed = await this.confirms.confirm({
      title: this.t('redirects.deleteOneTitle'),
      message: this.t('redirects.deleteOneMessage', { path: row.from }),
      confirmLabel: this.t('redirects.delete'),
      tone: 'danger',
    });
    if (confirmed) {
      this.rows.update((rows) => rows.filter((r) => r.id !== row.id));
      this.state.notice('redirects.deletedOne');
    }
  }

  private async deleteManual(): Promise<void> {
    const count = this.manualCount();
    const confirmed = await this.confirms.confirm({
      title: this.t('redirects.deleteTitle', { count }),
      message: this.t('redirects.deleteMessage', { key: PROJECT_KEY }),
      confirmLabel: this.t('redirects.deleteConfirm', { count }),
      tone: 'danger',
      typeToConfirm: PROJECT_KEY,
      irreversible: true,
    });
    if (confirmed) {
      this.rows.update((rows) => rows.filter((r) => r.kind !== 'manual'));
      this.state.notice('redirects.deleted', { count });
    }
  }
}
