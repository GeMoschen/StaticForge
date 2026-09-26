import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { Subscription } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { RouterLink } from '@angular/router';
import { ProjectMembersStore } from '../../core/project/project-members.store';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { ScheduleDialogComponent } from '../schedules/schedule-dialog.component';
import type { ScheduleType } from '../schedules/schedule.util';
import { formatInstant } from '../schedules/zoned-time.util';
import { ReleaseBadgeComponent } from './release-badge.component';
import { ReleaseDialogComponent } from './release-dialog.component';
import { ReleaseEventsStore } from './release-events.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { type ReleaseChoice, type ReleaseMode, type ReleaseSubject, assetName, choicesFor } from './release-choice.util';
import { localeStatuses, localeTag, scheduledTypeLabel, statusIcon, statusLabel, statusTone } from './release-status.util';

type AssetDetailView = components['schemas']['AssetDetailView'];

/**
 * The release bar at the top of every releasable editor (M27.6.1): the status in the editing locale, a compact
 * per-locale list, and — for whoever may change release state — Release…, Unpublish… and Discard changes….
 *
 * <p>It reads the asset's `release` block itself (`GET /assets/{uuid}`), again whenever the editor saves
 * ({@link refreshKey}) and after any release action anywhere — so the statuses shown are always the server's.
 * Renders nothing for an asset without a release state (a store root, a template).
 */
@Component({
  selector: 'sf-release-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SfIconComponent, ReleaseBadgeComponent, ReleaseDialogComponent, ScheduleDialogComponent],
  templateUrl: './release-bar.component.html',
  styleUrl: './release-bar.component.scss',
})
export class ReleaseBarComponent implements OnDestroy {
  private readonly api = inject(ApiClient);
  private readonly editingLocale = inject(EditingLocaleStore);
  private readonly locales = inject(LocalesStore);
  private readonly events = inject(ReleaseEventsStore);
  protected readonly permissions = inject(ProjectPermissionsStore);
  private readonly members = inject(ProjectMembersStore);

  readonly projectKey = input.required<string>();
  readonly assetUuid = input.required<string | null | undefined>();
  /** Changes whenever the editor saved (its revision): the bar re-reads the status. Never sent to the server. */
  readonly refreshKey = input<unknown>(null);

  /** A release action succeeded. After `discard` the draft changed underneath the editor: it reloads. */
  readonly changed = output<ReleaseMode>();

  protected readonly detail = signal<AssetDetailView | null>(null);
  protected readonly dialog = signal<{ mode: ReleaseMode; choices: ReleaseChoice[] } | null>(null);
  protected readonly scheduling = signal(false);
  private request: Subscription | null = null;

  protected readonly subject = computed<ReleaseSubject | null>(() => {
    const detail = this.detail();
    if (!detail?.uuid || localeStatuses(detail.release).length === 0) {
      return null;
    }
    return {
      uuid: detail.uuid,
      type: detail.type,
      uid: detail.uid,
      displayName: detail.displayName,
      folderPath: detail.folderPath,
      release: detail.release,
    };
  });

  /** The per-locale list — only when the asset has more than the shared key. */
  protected readonly localeRows = computed(() => {
    const entries = localeStatuses(this.subject()?.release);
    if (entries.length === 1 && entries[0].key === '') {
      return [];
    }
    return entries.map((entry) => ({
      key: entry.key,
      tag: localeTag(entry.key),
      icon: statusIcon(entry.status),
      tone: statusTone(entry.status),
      title: `${entry.key ? this.locales.labelOf(entry.key) : 'All languages'}: ${statusLabel(entry.status)}`,
      current: entry.key === this.editingLocale.locale(),
    }));
  });

  private readonly choices = computed(() => {
    const subject = this.subject();
    const locale = this.editingLocale.locale();
    const labelOf = (code: string) => this.locales.labelOf(code);
    return {
      release: subject ? choicesFor(subject, 'release', locale, labelOf) : [],
      unpublish: subject ? choicesFor(subject, 'unpublish', locale, labelOf) : [],
      discard: subject ? choicesFor(subject, 'discard', locale, labelOf) : [],
    };
  });

  /** What the Schedule… dialog offers for this asset (M27.6.5). */
  protected readonly scheduleTypes = computed<ScheduleType[]>(() => [
    ...(this.choices().release.length > 0 ? (['RELEASE'] as const) : []),
    ...(this.choices().unpublish.length > 0 ? (['UNPUBLISH'] as const) : []),
  ]);
  protected readonly releaseChoices = computed(() => this.choices().release);
  protected readonly unpublishChoices = computed(() => this.choices().unpublish);

  /** "Release scheduled for Tue 29 Sep 2026, 09:00 by Ana (EN)" — each linking to its schedule. */
  protected readonly pending = computed(() =>
    (this.detail()?.scheduled ?? []).map((ref) => {
      const when = formatInstant(ref.nextRunAt ?? ref.runAt);
      const owner = ref.ownerUserId != null ? ` by ${this.members.nameOf(ref.ownerUserId)}` : '';
      const locale = ref.locale ? ` (${localeTag(ref.locale)})` : '';
      return { id: ref.actionId, text: `${scheduledTypeLabel(ref.type)} scheduled for ${when}${owner}${locale}` };
    }),
  );

  protected readonly canReleaseAny = computed(() => this.choices().release.length > 0);
  protected readonly canUnpublishAny = computed(() => this.choices().unpublish.length > 0);
  protected readonly canDiscardAny = computed(() => this.choices().discard.length > 0);
  protected readonly name = computed(() => assetName(this.subject()));

  constructor() {
    effect(() => {
      const key = this.projectKey();
      const uuid = this.assetUuid();
      this.refreshKey();
      this.events.version();
      untracked(() => {
        this.members.load(key);
        this.load(key, uuid);
      });
    });
  }

  ngOnDestroy(): void {
    this.request?.unsubscribe();
  }

  protected open(mode: ReleaseMode): void {
    this.dialog.set({ mode, choices: this.choices()[mode] });
  }

  protected onDone(mode: ReleaseMode): void {
    this.changed.emit(mode);
  }

  private load(projectKey: string, uuid: string | null | undefined): void {
    this.request?.unsubscribe();
    if (!projectKey || !uuid) {
      this.detail.set(null);
      return;
    }
    if (this.detail()?.uuid !== uuid) {
      this.detail.set(null);
    }
    this.request = this.api.assetDetail(projectKey, uuid).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        if (detail.uuid) {
          this.events.observe({ uuid: detail.uuid, release: detail.release, scheduled: detail.scheduled });
        }
      },
      // No bar is better than a wrong one: the editor itself reports why the asset can't load.
      error: () => this.detail.set(null),
    });
  }
}
