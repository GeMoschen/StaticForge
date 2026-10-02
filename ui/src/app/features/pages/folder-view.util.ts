import type { components } from '../../core/api/generated/schema.d.ts';
import type { Crumb } from '../../core/frame/breadcrumb.util';
import { type ReleaseBlock, type ReleaseStatus, isReleaseStatus } from '../release/release-status.util';
import type { SfStatusTone } from '../../shared/components/display/sf-status.component';

type FolderView = components['schemas']['FolderView'];
type AssetSummaryView = components['schemas']['AssetSummaryView'];

/** One row of a folder's table: a sub-folder or a page. */
export interface FolderRow {
  /** Unique within the table (`folder:<uuid>` / `page:<uuid>`). */
  readonly key: string;
  readonly kind: 'folder' | 'page';
  readonly uuid: string;
  readonly name: string;
  readonly uid: string;
  /** The canonical path (a page: the folder it lives in; a folder: its own path). */
  readonly path: string;
  readonly templateName: string | null;
  readonly release: ReleaseBlock;
  readonly revision: number | null;
  readonly changedAt: string | null;
  readonly changedBy: string | null;
  /** The latest time any language was released, `null` when none ever was. */
  readonly releasedAt: string | null;
}

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** The latest `releasedAt` of a release block (every language counts), or `null`. */
export function latestReleasedAt(release: ReleaseBlock): string | null {
  let latest: string | null = null;
  for (const view of Object.values(release ?? {})) {
    if (view?.releasedAt && (latest === null || view.releasedAt > latest)) {
      latest = view.releasedAt;
    }
  }
  return latest;
}

/** The table's rows: the sub-folders first, then the pages, each group by name. Pure. */
export function folderRows(folders: readonly FolderView[], pages: readonly AssetSummaryView[]): FolderRow[] {
  const folderRowsOf = folders
    .filter((folder) => !!folder.uuid)
    .map<FolderRow>((folder) => ({
      key: `folder:${folder.uuid}`,
      kind: 'folder',
      uuid: folder.uuid!,
      name: folder.displayName ?? folder.uid ?? '',
      uid: folder.uid ?? '',
      path: folder.path ?? '',
      templateName: null,
      release: folder.release,
      revision: folder.revision ?? null,
      changedAt: null,
      changedBy: null,
      releasedAt: latestReleasedAt(folder.release),
    }))
    .sort(byName);
  const pageRowsOf = pages
    .filter((page) => !!page.uuid)
    .map<FolderRow>((page) => ({
      key: `page:${page.uuid}`,
      kind: 'page',
      uuid: page.uuid!,
      name: page.displayName ?? page.uid ?? '',
      uid: page.uid ?? '',
      path: page.folderPath ?? '',
      templateName: page.templateName ?? null,
      release: page.release,
      revision: page.revision ?? null,
      changedAt: page.changedAt ?? null,
      changedBy: page.changedByName ?? null,
      releasedAt: latestReleasedAt(page.release),
    }))
    .sort(byName);
  return [...folderRowsOf, ...pageRowsOf];
}

/** A page's public path in the store: `/pages_root/news/` + `spring-harvest` → `/news/spring-harvest`. */
export function pageUrl(folderPath: string, uid: string): string {
  const segments = folderPath.split('/').filter(Boolean).slice(1);
  return `/${[...segments, uid].join('/')}`;
}

/** The folders from the top level down to `uuid` (inclusive); empty for an unknown uuid. */
export function folderChain(tree: readonly FolderView[], uuid: string, chain: readonly FolderView[] = []): FolderView[] {
  for (const node of tree) {
    const next = [...chain, node];
    if (node.uuid === uuid) {
      return next;
    }
    const found = folderChain(node.children ?? [], uuid, next);
    if (found.length > 0) {
      return found;
    }
  }
  return [];
}

/** The breadcrumb of an open folder: Pages, then the folders above it as links (the wrapper root is "Pages"). */
export function folderTrail(chain: readonly FolderView[], projectKey: string, rootUuid: string | null): Crumb[] {
  return chain
    .filter((folder) => folder.uuid !== rootUuid)
    .slice(0, -1)
    .map((folder) => ({
      id: folder.uuid ?? '',
      label: folder.displayName ?? folder.uid ?? '',
      link: ['/p', projectKey, 'pages'],
      queryParams: { folder: folder.uuid ?? '' },
    }));
}

/** The tone of a release status in a status chip. */
export function releaseTone(status: ReleaseStatus | string | null | undefined): SfStatusTone {
  if (!isReleaseStatus(status)) {
    return 'neutral';
  }
  switch (status) {
    case 'PUBLISHED':
      return 'success';
    case 'CHANGED':
      return 'warning';
    case 'UNPUBLISHED':
      return 'info';
    case 'DELETION_PENDING':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** Whether `candidate` is `folder` itself or lies inside it — a folder cannot be moved there. */
export function isInside(chainOfCandidate: readonly FolderView[], folderUuid: string): boolean {
  return chainOfCandidate.some((node) => node.uuid === folderUuid);
}
