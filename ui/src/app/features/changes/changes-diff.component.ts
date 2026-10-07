import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { assetRoute } from '../../shared/asset-route.util';
import { SfStatusComponent, type SfStatusTone } from '../../shared/components/display/sf-status.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfDiffComponent } from '../../shared/components/sf-diff.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { statusIcon } from '../release/release-status.util';
import { CHANGE_TYPES, typeIcon } from './changes-query.util';
import { ChangesStore } from './changes.store';

const TONES: Readonly<Record<string, SfStatusTone | undefined>> = {
  NEW: 'info',
  CHANGED: 'warning',
  UNPUBLISHED: 'neutral',
  DELETION_PENDING: 'danger',
};

/** Which per-status note the pane shows above the diff (`changes.diff.notes.<status>`). */
const NOTES = new Set(['NEW', 'DELETION_PENDING', 'UNPUBLISHED']);

/**
 * The released-to-draft diff of the open row, beside the table (M35.23, gate decisions 26 and 46): a bordered card — the
 * row's name as the pane's `h2`, its type, language and status, *Open in editor* and a close button — over the field
 * diff (released on the left, draft on the right).
 */
@Component({
  selector: 'sf-changes-diff',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfDiffComponent, SfIconComponent, SfSpinnerComponent, SfStatusComponent],
  templateUrl: './changes-diff.component.html',
  styleUrl: './changes-diff.component.scss',
  host: { role: 'region', 'aria-labelledby': 'changes-diff-title' },
})
export class ChangesDiffComponent {
  protected readonly store = inject(ChangesStore);
  private readonly transloco = inject(TranslocoService);
  readonly projectKey = input.required<string>();

  protected readonly typeIcon = typeIcon;
  protected readonly toneOf = (status: string | null | undefined): SfStatusTone => TONES[status ?? ''] ?? 'neutral';
  protected readonly statusIcon = statusIcon;

  protected readonly row = computed(() => this.store.focusedRow());
  protected readonly route = computed(() => {
    const row = this.row();
    return row ? assetRoute(this.projectKey(), row) : null;
  });
  protected readonly title = computed(() => {
    const row = this.row();
    return row ? row.displayName || row.uid || this.t('page.untitled') : '';
  });
  /** "Page · English (EN)": the type, then the language (none for the shared key). */
  protected readonly meta = computed(() => {
    const row = this.row();
    if (!row) {
      return '';
    }
    const type = CHANGE_TYPES.some((t) => t.value === row.type) ? this.transloco.translate(`enum.assetType.${row.type}`) : (row.type ?? '');
    const language = row.locale ? `${this.store.locales.labelOf(row.locale)} (${row.locale.toUpperCase()})` : this.t('page.allLanguages');
    return this.store.locales.isLocalized() ? `${type} · ${language}` : type;
  });
  protected readonly statusText = computed(() => this.transloco.translate(`enum.releaseStatus.${this.row()?.status}`));
  protected readonly note = computed(() => {
    const status = this.row()?.status ?? '';
    return NOTES.has(status) ? this.t(`diff.notes.${status}`) : null;
  });

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`changes.${key}`, params);
  }
}
