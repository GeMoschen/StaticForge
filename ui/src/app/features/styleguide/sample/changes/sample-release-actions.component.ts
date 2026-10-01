import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { SfStatusComponent, SfStatusTone } from '../../../../shared/components/display/sf-status.component';
import { SfMenuComponent, SfMenuItem } from '../../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { CHANGE_LANGS, CHANGE_LANG_NAMES, ChangeLang } from './changes-data';
import { injectSampleNotice, injectSampleText } from './sample-area.util';
import { ReleaseLanguage, SampleReleaseDialogComponent } from './sample-release-dialog.component';
import { SampleScheduleDialogComponent } from './sample-schedule-dialog.component';

/** A language version's release status, as an editor header shows it. */
export type ReleaseActionStatus = 'released' | 'changed' | 'new' | 'scheduled';

export interface ReleaseActionLanguage {
  readonly lang: string;
  readonly status: ReleaseActionStatus;
}

const TONES: Readonly<Record<ReleaseActionStatus, SfStatusTone>> = {
  released: 'success',
  changed: 'warning',
  new: 'info',
  scheduled: 'accent',
};
const ICONS: Readonly<Record<ReleaseActionStatus, string>> = {
  released: 'check_circle',
  changed: 'edit_note',
  new: 'fiber_new',
  scheduled: 'schedule',
};

/**
 * The shared release actions of a releasable editor's header (M35.9 decision 26; `sf-release-actions` in M35.23,
 * replacing the release bar): compact per-language status pills, a primary **Release…** (the release dialog, every
 * changed language pre-ticked), **Schedule…** (the schedule dialog for this item) and, in ⋮, Unpublish and Discard
 * changes (each confirmed). Nothing is saved.
 */
@Component({
  selector: 'sf-sample-release-actions',
  standalone: true,
  imports: [SampleReleaseDialogComponent, SampleScheduleDialogComponent, SfButtonComponent, SfMenuComponent, SfStatusComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-release-actions.component.html',
  styleUrl: './sample-release-actions.component.scss',
})
export class SampleReleaseActionsComponent {
  readonly statuses = input<readonly ReleaseActionLanguage[]>([]);
  /** The item's name (dialog titles, confirmations). */
  readonly name = input<string>('');

  protected readonly t = injectSampleText('styleguide.sample.changes.actions');
  private readonly statusText = injectSampleText('styleguide.sample.changes.statuses');
  private readonly notice = injectSampleNotice();
  private readonly confirms = inject(ConfirmService);
  protected readonly tones = TONES;
  protected readonly icons = ICONS;

  protected readonly releaseOpen = signal(false);
  protected readonly scheduleOpen = signal(false);

  protected readonly unreleased = computed(() => this.statuses().filter((s) => s.status === 'changed' || s.status === 'new'));

  protected readonly languages = computed<ReleaseLanguage[]>(() => {
    const known = new Set<string>(CHANGE_LANGS);
    return this.statuses()
      .filter((s) => known.has(s.lang))
      .map((s) => ({
        lang: s.lang as ChangeLang,
        status: this.statusText(s.status),
        changed: s.status === 'changed' || s.status === 'new',
      }));
  });

  protected readonly scheduleSubject = computed(() => {
    const langs = this.unreleased().map((s) => s.lang.toUpperCase());
    return langs.length ? `${this.name()} (${langs.join(', ')})` : this.name();
  });

  protected readonly moreItems = computed<SfMenuItem[]>(() => [
    {
      id: 'unpublish',
      label: this.t('unpublish'),
      icon: 'cloud_off',
      disabled: !this.statuses().some((s) => s.status !== 'new'),
      action: () => void this.unpublish(),
    },
    {
      id: 'discard',
      label: this.t('discard'),
      icon: 'undo',
      danger: true,
      disabledReason: this.statuses().some((s) => s.status === 'changed') ? undefined : this.t('nothingToDiscard'),
      action: () => void this.discard(),
    },
  ]);

  protected statusLabel(s: ReleaseActionLanguage): string {
    return this.t('pill', { lang: s.lang.toUpperCase(), status: this.statusText(s.status) });
  }

  protected langName(lang: string): string {
    return CHANGE_LANG_NAMES[lang as ChangeLang] ?? lang.toUpperCase();
  }

  private async unpublish(): Promise<void> {
    const confirmed = await this.confirms.confirm({
      title: this.t('unpublishTitle', { name: this.name() }),
      message: this.t('unpublishMessage'),
      confirmLabel: this.t('unpublish'),
      tone: 'danger',
    });
    if (confirmed) {
      this.notice(this.t('unpublished', { name: this.name() }));
    }
  }

  private async discard(): Promise<void> {
    const changed = this.statuses().filter((s) => s.status === 'changed');
    const confirmed = await this.confirms.confirm({
      title: this.t('discardTitle', { name: this.name() }),
      message: this.t('discardMessage'),
      confirmLabel: this.t('discard'),
      tone: 'danger',
      details: changed.map((s) => this.langName(s.lang)),
    });
    if (confirmed) {
      this.notice(this.t('discarded', { name: this.name() }));
    }
  }
}
