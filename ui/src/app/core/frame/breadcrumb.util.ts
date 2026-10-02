import { KNOWN_SUBS, PROJECT_SECTIONS, type FrameLocation } from './frame-location';

/** One breadcrumb segment. A segment without a `link` is the current place. */
export interface Crumb {
  id: string;
  label: string;
  /** Router commands (absolute) to open the segment. */
  link?: readonly (string | number)[];
}

/** What the open screen contributes below its area: the folder path and the item (set through `FrameContextStore`). */
export interface FrameItem {
  /** The item's name (the last segment). */
  label: string;
  /** The folders above it, outermost first. */
  trail?: readonly Crumb[];
}

export interface CrumbInput {
  location: FrameLocation;
  /** Translates `frame.section.<id>` / `frame.sub.<section>.<sub>`. */
  label: (key: string) => string;
  item: FrameItem | null;
}

/**
 * The breadcrumb for a location: area › sub-page › folders › item. The last segment is the current place and has no
 * link; every other one links to where it stands. Pure.
 */
export function buildBreadcrumb({ location, label, item }: CrumbInput): Crumb[] {
  const crumbs: Crumb[] = [];
  const { kind, projectKey, section, sub } = location;
  if (kind === 'dashboard') {
    return [{ id: 'dashboard', label: label('frame.section.dashboard') }];
  }
  if (kind === 'account') {
    return [{ id: 'account', label: label('frame.section.account') }];
  }
  if (kind === 'admin') {
    crumbs.push({ id: 'admin', label: label('frame.section.admin'), link: ['/admin'] });
  } else if (kind === 'project' && projectKey) {
    crumbs.push(
      section && PROJECT_SECTIONS.includes(section)
        ? { id: section, label: label(`frame.section.${section}`), link: ['/p', projectKey, section] }
        : { id: 'home', label: label('frame.section.home'), link: ['/p', projectKey] },
    );
  } else {
    return crumbs;
  }
  const rootSection = kind === 'admin' ? 'admin' : section;
  if (sub !== null && rootSection !== null && KNOWN_SUBS[rootSection]?.includes(sub)) {
    const link = kind === 'admin' ? ['/admin', sub] : ['/p', projectKey ?? '', rootSection, sub];
    crumbs.push({ id: `${rootSection}.${sub}`, label: label(`frame.sub.${rootSection}.${sub}`), link });
  }
  if (item) {
    crumbs.push(...(item.trail ?? []));
    crumbs.push({ id: 'item', label: item.label });
  }
  // The current place carries no link.
  const last = crumbs[crumbs.length - 1];
  if (last) {
    crumbs[crumbs.length - 1] = { id: last.id, label: last.label };
  }
  return crumbs;
}

export interface CollapsedCrumbs {
  head: Crumb[];
  /** The segments behind the "…" menu. */
  hidden: Crumb[];
  tail: Crumb[];
}

/**
 * Collapses the middle of a long path into one "…" menu: the first segment and the last `max - 2` stay visible. A
 * path longer than `max` hides at least two segments, so the menu is never for a single entry. Pure.
 */
export function collapseCrumbs(crumbs: readonly Crumb[], max = 5): CollapsedCrumbs {
  if (crumbs.length <= max) {
    return { head: [...crumbs], hidden: [], tail: [] };
  }
  const tailCount = max - 2;
  return {
    head: crumbs.slice(0, 1),
    hidden: crumbs.slice(1, crumbs.length - tailCount),
    tail: crumbs.slice(crumbs.length - tailCount),
  };
}
