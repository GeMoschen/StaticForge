import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { ChannelsService } from '../channels/channels.service';
import { DialogService } from '../../core/ui/dialog.service';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfTableComponent } from '../../shared/components/sf-table.component';
import {
  UrlArea,
  UrlRegistryEntryView,
  UrlRegistryService,
  UrlTargetType,
  outputLabel,
  overrideErrorMessage,
  targetTypeLabel,
} from './url-registry.service';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { LocalesStore } from '../../core/project/locales.store';

const PAGE_SIZE = 20;

/** What a pending reset confirmation will delete — drives both the dialog copy and the actual request. */
type ResetScope =
  | { kind: 'entry'; entry: UrlRegistryEntryView }
  | { kind: 'asset'; entry: UrlRegistryEntryView }
  | { kind: 'channel'; channelKey: string }
  | { kind: 'area'; area: UrlArea }
  | { kind: 'project' };

/**
 * Project settings tab: "URLs" — the URL registry (M8.2, every output since M32): the URL of every page (each page of a
 * paginated page), media file and variant, and folder without an index page, per channel, area and language. A URL is
 * assigned once and decides where a build writes the output; this screen browses, overrides and resets them.
 */
@Component({
  selector: 'sf-project-settings-url-registry',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    SfButtonComponent,
    SfEmptyStateComponent,
    SfFieldComponent,
    SfSpinnerComponent,
    SfTableComponent,
  ],
  templateUrl: './project-settings-url-registry.component.html',
  styleUrl: './project-settings-url-registry.component.scss',
})
export class ProjectSettingsUrlRegistryComponent {
  readonly projectKey = input.required<string>();

  private readonly api = inject(UrlRegistryService);
  private readonly channelsApi = inject(ChannelsService);
  private readonly toasts = inject(ToastService);
  protected readonly dialog = inject(DialogService);

  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;

  protected readonly entries = signal<UrlRegistryEntryView[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly page = signal(0);
  protected readonly totalPages = signal(0);
  protected readonly totalElements = signal(0);

  protected readonly channelOptions = signal<string[]>([]);
  protected readonly filterChannel = signal('');
  protected readonly filterArea = signal<'' | UrlArea>('');
  protected readonly filterType = signal<'' | UrlTargetType>('');
  /** `null` = every language; `''` = rows without a language. */
  protected readonly filterLocale = signal<string | null>(null);
  protected readonly search = signal('');

  protected readonly locales = inject(LocalesStore).locales;
  protected readonly typeLabel = targetTypeLabel;
  protected readonly editError = signal<string | null>(null);

  protected readonly editingId = signal<number | null>(null);
  protected readonly editUrl = signal('');
  protected readonly saving = signal(false);

  protected readonly pendingReset = signal<ResetScope | null>(null);
  protected readonly resetting = signal(false);

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => {
        this.loadChannelOptions(key);
        this.reload();
      });
    });
  }

  private loadChannelOptions(key: string): void {
    this.channelsApi.list(key).subscribe({
      next: (list) => this.channelOptions.set((list ?? []).map((c) => c.key ?? '').filter(Boolean)),
      error: () => {
        /* channel filter is a convenience; a failed fetch just leaves the dropdown empty */
      },
    });
  }

  reload(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .list(this.projectKey(), {
        channelKey: this.filterChannel() || undefined,
        area: this.filterArea() || undefined,
        targetType: this.filterType() || undefined,
        locale: this.filterLocale() ?? undefined,
        q: this.search().trim() || undefined,
        page: this.page(),
        size: PAGE_SIZE,
      })
      .subscribe({
        next: (result) => {
          this.entries.set(result.content ?? []);
          this.totalPages.set(result.totalPages ?? 0);
          this.totalElements.set(result.totalElements ?? 0);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.error.set('Could not load the URL registry — check your connection and try again.');
        },
      });
  }

  onChannelFilterChange(event: Event): void {
    this.filterChannel.set((event.target as HTMLSelectElement).value);
    this.page.set(0);
    this.reload();
  }

  onAreaFilterChange(event: Event): void {
    this.filterArea.set((event.target as HTMLSelectElement).value as '' | UrlArea);
    this.page.set(0);
    this.reload();
  }

  onTypeFilterChange(event: Event): void {
    this.filterType.set((event.target as HTMLSelectElement).value as '' | UrlTargetType);
    this.page.set(0);
    this.reload();
  }

  onLocaleFilterChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.filterLocale.set(value === '*' ? null : value);
    this.page.set(0);
    this.reload();
  }

  onSearchInput(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  /** Searches on Enter or when the field is left — not on every keystroke. */
  applySearch(): void {
    this.page.set(0);
    this.reload();
  }

  /** "About us", "Logo · variant thumb", "Blog · page 2". */
  protected targetText(entry: UrlRegistryEntryView): string {
    const name = entry.targetLabel ?? entry.targetUuid ?? '—';
    const output = outputLabel(entry);
    return output ? `${name} · ${output}` : name;
  }

  prevPage(): void {
    if (this.page() <= 0) {
      return;
    }
    this.page.update((p) => p - 1);
    this.reload();
  }

  nextPage(): void {
    if (this.page() + 1 >= this.totalPages()) {
      return;
    }
    this.page.update((p) => p + 1);
    this.reload();
  }

  // ── Inline override edit ────────────────────────────────────────────────

  startEdit(entry: UrlRegistryEntryView): void {
    if (this.readOnly()) {
      return;
    }
    this.editingId.set(entry.id ?? null);
    this.editUrl.set(entry.url ?? '');
    this.editError.set(null);
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.editUrl.set('');
    this.editError.set(null);
  }

  onEditUrlInput(event: Event): void {
    this.editUrl.set((event.target as HTMLInputElement).value);
  }

  saveEdit(entry: UrlRegistryEntryView): void {
    const id = entry.id;
    const url = this.editUrl().trim();
    if (id == null || !url || this.saving() || this.readOnly()) {
      return;
    }
    this.saving.set(true);
    this.api.override(this.projectKey(), id, url).subscribe({
      next: (updated) => {
        this.entries.update((list) => list.map((e) => (e.id === id ? updated : e)));
        this.saving.set(false);
        this.editingId.set(null);
        this.editUrl.set('');
        this.editError.set(null);
        this.toasts.show('URL override saved — the next build moves the output there', 'success');
      },
      error: (err) => {
        this.saving.set(false);
        this.editError.set(overrideErrorMessage(err));
      },
    });
  }

  // ── Reset (destructive — always confirmed) ──────────────────────────────

  requestResetEntry(entry: UrlRegistryEntryView): void {
    if (this.readOnly()) {
      return;
    }
    this.pendingReset.set({ kind: 'entry', entry });
    this.dialog.open({
      title: 'Reset this URL',
      message: `Delete the URL of "${this.targetText(entry)}"${entry.channelKey ? ` on channel "${entry.channelKey}"` : ''} (${entry.area})? The next build or preview assigns its current computed URL, and a build moves the output there.`,
      confirmLabel: 'Reset',
      cancelLabel: 'Cancel',
      kind: 'danger',
    });
  }

  requestResetAsset(entry: UrlRegistryEntryView): void {
    if (this.readOnly()) {
      return;
    }
    this.pendingReset.set({ kind: 'asset', entry });
    this.dialog.open({
      title: 'Reset all URLs of this asset',
      message: `Delete every URL of "${entry.targetLabel ?? entry.targetUuid}" — every channel, language, area, variant and page? The next build or preview assigns its current computed URLs.`,
      confirmLabel: 'Reset asset',
      cancelLabel: 'Cancel',
      kind: 'danger',
    });
  }

  requestResetChannel(): void {
    const channelKey = this.filterChannel();
    if (!channelKey || this.readOnly()) {
      return;
    }
    this.pendingReset.set({ kind: 'channel', channelKey });
    this.dialog.open({
      title: 'Reset channel URLs',
      message: `Delete every cached URL for channel "${channelKey}" across the whole project? The next build or preview assigns their current computed URLs, and a build moves the outputs there.`,
      confirmLabel: 'Reset channel',
      cancelLabel: 'Cancel',
      kind: 'danger',
    });
  }

  requestResetArea(): void {
    const area = this.filterArea();
    if (!area || this.readOnly()) {
      return;
    }
    this.pendingReset.set({ kind: 'area', area });
    this.dialog.open({
      title: 'Reset area URLs',
      message: `Delete every cached URL in the "${area}" area, across all channels? The next build or preview assigns their current computed URLs, and a build moves the outputs there.`,
      confirmLabel: 'Reset area',
      cancelLabel: 'Cancel',
      kind: 'danger',
    });
  }

  requestResetAll(): void {
    if (this.readOnly()) {
      return;
    }
    this.pendingReset.set({ kind: 'project' });
    this.dialog.open({
      title: 'Reset all URLs',
      message:
        'Delete every cached URL in this project — every channel, every area? The next build or preview assigns their current computed URLs, and a build moves the outputs there.',
      confirmLabel: 'Reset all',
      cancelLabel: 'Cancel',
      kind: 'danger',
    });
  }

  cancelReset(): void {
    this.dialog.close();
    this.pendingReset.set(null);
  }

  confirmReset(): void {
    const scope = this.pendingReset();
    if (!scope || this.resetting() || this.readOnly()) {
      return;
    }
    const req =
      scope.kind === 'entry'
        ? { entryId: scope.entry.id }
        : scope.kind === 'asset'
          ? { targetUuid: scope.entry.targetUuid }
          : scope.kind === 'channel'
          ? { channelKey: scope.channelKey }
          : scope.kind === 'area'
            ? { area: scope.area }
            : {};
    this.resetting.set(true);
    this.api.reset(this.projectKey(), req).subscribe({
      next: () => {
        this.resetting.set(false);
        this.dialog.close();
        this.pendingReset.set(null);
        this.toasts.show(
          'Reset complete — the next build or preview assigns the current computed URLs.',
          'success',
        );
        this.page.set(0);
        this.reload();
      },
      error: () => {
        this.resetting.set(false);
        this.dialog.close();
        this.pendingReset.set(null);
        this.toasts.show('Could not reset those URLs — try again in a moment.', 'error');
      },
    });
  }
}
