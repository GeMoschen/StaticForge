import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectMembersStore } from '../../core/project/project-members.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { ChannelsService } from '../channels/channels.service';
import { localeTag } from '../release/release-status.util';
import { RedirectDialogComponent } from './redirect-dialog.component';
import { REDIRECT_KINDS, REDIRECT_STATES, kindLabel, stateExplanation, stateLabel } from './redirect.util';
import { type RedirectKind, type RedirectState, type RedirectView, RedirectsService } from './redirects.service';

type ChannelView = components['schemas']['ChannelView'];

const PAGE_SIZE = 50;

type FilterKey = 'channel' | 'locale' | 'kind' | 'state' | 'q';

/**
 * Project settings tab "Redirects" (M30.6.3): the project's redirect registry — automatic entries the builds detect
 * when a page's path changes, and manual ones — each with its state against the default target's current build.
 * Filters live in the URL (linkable) and show as removable chips. Developers add, edit (`If-Match`) and delete manual
 * redirects; everyone else, and everyone during time travel or in an archived project, reads.
 */
@Component({
  selector: 'sf-project-settings-redirects',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    SfButtonComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    SfSpinnerComponent,
    RedirectDialogComponent,
  ],
  templateUrl: './project-settings-redirects.component.html',
  styleUrl: './project-settings-redirects.component.scss',
})
export class ProjectSettingsRedirectsComponent {
  private readonly api = inject(RedirectsService);
  private readonly channelsApi = inject(ChannelsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);
  protected readonly locales = inject(LocalesStore);
  protected readonly members = inject(ProjectMembersStore);
  protected readonly permissions = inject(ProjectPermissionsStore);
  protected readonly access = inject(ProjectAccessStore);

  readonly projectKey = input.required<string>();
  /** Filters and the page, bound from the query string. */
  readonly channel = input<string | undefined>();
  readonly locale = input<string | undefined>();
  readonly kind = input<string | undefined>();
  readonly state = input<string | undefined>();
  readonly q = input<string | undefined>();
  readonly page = input<string | undefined>();

  protected readonly kindOptions = REDIRECT_KINDS;
  protected readonly stateOptions = REDIRECT_STATES;
  protected readonly kindLabel = kindLabel;
  protected readonly stateLabel = stateLabel;
  protected readonly stateExplanation = stateExplanation;
  protected readonly localeTag = localeTag;

  protected readonly channels = signal<ChannelView[]>([]);
  protected readonly rows = signal<RedirectView[]>([]);
  protected readonly total = signal(0);
  protected readonly totalPages = signal(0);
  /** The default target's build the states were computed against; `null` while nothing is published there. */
  protected readonly basisRunId = signal<number | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  /** A delete refused with a stale version: the list is out of date. */
  protected readonly conflict = signal<string | null>(null);
  protected readonly busyId = signal<number | null>(null);
  /** The add/edit dialog: `null` closed, `{ redirect: null }` adds. */
  protected readonly dialog = signal<{ redirect: RedirectView | null } | null>(null);
  /** Bumped to re-read the current page after a write. */
  private readonly reloads = signal(0);
  private request: Subscription | null = null;

  protected readonly pageIndex = computed(() => Math.max(0, Number(this.page() ?? 0) || 0));
  protected readonly canEdit = this.permissions.canEditRedirects;
  protected readonly hasFilters = computed(() => this.activeFilters().length > 0);
  protected readonly activeFilters = computed(() => {
    const chips: { key: FilterKey; label: string }[] = [];
    if (this.channel()) {
      chips.push({ key: 'channel', label: `Channel: ${this.channelName(this.channel())}` });
    }
    if (this.locale()) {
      chips.push({ key: 'locale', label: `Language: ${localeTag(this.locale())}` });
    }
    if (this.kind()) {
      chips.push({ key: 'kind', label: `Kind: ${kindLabel(this.kind())}` });
    }
    if (this.state()) {
      chips.push({ key: 'state', label: `State: ${stateLabel(this.state())}` });
    }
    if (this.q()) {
      chips.push({ key: 'q', label: `Path contains “${this.q()}”` });
    }
    return chips;
  });

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
      const query = {
        channel: this.channel(),
        locale: this.locale(),
        kind: this.kind() as RedirectKind | undefined,
        state: this.state() as RedirectState | undefined,
        q: this.q(),
        page: this.pageIndex(),
        size: PAGE_SIZE,
      };
      this.reloads();
      untracked(() => this.load(key, query));
    });
  }

  protected channelName(key: string | null | undefined): string {
    const channel = this.channels().find((c) => c.key === key);
    return channel?.name || key || '';
  }

  protected setFilter(key: Exclude<FilterKey, 'q'>, event: Event): void {
    this.navigate({ [key]: (event.target as HTMLSelectElement).value || null, page: null });
  }

  protected setText(event: Event): void {
    this.navigate({ q: (event.target as HTMLInputElement).value.trim() || null, page: null });
  }

  protected clearFilter(key: FilterKey): void {
    this.navigate({ [key]: null, page: null });
  }

  protected goToPage(page: number): void {
    this.navigate({ page: page > 0 ? page : null });
  }

  protected reload(): void {
    this.conflict.set(null);
    this.reloads.update((n) => n + 1);
  }

  protected add(): void {
    this.dialog.set({ redirect: null });
  }

  protected edit(row: RedirectView): void {
    this.dialog.set({ redirect: row });
  }

  protected onSaved(view: RedirectView): void {
    this.toast.show(`Redirect from ${view.fromPath} saved.`, 'success');
    this.reload();
  }

  protected remove(row: RedirectView): void {
    if (row.id == null || this.busyId() !== null || !this.canEdit()) {
      return;
    }
    if (!window.confirm(`Delete the redirect from “${row.fromPath}”? Requests for that path will no longer be sent on.`)) {
      return;
    }
    this.busyId.set(row.id);
    this.api.delete(this.projectKey(), row.id, row.version ?? 0).subscribe({
      next: () => {
        this.busyId.set(null);
        this.toast.show(`Redirect from ${row.fromPath} deleted.`, 'success');
        this.reload();
      },
      error: (err: unknown) => {
        this.busyId.set(null);
        const problem = problemOf(err, 'Could not delete the redirect — try again.');
        if (problem.status === 409 && problem.code === 'SF-API-0409') {
          this.conflict.set(`Someone changed the redirect from “${row.fromPath}” in the meantime. Reload the list and check it before deleting.`);
        } else if (problem.status === 404) {
          this.conflict.set(`The redirect from “${row.fromPath}” was already deleted. Reload the list.`);
        } else {
          this.toast.show(problem.detail, 'error');
        }
      },
    });
  }

  /** What the Target column says: the page's current name (a missing page is "Deleted page") or the fixed path. */
  protected targetName(row: RedirectView): string {
    if (!row.toAssetUuid) {
      return row.toPath ?? '';
    }
    const name = row.toAssetName || 'Deleted page';
    return row.toPageNumber && row.toPageNumber > 1 ? `${name} (page ${row.toPageNumber})` : name;
  }

  private navigate(params: Record<string, string | number | null>): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: params, queryParamsHandling: 'merge' });
  }

  private load(
    key: string,
    query: { channel?: string; locale?: string; kind?: RedirectKind; state?: RedirectState; q?: string; page: number; size: number },
  ): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.request = this.api.list(key, query).subscribe({
      next: (page) => {
        this.loading.set(false);
        this.rows.set(page.rows ?? []);
        this.total.set(page.totalElements ?? 0);
        this.totalPages.set(page.totalPages ?? 0);
        this.basisRunId.set(page.basisRunId ?? null);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(problemOf(err, 'Could not load the redirects — try again in a moment.').detail);
      },
    });
  }
}
