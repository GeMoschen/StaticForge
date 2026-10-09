import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Subject, catchError, debounceTime, of, switchMap, tap } from 'rxjs';
import { ApiClient } from '../../../core/api/api.client';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { problemOf } from '../../../core/api/problem.util';
import { LocalesStore } from '../../../core/project/locales.store';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../shared/components/dialog/sf-dialog.component';
import { SfComboboxComponent, SfComboboxOption } from '../../../shared/components/forms/sf-combobox.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfRadioGroupComponent, SfRadioOption } from '../../../shared/components/forms/sf-radio-group.component';
import { SfSelectComponent, SfSelectOption } from '../../../shared/components/forms/sf-select.component';
import { SfBannerComponent } from '../../../shared/components/layout/sf-banner.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { indexFileNameOf, normalizeSourcePath, normalizeTargetPath } from '../../settings/redirect.util';
import { type RedirectRequest, type RedirectView, RedirectsService } from '../../settings/redirects.service';

type ChannelView = components['schemas']['ChannelView'];

/** How many pages the picker lists for the text typed. */
const PAGE_RESULTS = 20;
const SEARCH_DELAY = 250;
const ABSOLUTE_URL = /^https?:\/\//i;

type TargetKind = 'page' | 'path';

/**
 * The form's values; `submitted` shows the errors, `saving` locks it while the request runs. An empty `channel` or
 * `locale` is not chosen yet: the project's default stands in.
 */
interface RedirectDraft {
  channel: string;
  locale: string;
  from: string;
  toKind: TargetKind;
  page: string | null;
  /** The chosen page's name, for the picker's entry before (or without) a search that finds it. */
  pageName: string;
  /** Which page of a paginated page the redirect leads to; kept as it was, 1 for a page picked here. */
  pageNumber: number;
  path: string;
  submitted: boolean;
  saving: boolean;
}

/** What the server refused, by the field it belongs to. */
interface ServerErrors {
  from?: string;
  to?: string;
  general?: string;
}

/** A stored output path (`en/news/a.html`) as the URL path the user knows (`/en/news/a.html`). */
export function displayPath(path: string | null | undefined): string {
  return !path || ABSOLUTE_URL.test(path) ? (path ?? '') : `/${path.replace(/^\//, '')}`;
}

/**
 * Add or edit a redirect (gate decision 205): the old path as the user knows the URL (shown as it is saved), the
 * channel, the language (only in a project with languages), and a page — searched by name — or a path or absolute URL
 * to lead to. Every row is editable, automatic ones too (saving makes them manual). The server's refusals show on the
 * field they belong to. A redirect that changed or vanished meanwhile (`409` / `404`) keeps the dialog open with a
 * banner: Reload reads the redirect again and keeps what was typed, so the next Save is made against the current
 * version (the list is asked to reload too, `stale`).
 */
@Component({
  selector: 'sf-redirect-dialog',
  standalone: true,
  imports: [
    SfBannerComponent,
    SfButtonComponent,
    SfComboboxComponent,
    SfDialogComponent,
    SfDialogFooterDirective,
    SfFieldComponent,
    SfInputComponent,
    SfRadioGroupComponent,
    SfSelectComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './redirect-dialog.component.html',
  styleUrl: './redirect-dialog.component.scss',
})
export class RedirectDialogComponent implements OnInit {
  readonly projectKey = input.required<string>();
  /** The redirect to edit; `null` adds one. */
  readonly redirect = input<RedirectView | null>(null);
  readonly channels = input<readonly ChannelView[]>([]);

  readonly saved = output<RedirectView>();
  /** The dialog re-read the redirect after a conflict: the list is out of date too. */
  readonly stale = output<void>();
  readonly closed = output<void>();

  private readonly api = inject(RedirectsService);
  private readonly assets = inject(ApiClient);
  private readonly transloco = inject(TranslocoService);
  private readonly locales = inject(LocalesStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly searches = new Subject<string>();

  protected readonly draft = signal<RedirectDraft>({
    channel: '',
    locale: '',
    from: '',
    toKind: 'page',
    page: null,
    pageName: '',
    pageNumber: 1,
    path: '',
    submitted: false,
    saving: false,
  });
  protected readonly serverErrors = signal<ServerErrors>({});
  protected readonly searching = signal(false);
  /** The redirect changed or vanished since it was opened. */
  protected readonly conflict = signal(false);
  protected readonly reloading = signal(false);
  /** The version Save compares with: the opened redirect's, or the one Reload read. */
  private readonly version = signal<number | null>(null);
  private readonly found = signal<readonly SfComboboxOption<string>[]>([]);

  protected readonly localized = this.locales.isLocalized;
  protected readonly editing = computed(() => this.redirect() !== null);
  protected readonly automatic = computed(() => this.redirect()?.kind === 'AUTO');
  protected readonly title = computed(() => this.t(this.editing() ? 'editTitle' : 'newTitle'));

  protected readonly channel = computed(
    () => this.draft().channel || (this.channels().find((c) => c.isDefault) ?? this.channels()[0])?.key || '',
  );
  protected readonly locale = computed(
    () => this.draft().locale || this.locales.defaultLocale() || this.locales.locales()[0]?.code || '',
  );
  protected readonly channelOptions = computed<SfSelectOption<string>[]>(() =>
    this.channels().map((c) => ({ value: c.key ?? '', label: c.name || (c.key ?? '') })),
  );
  protected readonly langOptions = computed<SfSelectOption<string>[]>(() =>
    this.locales.locales().map((l) => ({ value: l.code ?? '', label: l.label || (l.code ?? '').toUpperCase() })),
  );
  protected readonly toOptions = computed<SfRadioOption<TargetKind>[]>(() => [
    { value: 'page', label: this.t('toPage') },
    { value: 'path', label: this.t('toPath') },
  ]);
  /** The found pages, with the chosen one always present so its name stays shown while the search moves on. */
  protected readonly pageOptions = computed<SfComboboxOption<string>[]>(() => {
    const { page, pageName } = this.draft();
    const options = [...this.found()];
    if (page && !options.some((o) => o.value === page)) {
      options.unshift({ value: page, label: pageName });
    }
    return options;
  });

  private readonly indexFileName = computed(() => indexFileNameOf(this.channels().find((c) => c.key === this.channel())));
  private readonly source = computed(() => {
    const from = this.draft().from;
    return from.trim() ? normalizeSourcePath(from, this.indexFileName()) : null;
  });
  private readonly target = computed(() => {
    const path = this.draft().path;
    return path.trim() ? normalizeTargetPath(path, this.indexFileName()) : null;
  });

  /** The old path as it would be saved, once it is valid. */
  protected readonly savedAs = computed(() => {
    const path = this.source()?.path;
    return path ? this.t('savedAs', { path: displayPath(path) }) : '';
  });
  protected readonly errors = computed(() => {
    const d = this.draft();
    const server = this.serverErrors();
    const fromKey = !d.from.trim() ? 'fromEmpty' : this.source()?.error;
    const toKey = d.toKind === 'page' ? (d.page ? null : 'pageEmpty') : !d.path.trim() ? 'toEmpty' : this.target()?.error;
    return {
      from: server.from ?? (d.submitted && fromKey ? this.t(`errors.${fromKey}`) : null),
      to: server.to ?? (d.submitted && toKey ? this.t(`errors.${toKey}`) : null),
    };
  });

  constructor() {
    this.searches
      .pipe(
        debounceTime(SEARCH_DELAY),
        tap(() => this.searching.set(true)),
        switchMap((q) =>
          this.assets
            .listAssets(this.projectKey(), { type: 'PAGE', q: q.trim() || undefined, size: PAGE_RESULTS })
            .pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        this.searching.set(false);
        if (result) {
          this.found.set(
            (result.content ?? []).map((a) => ({ value: a.uuid ?? '', label: a.displayName || a.uid || '', description: a.folderPath })),
          );
        }
      });
  }

  ngOnInit(): void {
    const redirect = this.redirect();
    if (redirect) {
      this.version.set(redirect.version ?? null);
      this.draft.update((d) => ({
        ...d,
        channel: redirect.channel ?? '',
        locale: redirect.locale ?? '',
        from: displayPath(redirect.fromPath),
        toKind: redirect.toAssetUuid ? 'page' : 'path',
        page: redirect.toAssetUuid ?? null,
        pageName: redirect.toAssetName || (redirect.toAssetUuid ? this.transloco.translate('publishing.redirects.deletedPage') : ''),
        pageNumber: redirect.toPageNumber ?? 1,
        path: displayPath(redirect.toPath),
      }));
    }
    this.searches.next('');
  }

  protected patch(change: Partial<RedirectDraft>): void {
    this.draft.update((d) => ({ ...d, ...change }));
    this.serverErrors.set({});
  }

  protected onPage(uuid: string | null): void {
    const redirect = this.redirect();
    this.patch({
      page: uuid,
      pageName: this.pageOptions().find((o) => o.value === uuid)?.label ?? '',
      pageNumber: uuid && uuid === redirect?.toAssetUuid ? (redirect.toPageNumber ?? 1) : 1,
    });
  }

  protected onPageQuery(text: string): void {
    // Choosing an entry writes its name into the field; that is not a new search.
    if (text !== this.draft().pageName) {
      this.searches.next(text);
    }
  }

  protected save(): void {
    const d = this.draft();
    if (d.saving) {
      return;
    }
    this.patch({ submitted: true });
    const { from, to } = this.errors();
    const existing = this.redirect();
    // A redirect is replaced at the version read: without one there is nothing to compare with.
    if (from || to || (existing && this.version() === null)) {
      return;
    }
    const body: RedirectRequest = {
      channel: this.channel(),
      locale: this.localized() ? this.locale() : '',
      fromPath: this.source()!.path,
      ...(d.toKind === 'page' ? { toAssetUuid: d.page!, toPageNumber: d.pageNumber } : { toPath: this.target()!.path }),
    };
    const key = this.projectKey();
    const request =
      existing?.id != null ? this.api.update(key, existing.id, this.version()!, body) : this.api.create(key, body);
    this.patch({ saving: true });
    request.subscribe({
      next: (view) => {
        this.saved.emit(view);
        this.closed.emit();
      },
      error: (err: unknown) => {
        this.patch({ saving: false });
        this.onFailure(err);
      },
    });
  }

  /** After a conflict: reads the redirect as it is now; the form keeps what was typed. */
  protected reload(): void {
    const id = this.redirect()?.id;
    if (id == null || this.reloading()) {
      return;
    }
    this.reloading.set(true);
    this.api.get(this.projectKey(), id).subscribe({
      next: (view) => {
        this.reloading.set(false);
        this.version.set(view.version ?? null);
        this.conflict.set(false);
        this.stale.emit();
      },
      error: (err: unknown) => {
        this.reloading.set(false);
        const gone = problemOf(err).status === 404;
        this.conflict.set(false);
        this.serverErrors.set({ general: this.t(gone ? 'gone' : 'saveFailed') });
      },
    });
  }

  private onFailure(err: unknown): void {
    const problem = problemOf(err, this.t('saveFailed'));
    if ((problem.status === 409 && problem.code === 'SF-API-0409') || problem.status === 404) {
      this.conflict.set(true);
    } else if (problem.code === 'SF-DOM-0191' || problem.field === 'fromPath') {
      this.serverErrors.set({ from: problem.detail });
    } else if (problem.code === 'SF-DOM-0192' || problem.field === 'toPath' || problem.field === 'toAssetUuid') {
      this.serverErrors.set({ to: problem.detail });
    } else {
      this.serverErrors.set({ general: problem.detail });
    }
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`publishing.redirects.dialog.${key}`, params);
  }
}
