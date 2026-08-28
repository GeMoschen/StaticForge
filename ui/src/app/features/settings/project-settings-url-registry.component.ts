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
import { UrlArea, UrlRegistryEntryView, UrlRegistryService } from './url-registry.service';
import { TimeTravelStore } from '../revisions/time-travel.store';

const PAGE_SIZE = 20;

/** What a pending reset confirmation will delete — drives both the dialog copy and the actual request. */
type ResetScope =
  | { kind: 'entry'; entry: UrlRegistryEntryView }
  | { kind: 'channel'; channelKey: string }
  | { kind: 'area'; area: UrlArea }
  | { kind: 'project' };

/**
 * Project settings tab: "Navigation URLs" — the resolved-URL cache built by `M8.2.x`'s
 * url-registry, exposed for browsing, manual per-entry override, and scoped resets.
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
  private readonly timeTravel = inject(TimeTravelStore);

  protected readonly readOnly = this.timeTravel.isTimeTravel;

  protected readonly entries = signal<UrlRegistryEntryView[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly page = signal(0);
  protected readonly totalPages = signal(0);
  protected readonly totalElements = signal(0);

  protected readonly channelOptions = signal<string[]>([]);
  protected readonly filterChannel = signal('');
  protected readonly filterArea = signal<'' | UrlArea>('');

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
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.editUrl.set('');
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
        this.toasts.show('URL override saved', 'success');
      },
      error: () => {
        this.saving.set(false);
        this.toasts.show('Could not save the URL override — try again in a moment.', 'error');
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
      message: `Delete the cached URL for "${entry.pageReferenceLabel ?? entry.pageReferenceUuid ?? 'this entry'}" on channel "${entry.channelKey}" (${entry.area})? It will repopulate automatically the next time a generation run or navigation preview resolves it.`,
      confirmLabel: 'Reset',
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
      message: `Delete every cached URL for channel "${channelKey}" across the whole project? Entries will repopulate automatically the next time a generation run or navigation preview resolves them.`,
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
      message: `Delete every cached URL in the "${area}" area, across all channels? Entries will repopulate automatically the next time a generation run or navigation preview resolves them.`,
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
        'Delete every cached URL in this project — every channel, every area? Entries will repopulate automatically the next time a generation run or navigation preview resolves them.',
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
          'Reset complete — affected entries will repopulate on the next generation run or navigation preview.',
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
