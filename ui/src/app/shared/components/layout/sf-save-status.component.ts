import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfStatusComponent } from '../display/sf-status.component';
import { SfIconComponent } from '../sf-icon.component';

/** What an editor's content is: on the server, on its way, waiting for a save, or refused. */
export type SfSaveState = 'saved' | 'saving' | 'dirty' | 'error';

/**
 * The save status of an editor, shown in its page header (M35.13, decision 11) — the same everywhere:
 *
 * - **Saved 12:04** (or just *Saved*): quiet text with a cloud icon.
 * - **Saving…**: quiet text with a sync icon.
 * - **Unsaved changes**: a warning pill — the edit is waiting for a save (explicit-save editors) or for its debounce.
 * - **Not saved — 2 errors**: a danger pill; without a count, "Not saved".
 *
 * The text lives in a polite live region that is always present, so a change of state is announced; the pill's icon is
 * decorative (the words carry the state).
 */
@Component({
  selector: 'sf-save-status',
  standalone: true,
  imports: [SfIconComponent, SfStatusComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="sf-save-status" role="status" aria-live="polite">
      @switch (state()) {
        @case ('dirty') {
          <sf-status size="sm" tone="warning" icon="edit" [label]="'shared.saveStatus.dirty' | transloco" />
        }
        @case ('error') {
          <sf-status size="sm" tone="danger" icon="error" [label]="errorLabel() | transloco: { count: errorCount() }" />
        }
        @case ('saving') {
          <span class="sf-save-status__quiet">
            <sf-icon class="sf-save-status__icon sf-save-status__icon--spin" name="sync" />
            {{ 'shared.saveStatus.saving' | transloco }}
          </span>
        }
        @default {
          <span class="sf-save-status__quiet">
            <sf-icon class="sf-save-status__icon" name="cloud_done" />
            {{ (savedAt() ? 'shared.saveStatus.savedAt' : 'shared.saveStatus.saved') | transloco: { time: savedAt() } }}
          </span>
        }
      }
    </span>
  `,
  styleUrl: './sf-save-status.component.scss',
  host: { class: 'sf-save-status-host' },
})
export class SfSaveStatusComponent {
  readonly state = input.required<SfSaveState>();
  /** The time of the last save, already formatted ("12:04"). */
  readonly savedAt = input<string | null>(null);
  /** How many findings refused the save; 0 = unspecified. */
  readonly errorCount = input(0);

  protected readonly errorLabel = computed(() => (this.errorCount() > 0 ? 'shared.saveStatus.errors' : 'shared.saveStatus.error'));
}
