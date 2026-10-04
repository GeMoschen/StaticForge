import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfDrawerComponent } from '../../shared/components/dialog/sf-drawer.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfTabsComponent, type SfTab } from '../../shared/components/sf-tabs.component';
import { assetRoute } from '../../shared/asset-route.util';
import { byLevel } from '../forms/rules/rule-form.util';

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

/** The record drawer's tabs; `null` is closed. */
export type RecordSidePanelTab = 'issues' | 'usages';

/** The drawer's tabs: Checks and Used by (the record editor), or Used by only (a record set, a template, a dataset). */
export type RecordSidePanelTabs = 'both' | 'usages';

/** What the Checks button counts: errors and warnings (infos are listed, hints only show at their field). */
export function checkCounts(issues: readonly ContentIssue[]): { count: number; errors: number } {
  const counted = issues.filter((issue) => issue.severity !== 'INFO' && issue.severity !== 'HINT');
  return { count: counted.length, errors: counted.filter((issue) => issue.kind === 'STRUCTURAL' || issue.severity === 'ERROR').length };
}

/** The kinds of asset that can use a record, by the server's name; anything else is shown humanised. */
const USAGE_TYPES = new Set(['PAGE', 'PAGE_TEMPLATE', 'SECTION_TEMPLATE', 'RECORD', 'RECORD_SET', 'DATASET', 'GLOBAL_SET', 'NAVIGATION']);

/**
 * The record editor's drawer (M35.20): the **Checks** (errors, warnings and infos of the form) and **Used by** (the
 * pages, templates and records that read this record) tabs. The record's versions are in the History drawer. It only
 * shows what the editor hands it; it is non-modal, so the form stays usable beside it.
 */
@Component({
  selector: 'sf-record-side-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SfBadgeComponent, SfDrawerComponent, SfEmptyStateComponent, SfTabsComponent, TranslocoPipe],
  templateUrl: './record-side-panel.component.html',
  styleUrl: './record-side-panel.component.scss',
})
export class RecordSidePanelComponent {
  private readonly transloco = inject(TranslocoService);

  readonly projectKey = input.required<string>();
  /** What the form shows: live findings merged with a rejected save's. */
  readonly issues = input<ContentIssue[]>([]);
  readonly usages = input.required<UsageDto[]>();
  /** The drawer's title; the record editor's "Checks and usage" when omitted. */
  readonly title = input<string | null>(null);
  /** `usages`: the Used by tab only (no Checks), as the record set view and the Templates area open it. */
  readonly tabs = input<RecordSidePanelTabs>('both');
  /** The open tab; `null` while the drawer is closed. */
  readonly tab = model<RecordSidePanelTab | null>(null);

  /** The Checks list, most severe first; hints only show at their field. */
  protected readonly listed = computed(() => byLevel(this.issues().filter((issue) => issue.severity !== 'HINT')));
  protected readonly counts = computed(() => checkCounts(this.issues()));

  protected readonly tabList = computed<SfTab[]>(() => {
    const usedBy: SfTab = {
      id: 'usages',
      label: this.transloco.translate('content.record.panel.usedBy'),
      note: this.usages().length ? '' + this.usages().length : undefined,
    };
    return this.tabs() === 'usages' ? [usedBy] : [{ id: 'issues', label: this.transloco.translate('content.record.panel.checks'), errors: this.counts().count }, usedBy];
  });

  /** Where a usage opens (`null`: it has no screen of its own to link to). */
  protected linkOf(usage: UsageDto): { commands: string[]; queryParams: Record<string, string> } | null {
    const type = usage.fromType ?? '';
    if (!usage.fromUuid || !['PAGE', 'RECORD', 'RECORD_SET', 'PAGE_TEMPLATE', 'SECTION_TEMPLATE', 'DATASET'].includes(type)) {
      return null;
    }
    return assetRoute(this.projectKey(), { type, uuid: usage.fromUuid });
  }

  protected select(id: string): void {
    this.tab.set(id as RecordSidePanelTab);
  }

  protected isBlocking(issue: ContentIssue): boolean {
    return issue.kind === 'STRUCTURAL' || issue.severity === 'ERROR';
  }

  protected levelLabel(issue: ContentIssue): string {
    const level = issue.severity === 'ERROR' || issue.severity === 'WARNING' || issue.severity === 'INFO' ? issue.severity.toLowerCase() : 'info';
    return this.transloco.translate(`content.record.panel.level.${level}`);
  }

  protected typeLabel(type: string | undefined): string {
    if (type && USAGE_TYPES.has(type)) {
      return this.transloco.translate(`content.record.panel.type.${type}`);
    }
    return (type ?? '').toLowerCase().replace(/_/g, ' ');
  }
}
