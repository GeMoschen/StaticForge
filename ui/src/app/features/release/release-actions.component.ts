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
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { Subscription } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectMembersStore } from '../../core/project/project-members.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ToastService } from '../../core/ui/toast.service';
import { SfStatusComponent, type SfStatusTone } from '../../shared/components/display/sf-status.component';
import { SfMenuComponent } from '../../shared/components/menu/sf-menu.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { ScheduleDialogComponent } from '../schedules/schedule-dialog.component';
import type { ScheduleType } from '../schedules/schedule.util';
import { formatInstant } from '../schedules/zoned-time.util';
import { type ReleaseChoice, type ReleaseMode, type ReleaseSubject, assetName, choicesFor } from './release-choice.util';
import { ReleaseDialogComponent } from './release-dialog.component';
import { ReleaseEventsStore } from './release-events.store';
import { localeStatuses, localeTag, scheduledTypeLabel, statusIcon, statusLabel, statusTone } from './release-status.util';

type AssetDetailView = components['schemas']['AssetDetailView'];

/**
 * The release actions of a releasable editor's page header (M35.23, replacing the release bar; M35.9 decisions 26, 34,
 * 173): one status pill per language (released = success, changed = warning, new = info, scheduled = accent), the
 * primary **Release…**, **Schedule…** and, in ⋮, **Unpublish…** and **Discard changes…**. The group has a divider of
 * its own, so its ⋮ is not mistaken for the item's ⋮ next to it.
 *
 * Release stays enabled when nothing is waiting: it says so in an info toast (decision 173). Unpublish and Discard open
 * the release dialog in their mode, which lists what goes offline or is thrown away and offers the redirect of an
 * unpublished page's old URLs.
 *
 * It reads the asset's `release` block itself (`GET /assets/{uuid}`), again whenever the editor saves
 * ({@link refreshKey}) and after any release action anywhere. Renders nothing for an asset without a release state.
 */
@Component({
  selector: 'sf-release-actions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ReleaseDialogComponent,
    ScheduleDialogComponent,
    SfButtonComponent,
    SfIconComponent,
    SfMenuComponent,
    SfStatusComponent,
    TranslocoPipe,
  ],
  host: { '[class.is-empty]': '!subject()' },
  templateUrl: './release-actions.component.html',
  styleUrl: './release-actions.component.scss',
})
export class ReleaseActionsComponent implements OnDestroy {
  private readonly api = inject(ApiClient);
  private readonly editingLocale = inject(EditingLocaleStore);
  private readonly locales = inject(LocalesStore);
  private readonly events = inject(ReleaseEventsStore);
  private readonly members = inject(ProjectMembersStore);
  private readonly transloco = inject(TranslocoService);
  private readonly toast = inject(ToastService);
  protected readonly permissions = inject(ProjectPermissionsStore);

  readonly projectKey = input.required<string>();
  readonly assetUuid = input.required<string | null | undefined>();
  /** Changes whenever the editor saved (its revision): the status is re-read. Never sent to the server. */
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

  protected readonly name = computed(() => assetName(this.subject()));

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

  protected readonly canReleaseAny = computed(() => this.choices().release.length > 0);
  protected readonly canUnpublishAny = computed(() => this.choices().unpublish.length > 0);
  protected readonly canDiscardAny = computed(() => this.choices().discard.length > 0);

  /** What the Schedule… dialog offers for this asset. */
  protected readonly scheduleTypes = computed<ScheduleType[]>(() => [
    ...(this.canReleaseAny() ? (['RELEASE'] as const) : []),
    ...(this.canUnpublishAny() ? (['UNPUBLISH'] as const) : []),
  ]);
  protected readonly releaseChoices = computed(() => this.choices().release);
  protected readonly unpublishChoices = computed(() => this.choices().unpublish);

  /** The release keys with a pending scheduled release; `''` is the shared key (every language). */
  private readonly scheduledKeys = computed(
    () => new Set((this.detail()?.scheduled ?? []).filter((ref) => ref.type === 'RELEASE').map((ref) => ref.locale ?? '')),
  );

  /** One pill per language, or the shared status for a project without languages. A pending schedule shows as such. */
  protected readonly pills = computed(() => {
    const scheduled = this.scheduledKeys();
    return localeStatuses(this.subject()?.release).map((entry) => {
      const isScheduled = scheduled.has(entry.key) || (scheduled.has('') && entry.status === 'CHANGED');
      const status = isScheduled ? this.transloco.translate('release.actions.scheduled') : statusLabel(entry.status);
      const language = entry.key ? this.locales.labelOf(entry.key) : this.transloco.translate('release.actions.allLanguages');
      return {
        key: entry.key,
        label: entry.key ? localeTag(entry.key) : status,
        icon: isScheduled ? 'schedule' : statusIcon(entry.status),
        tone: isScheduled ? ('accent' as const) : toneOf(statusTone(entry.status)),
        detail: this.transloco.translate('release.actions.pill', { language, status }),
      };
    });
  });

  /** "Release scheduled for Tue 29 Sep 2026, 09:00 by Ana (EN)" — each linking to its schedule. */
  protected readonly pending = computed(() =>
    (this.detail()?.scheduled ?? []).map((ref) => {
      const when = formatInstant(ref.nextRunAt ?? ref.runAt);
      const owner = ref.ownerUserId != null ? ` by ${this.members.nameOf(ref.ownerUserId)}` : '';
      const locale = ref.locale ? ` (${localeTag(ref.locale)})` : '';
      return { id: ref.actionId, text: `${scheduledTypeLabel(ref.type)} scheduled for ${when}${owner}${locale}` };
    }),
  );

  /** Unpublish and Discard changes, in the ⋮ menu. */
  protected readonly moreItems = computed<SfMenuItem[]>(() => [
    {
      id: 'unpublish',
      label: this.transloco.translate('release.actions.unpublish'),
      icon: 'cloud_off',
      disabledReason: this.canUnpublishAny() ? undefined : this.transloco.translate('release.actions.nothingToUnpublish'),
      action: () => this.open('unpublish'),
    },
    {
      id: 'discard',
      label: this.transloco.translate('release.actions.discard'),
      icon: 'undo',
      danger: true,
      disabledReason: this.canDiscardAny() ? undefined : this.transloco.translate('release.actions.nothingToDiscard'),
      action: () => this.open('discard'),
    },
  ]);

  constructor() {
    // Alt+Shift+R opens the release dialog of the open item, from inside a field too (M35.14).
    inject(ShortcutService).use([
      {
        id: 'release',
        keys: 'Alt+Shift+R',
        scope: 'screen',
        group: 'publishing',
        description: 'frame.shortcuts.items.release',
        allowInInput: true,
        enabled: () => this.permissions.canRelease() && this.canReleaseAny() && this.dialog() === null,
        handler: () => this.open('release'),
        palette: { icon: 'rocket_launch', label: 'frame.shortcuts.items.releaseItem', context: () => this.name() || null },
      },
    ]);
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

  /** The primary button: with nothing waiting it says so instead of opening an empty dialog (decision 173). */
  protected onRelease(): void {
    if (this.canReleaseAny()) {
      this.open('release');
    } else {
      this.toast.show(this.transloco.translate('release.actions.nothingWaiting'), 'info');
    }
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
      // No actions are better than wrong ones: the editor itself reports why the asset can't load.
      error: () => this.detail.set(null),
    });
  }
}

/** The design-system tone of a release status's css modifier (`published`, `changed`, `new`, `deletion-pending`). */
function toneOf(tone: string): SfStatusTone {
  switch (tone) {
    case 'published':
      return 'success';
    case 'changed':
      return 'warning';
    case 'new':
      return 'info';
    case 'deletion-pending':
      return 'danger';
    default:
      return 'neutral';
  }
}
