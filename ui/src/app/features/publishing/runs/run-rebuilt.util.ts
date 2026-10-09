import { assetLabel, type PlanEntryView, type PlanSummaryView, type ReasonView } from '../../generation/insight/insight.util';
import type { GenerationRunView } from './runs.util';

/** Which of the Rebuilt tab's views applies to a run. */
export type RebuiltView = 'pending' | 'none' | 'pruned' | 'nothing' | 'plan';

/**
 * The view for a run: its `planState` (`STORED`, `PRUNED`, `PENDING`, `NONE`), and for a stored plan whether it rebuilt
 * anything. A server that does not send `planState` is read from the plan summary.
 */
export function rebuiltView(run: GenerationRunView): RebuiltView {
  const summary = run.planSummary;
  switch (run.planState) {
    case 'PENDING':
      return 'pending';
    case 'NONE':
      return 'none';
    case 'PRUNED':
      return 'pruned';
    case 'STORED':
      return summary && (summary.entryCount ?? 0) > 0 ? 'plan' : summary ? 'nothing' : 'none';
    default:
      return !summary ? 'none' : summary.planAvailable === false ? 'pruned' : (summary.entryCount ?? 0) > 0 ? 'plan' : 'nothing';
  }
}

/** The icon of the asset a group of pages was rebuilt because of. */
export function viaIcon(assetType: string | undefined): string {
  switch (assetType) {
    case 'PAGE':
      return 'description';
    case 'PAGE_TEMPLATE':
    case 'SECTION_TEMPLATE':
    case 'TEMPLATE':
      return 'code';
    case 'NAVIGATION':
      return 'menu';
    case 'MEDIA':
      return 'image';
    case 'GLOBAL_SET':
    case 'RECORD_SET':
    case 'DATASET':
      return 'database';
    default:
      return 'edit_note';
  }
}

/** The "via" groups of a plan: the asset (`section_template:teaser`), its icon and how many files it rebuilt. */
export function viaGroups(summary: PlanSummaryView | null | undefined): { key: string; asset: string; icon: string; count: number }[] {
  return (summary?.via ?? []).map((via, index) => ({
    key: `${via.assetUuid ?? index}|${via.edge ?? ''}`,
    asset: assetLabel(via.assetType, via.uid),
    icon: viaIcon(via.assetType),
    count: via.count ?? 0,
  }));
}

/** The change a file was rebuilt because of: the asset at the root of its chain and the revision it changed in. */
export function becauseOf(reason: ReasonView | undefined): string {
  const root = reason?.rootAsset;
  if (!root) {
    return '';
  }
  const asset = assetLabel(root.type, root.uid);
  return reason?.rootRevision == null ? asset : `${asset} · r${reason.rootRevision}`;
}

/** The name an entry goes by in the table: a page by its display name, anything else by its type and uid. */
export function entryName(entry: PlanEntryView): string {
  if (entry.assetType === 'PAGE') {
    return entry.displayName || entry.uid || entry.outputPath || '';
  }
  return assetLabel(entry.assetType, entry.uid);
}

export const entryKey = (entry: PlanEntryView): string => `${entry.assetUuid}|${entry.channel ?? ''}|${entry.outputPath}`;
