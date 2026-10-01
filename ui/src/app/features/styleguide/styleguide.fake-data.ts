import type { SfStatusTone } from '../../shared/components/display/sf-status.component';
import type { SfTreeCreateKind, SfTreeNode } from '../../shared/components/sf-tree.component';

/**
 * Fake content for the style guide's data components (M35.9): an in-memory page tree that loads lazily (with a short
 * delay, so the loading rows show) and carries out renames, creates, deletes and moves, and 200 table rows. Nothing
 * leaves the browser. Deterministic, so screenshots are stable.
 */

export interface FakeNodeData {
  kind: SfTreeCreateKind;
}

export type FakeNode = SfTreeNode<FakeNodeData>;

const ROOT_FOLDERS = ['campaign', 'products', 'news', 'company', 'support', 'archive'];
const SUB_FOLDERS = ['spring', 'summer', 'autumn', 'winter', 'events', 'partners'];
const PAGE_WORDS = ['index', 'overview', 'teaser', 'details', 'contact', 'faq', 'gallery', 'downloads', 'team', 'press'];
const STATUS_BADGES: readonly { label: string; tone: SfStatusTone }[] = [
  { label: 'Changed', tone: 'warning' },
  { label: 'Draft', tone: 'neutral' },
  { label: 'Failed', tone: 'danger' },
];

/** How long a fake load takes, ms. */
export const FAKE_LOAD_MS = 150;

interface TreeState {
  nodes: Map<string, FakeNode>;
  children: Map<string | null, string[]>;
  parents: Map<string, string | null>;
}

export class FakeTree {
  private state: TreeState = { nodes: new Map(), children: new Map([[null, []]]), parents: new Map() };
  private sequence = 0;

  constructor(private readonly delay = FAKE_LOAD_MS) {
    ROOT_FOLDERS.forEach((root, r) => {
      const rootId = this.add(null, 'folder', root);
      SUB_FOLDERS.forEach((sub, s) => {
        const subId = this.add(rootId, 'folder', sub);
        PAGE_WORDS.forEach((word, p) => this.add(subId, 'item', word, (r + s + p) % 7));
      });
      PAGE_WORDS.slice(0, 6).forEach((word, p) => this.add(rootId, 'item', `${root}-${word}`, (r + p) % 5));
    });
  }

  /** The number of nodes (for the caption). */
  get size(): number {
    return this.state.nodes.size;
  }

  /** The tree's loader: the children of `parent` (the roots for `null`), after a short delay. */
  load(parent: FakeNode | null): Promise<readonly FakeNode[]> {
    const ids = this.state.children.get(parent?.id ?? null) ?? [];
    const nodes = ids.map((id) => ({ ...this.state.nodes.get(id)! }));
    return new Promise((resolve) => setTimeout(() => resolve(nodes), this.delay));
  }

  parentOf(id: string): string | null {
    return this.state.parents.get(id) ?? null;
  }

  rename(id: string, label: string): void {
    const node = this.state.nodes.get(id);
    if (node) {
      this.state.nodes.set(id, { ...node, label });
    }
  }

  create(parentId: string | null, kind: SfTreeCreateKind, label: string): void {
    this.add(parentId, kind, label);
  }

  /** Removes the nodes with their subtrees; returns an undo. */
  remove(ids: readonly string[]): () => void {
    const before = this.snapshot();
    for (const id of ids) {
      const parent = this.parentOf(id);
      this.state.children.set(parent, (this.state.children.get(parent) ?? []).filter((c) => c !== id));
      this.drop(id);
    }
    return () => (this.state = before);
  }

  /** Moves (or copies) the nodes into `targetId` (`null` = root); returns an undo. */
  move(ids: readonly string[], targetId: string | null, copy: boolean): () => void {
    const before = this.snapshot();
    for (const id of ids) {
      if (copy) {
        this.copyInto(id, targetId);
        continue;
      }
      const parent = this.parentOf(id);
      this.state.children.set(parent, (this.state.children.get(parent) ?? []).filter((c) => c !== id));
      this.state.children.set(targetId, [...(this.state.children.get(targetId) ?? []), id]);
      this.state.parents.set(id, targetId);
    }
    return () => (this.state = before);
  }

  private add(parentId: string | null, kind: SfTreeCreateKind, label: string, variant = 0): string {
    const id = `n${++this.sequence}`;
    const folder = kind === 'folder';
    const badge = !folder && variant < STATUS_BADGES.length ? STATUS_BADGES[variant] : null;
    const node: FakeNode = {
      id,
      label,
      icon: folder ? 'folder' : 'description',
      hasChildren: folder,
      badges: badge ? [badge] : undefined,
      data: { kind },
    };
    this.state.nodes.set(id, node);
    this.state.parents.set(id, parentId);
    this.state.children.set(parentId, [...(this.state.children.get(parentId) ?? []), id]);
    if (folder) {
      this.state.children.set(id, []);
    }
    return id;
  }

  private drop(id: string): void {
    for (const child of this.state.children.get(id) ?? []) {
      this.drop(child);
    }
    this.state.children.delete(id);
    this.state.nodes.delete(id);
    this.state.parents.delete(id);
  }

  private copyInto(id: string, targetId: string | null): void {
    const node = this.state.nodes.get(id);
    if (!node) {
      return;
    }
    const copyId = this.add(targetId, node.data?.kind ?? 'item', node.label);
    this.state.nodes.set(copyId, { ...node, id: copyId });
    for (const child of [...(this.state.children.get(id) ?? [])]) {
      this.copyInto(child, copyId);
    }
  }

  private snapshot(): TreeState {
    return {
      nodes: new Map(this.state.nodes),
      children: new Map([...this.state.children].map(([k, v]) => [k, [...v]])),
      parents: new Map(this.state.parents),
    };
  }
}

// ── Table ────────────────────────────────────────────────────────────────────

export type FakePageStatus = 'draft' | 'published' | 'changed' | 'scheduled' | 'failed';

export interface FakePageRow {
  id: string;
  title: string;
  path: string;
  status: FakePageStatus;
  locale: string;
  author: string;
  modified: Date;
}

export const FAKE_STATUSES: readonly { value: FakePageStatus; label: string; tone: SfStatusTone }[] = [
  { value: 'draft', label: 'Draft', tone: 'neutral' },
  { value: 'published', label: 'Published', tone: 'success' },
  { value: 'changed', label: 'Changed', tone: 'warning' },
  { value: 'scheduled', label: 'Scheduled', tone: 'info' },
  { value: 'failed', label: 'Failed', tone: 'danger' },
];

export const FAKE_LOCALES: readonly { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
];

const AUTHORS = ['Ada Lovelace', 'Grace Hopper', 'Linus', 'Margaret Hamilton', 'Alan Kay'];
const TITLE_A = ['Spring', 'Summer', 'Product', 'Company', 'Support', 'Event', 'Partner', 'Press', 'Career', 'Team'];
const TITLE_B = ['overview', 'teaser', 'details', 'news', 'gallery', 'downloads', 'contact', 'FAQ', 'campaign', 'archive'];

/** `count` page rows, modified at hourly-ish steps back from `now`. */
export function fakePageRows(count = 200, now = Date.now()): FakePageRow[] {
  return Array.from({ length: count }, (_, i) => {
    const a = TITLE_A[i % TITLE_A.length];
    const b = TITLE_B[Math.floor(i / TITLE_A.length) % TITLE_B.length];
    const folder = ROOT_FOLDERS[i % ROOT_FOLDERS.length];
    return {
      id: `page-${i + 1}`,
      title: `${a} ${b} ${Math.floor(i / 100) + 1}`,
      path: `/${folder}/${a.toLowerCase()}-${b.toLowerCase()}-${i + 1}.html`,
      status: FAKE_STATUSES[(i * 7) % FAKE_STATUSES.length].value,
      locale: FAKE_LOCALES[i % FAKE_LOCALES.length].value,
      author: AUTHORS[(i * 3) % AUTHORS.length],
      modified: new Date(now - (i * 97 + (i % 13) * 11) * 60_000),
    };
  });
}
