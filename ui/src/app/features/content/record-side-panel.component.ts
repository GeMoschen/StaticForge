import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SfRelativeTimePipe } from '../../shared/pipes/sf-relative-time.pipe';
import { byLevel } from '../forms/rules/rule-form.util';
import { TimeTravelStore } from '../revisions/time-travel.store';

type AssetHistoryEntry = components['schemas']['AssetHistoryEntry'];
type UsageDto = components['schemas']['UsageDto'];

/** A content validation finding (`ContentIssue` on the wire). */
export interface ContentIssue {
  path?: string;
  code?: string;
  message?: string;
  kind?: string;
  severity?: string;
  locale?: string;
  rule?: string;
}

export type RecordSidePanelTab = 'issues' | 'history' | 'usages';

/**
 * The record editor's side panel (M35.2): the Checks, History and Used by tabs. It only shows what the
 * editor hands it; opening a revision enters time travel.
 */
@Component({
  selector: 'sf-record-side-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SfRelativeTimePipe],
  templateUrl: './record-side-panel.component.html',
  styleUrl: './record-side-panel.component.scss',
})
export class RecordSidePanelComponent {
  readonly projectKey = input.required<string>();
  /** What the form shows: live findings merged with a rejected save's. */
  readonly issues = input.required<ContentIssue[]>();
  readonly history = input.required<AssetHistoryEntry[]>();
  readonly usages = input.required<UsageDto[]>();
  /** The revision on screen, highlighted in the history. */
  readonly revision = input<number | undefined>(undefined);
  /** The open tab. */
  readonly panel = model<RecordSidePanelTab>('issues');

  private readonly timeTravel = inject(TimeTravelStore);

  /** The Checks panel (M33.8): errors, warnings and infos, most severe first; hints only show at their field. */
  protected readonly listed = computed(() => byLevel(this.issues().filter((issue) => issue.severity !== 'HINT')));
  /** The Checks tab counts errors and warnings; infos are listed, not counted. */
  protected readonly counted = computed(() =>
    this.listed().filter((issue) => issue.severity !== 'INFO' && issue.severity !== 'HINT'),
  );

  protected viewRevision(revision: number | undefined): void {
    if (revision != null) {
      this.timeTravel.enter(revision);
    }
  }
}
