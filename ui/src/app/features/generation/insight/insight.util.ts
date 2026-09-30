import type { components } from '../../../core/api/generated/schema.d.ts';

export type GenerationPlanView = components['schemas']['GenerationPlanView'];
export type PlanSummaryView = components['schemas']['PlanSummaryView'];
export type PlanEntryView = components['schemas']['PlanEntryView'];
export type ReasonView = components['schemas']['ReasonView'];
export type StepView = components['schemas']['StepView'];
export type EntryPage = components['schemas']['EntryPage'];
export type AssetImpactView = components['schemas']['AssetImpactView'];

/** Query of a page of plan entries (dry run, stored plan or impact). */
export interface PlanEntryQuery {
  page: number;
  size: number;
  rootKind?: string;
  channel?: string;
  q?: string;
}

/**
 * Labels of reason root kinds. Kinds added by a later backend fall back to their raw name (see
 * {@link rootKindLabel}).
 */
const ROOT_KIND_LABELS: Record<string, string> = {
  FULL_BUILD: 'Full build',
  INCREMENTAL_FALLBACK_FULL: 'Full build (no usable previous build)',
  EXPLICIT_SCOPE: 'Explicitly selected',
  ASSET_CHANGED: 'Changed',
  ASSET_RELEASED: 'Released',
  ASSET_UNPUBLISHED: 'Unpublished',
  ASSET_DELETED: 'Deleted',
  URL_CHANGED: 'URL changed',
  NOT_IN_BASE_BUILD: 'Missing from the previous build',
};

/** Why an incremental request falls back to a full build, as a sentence completing "…: this will be a full build". */
const FALLBACK_LABELS: Record<string, string> = {
  NO_COMPLETE_BUILD_FOR_TARGET: 'no previous complete build for {target}',
  BASE_BUILD_MISSING: 'the previous build of {target} is no longer available',
  CHANNEL_SETTINGS_CHANGED: 'channel output settings changed since the previous build',
  REVISION_BEFORE_BASELINE: 'the requested revision is older than the previous build',
  BASE_BUILD_WITHOUT_QUALITY_FACTS: 'the previous build of {target} has no quality check results',
  QUALITY_RULES_CHANGED: 'the quality rules changed since the previous build',
};

/**
 * One lookup of edge labels: how a chain step depends on the next asset. Edges added by a later backend render
 * as their raw name until they get a label.
 */
const EDGE_LABELS: Record<string, string> = {
  PAGE_TEMPLATE: 'uses template',
  SECTION_TEMPLATE: 'places section',
  PARENT_TEMPLATE: 'extends template',
  NAVIGATION: 'renders navigation of',
  DATASET_MEMBERSHIP: 'loops dataset containing',
  RECORD_SET_MEMBERSHIP: 'reads record set containing',
  RECORD_SET_QUERY: 'reads record set with changed query',
  RECORD_TEMPLATE: 'renders through record template of',
  PAGINATION_SOURCE: 'paginates source containing',
  RULE_REFERENCE: 'has editor rules reading',
};

const REFERENCE_LABELS: Record<string, string> = {
  TEMPLATE: 'uses',
  MEDIA_REF: 'references media',
  CONTENT_REF: 'references',
  OCTL_VALUE: 'reads values of',
  OCTL_REF: 'links to',
  OCTL_INCLUDE: 'includes',
  NAV: 'points to',
  RULE_REFERENCE: 'has editor rules reading',
};

export function rootKindLabel(kind: string | undefined): string {
  return (kind && ROOT_KIND_LABELS[kind]) ?? kind ?? 'Unknown';
}

/** The root badge of a reason: the fallback cause spelled out for a fallback. */
export function reasonBadge(reason: ReasonView | undefined): string {
  if (!reason) {
    return 'Unknown';
  }
  if (reason.rootKind === 'INCREMENTAL_FALLBACK_FULL' && reason.fallbackCause) {
    return `Full build (${fallbackLabel(reason.fallbackCause)})`;
  }
  return rootKindLabel(reason.rootKind);
}

export function fallbackLabel(cause: string | undefined, targetName?: string): string {
  const label = (cause && FALLBACK_LABELS[cause]) ?? cause ?? '';
  return label.replace('{target}', targetName ? `target ${targetName}` : 'this target');
}

/** The warning shown before an incremental request that will build everything. */
export function fallbackWarning(cause: string | undefined, targetName: string | undefined): string {
  return `Incremental requested — ${fallbackLabel(cause, targetName)}; this will be a full build.`;
}

/** How a step depends on the next asset of its chain. */
export function edgeLabel(step: StepView): string {
  if (step.edge === 'REFERENCE') {
    return (step.referenceKind && REFERENCE_LABELS[step.referenceKind]) ?? `references (${step.referenceKind ?? '?'})`;
  }
  return (step.edge && EDGE_LABELS[step.edge]) ?? step.edge ?? 'depends on';
}

/** `page_template:article` — an asset as the chain shows it. */
export function assetLabel(type: string | undefined, uid: string | undefined): string {
  return `${(type ?? 'asset').toLowerCase()}:${uid ?? '?'}`;
}

export interface ChainLine {
  /** The asset of this line. */
  asset: string;
  /** How it depends on the next line ({@code null} on the root line). */
  edge: string | null;
  sourcePath: string | null;
  uuid: string | null;
  type: string | null;
}

/**
 * A reason as ordered lines, from the planned asset to the root: each line names an asset and how it depends on
 * the next one; the last line is the root. In impact mode the root is "this asset".
 */
export function chainLines(reason: ReasonView | undefined, impact = false): ChainLine[] {
  if (!reason) {
    return [];
  }
  const lines: ChainLine[] = (reason.steps ?? []).map((step) => ({
    asset: assetLabel(step.assetType, step.uid),
    edge: edgeLabel(step),
    sourcePath: step.sourcePath ?? null,
    uuid: step.assetUuid ?? null,
    type: step.assetType ?? null,
  }));
  const root = reason.rootAsset;
  if (root && (lines.length > 0 || !impact)) {
    lines.push({
      asset: impact ? 'this asset' : assetLabel(root.type, root.uid),
      edge: null,
      sourcePath: null,
      uuid: root.uuid ?? null,
      type: root.type ?? null,
    });
  }
  return lines;
}

/** How a change-driven root kind reads in a chain; other kinds read as their badge. */
const CHANGE_VERBS: Record<string, string> = {
  ASSET_CHANGED: 'changed',
  ASSET_DELETED: 'deleted',
  ASSET_RELEASED: 'released in',
  ASSET_UNPUBLISHED: 'unpublished in',
};

/**
 * The reason as one line of text: `about.html ← page_template:article ← media:hero · changed r1842`, or for a
 * release (M27.2.2) `en/about.html ← media:hero · released in r1902, en`.
 */
export function reasonText(entry: PlanEntryView, impact = false): string {
  const reason = entry.reason;
  const parts = [entry.outputPath ?? assetLabel(entry.assetType, entry.uid)];
  // The first line is the planned asset itself, which the output path already names.
  const hasSteps = (reason?.steps?.length ?? 0) > 0;
  const lines = hasSteps || reason?.rootAsset?.uuid !== entry.assetUuid ? chainLines(reason, impact) : [];
  for (const line of lines.slice(hasSteps ? 1 : 0)) {
    parts.push(line.asset);
  }
  let text = parts.join(' ← ');
  const verb = reason?.rootKind ? CHANGE_VERBS[reason.rootKind] : undefined;
  if (verb) {
    if (!impact) {
      text += ` · ${verb}`;
      if (reason?.rootRevision != null) {
        text += ` r${reason.rootRevision}`;
      }
      const release = reason?.rootKind === 'ASSET_RELEASED' || reason?.rootKind === 'ASSET_UNPUBLISHED';
      if (release && entry.locale) {
        text += `, ${entry.locale}`;
      }
    }
  } else {
    text += ` · ${reasonBadge(reason).toLowerCase()}`;
  }
  const others = (reason?.causeCount ?? 1) - 1;
  if (others > 0) {
    text += ` + ${others} other change${others === 1 ? '' : 's'}`;
  }
  return text;
}

/** "+ 3 other changes", or empty. */
export function otherCausesLabel(reason: ReasonView | undefined): string {
  const others = (reason?.causeCount ?? 1) - 1;
  return others > 0 ? `+ ${others} other change${others === 1 ? '' : 's'}` : '';
}

const NUMBER = new Intl.NumberFormat('en-US');

export function count(value: number | undefined, singular: string, plural = `${singular}s`): string {
  const n = value ?? 0;
  return `${NUMBER.format(n)} ${n === 1 ? singular : plural}`;
}

/** The run history's one-liner: "Incremental · 37 pages (via 2 changes)" or "Full · 5,000 pages". */
export function planSummaryLine(summary: PlanSummaryView | undefined | null): string {
  if (!summary) {
    return '';
  }
  const pages = count(summary.pageCount, 'page');
  if (summary.incremental) {
    const media = summary.processedMediaCount ? `, ${count(summary.processedMediaCount, 'media file')}` : '';
    return `Incremental · ${pages}${media} (via ${count(summary.changedAssetCount, 'change')})`;
  }
  const scope = summary.scoped ? 'Scoped' : 'Full';
  const fallback = summary.fallbackCause ? ' · fell back from incremental' : '';
  return `${scope} · ${pages}${fallback}`;
}

/**
 * A run's redirect counts (M30.4.2): "2 redirects added · 14 redirects active"; `active` is left out for a run that
 * published nothing, and the line is empty for a run from before redirects.
 */
export function redirectsLine(summary: PlanSummaryView | undefined | null): string {
  const added = summary?.redirectsAdded;
  const active = summary?.redirectsActive;
  const parts: string[] = [];
  if (added != null) {
    parts.push(`${count(added, 'redirect')} added`);
  }
  if (active != null) {
    parts.push(`${count(active, 'redirect')} active`);
  }
  return parts.join(' · ');
}

export interface CountRow {
  key: string;
  label: string;
  count: number;
}

/** Counts by root kind, largest first, labelled. */
export function rootKindRows(summary: PlanSummaryView | undefined | null): CountRow[] {
  return countRows(summary?.byRootKind, rootKindLabel);
}

/** Counts by first edge, largest first, labelled ("No chain" for the planned asset itself). */
export function firstEdgeRows(
  byFirstEdge: Record<string, number> | undefined | null,
  noChainLabel = 'No chain',
): CountRow[] {
  return countRows(byFirstEdge, (key) =>
    key === 'NONE' ? noChainLabel : key === 'REFERENCE' ? 'references' : EDGE_LABELS[key] ?? key,
  );
}

/** "412 via section_template:teaser" lines. */
export function viaRows(summary: PlanSummaryView | undefined | null): string[] {
  return (summary?.via ?? []).map((via) => `${NUMBER.format(via.count ?? 0)} via ${assetLabel(via.assetType, via.uid)}`);
}

function countRows(counts: Record<string, number> | undefined | null, label: (key: string) => string): CountRow[] {
  return Object.entries(counts ?? {})
    .map(([key, value]) => ({ key, label: label(key), count: value }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** The header of an impact panel: "Changing this rebuilds 12 pages (24 files)". */
export function impactHeadline(impact: AssetImpactView | null | undefined): string {
  if (!impact) {
    return '';
  }
  if (!impact.entryCount) {
    return 'Changing this rebuilds nothing.';
  }
  return `Changing this rebuilds ${count(impact.pageCount, 'page')} (${count(impact.entryCount, 'file')})`;
}

/** The request fields a plan preview depends on, serialized: a changed key marks the preview stale. */
export function planRequestKey(request: {
  mode?: string;
  targetId?: number | null;
  channels?: string[];
  folderPath?: string | null;
  assetUuids?: string[] | null;
  validate?: boolean;
}): string {
  return JSON.stringify([
    request.mode ?? 'FULL',
    request.targetId ?? null,
    [...(request.channels ?? [])].sort(),
    request.folderPath ?? null,
    [...(request.assetUuids ?? [])].sort(),
  ]);
}

/** Query parameters of an entries request, without empty filters. */
export function entryQueryParams(query: PlanEntryQuery, extra: Record<string, string | boolean> = {}): Record<string, string> {
  const params: Record<string, string> = { page: String(query.page), size: String(query.size) };
  if (query.rootKind) {
    params['rootKind'] = query.rootKind;
  }
  if (query.channel) {
    params['channel'] = query.channel;
  }
  if (query.q && query.q.trim()) {
    params['q'] = query.q.trim();
  }
  for (const [key, value] of Object.entries(extra)) {
    params[key] = String(value);
  }
  return params;
}
