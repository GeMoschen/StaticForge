import { Injectable, signal } from '@angular/core';
import type { SfTreeNode } from '../components/tree/tree-model';

export type ClipboardAssetType = 'PAGE' | 'MEDIA' | 'FOLDER' | 'TEMPLATE';

/** Only meaningful when `assetType` is `'FOLDER'` (cut from within the templates tree) or `'TEMPLATE'` — lets a templates-tree paste target reject a cross-kind drop (a page template pasted into "Section Templates", a dataset into a template folder, …) without a round-trip to the backend's 422. */
export type ClipboardTemplateKind = 'PAGE_TEMPLATE' | 'SECTION_TEMPLATE' | 'DATASET';

export interface ClipboardEntry {
  mode: 'cut' | 'copy';
  assetType: ClipboardAssetType;
  uuid: string;
  label: string;
  templateKind?: ClipboardTemplateKind;
}

/**
 * Nodes cut or copied in an `sf-tree` (M35.8). `scope` names the tree family (e.g. `pages`): a tree pastes only what
 * a tree of its own scope put here.
 */
export interface TreeClipboardNodes {
  mode: 'cut' | 'copy';
  scope: string;
  nodes: readonly SfTreeNode[];
}

/**
 * Root-provided cut/copy/paste clipboard shared by the pages tree, the
 * media tree, and the templates tree. Holds only the pending item + mode;
 * the actual API calls (move for cut, duplicate+move for copy) live in each
 * list component since they differ per asset type.
 */
@Injectable({ providedIn: 'root' })
export class TreeClipboardService {
  readonly entry = signal<ClipboardEntry | null>(null);
  /** What an `sf-tree` cut or copied. There is one clipboard: setting either this or {@link entry} clears the other. */
  readonly nodes = signal<TreeClipboardNodes | null>(null);

  cut(assetType: ClipboardAssetType, uuid: string, label: string, templateKind?: ClipboardTemplateKind): void {
    this.nodes.set(null);
    this.entry.set({ mode: 'cut', assetType, uuid, label, templateKind });
  }

  copy(assetType: ClipboardAssetType, uuid: string, label: string, templateKind?: ClipboardTemplateKind): void {
    this.nodes.set(null);
    this.entry.set({ mode: 'copy', assetType, uuid, label, templateKind });
  }

  cutNodes(scope: string, nodes: readonly SfTreeNode[]): void {
    this.entry.set(null);
    this.nodes.set({ mode: 'cut', scope, nodes });
  }

  copyNodes(scope: string, nodes: readonly SfTreeNode[]): void {
    this.entry.set(null);
    this.nodes.set({ mode: 'copy', scope, nodes });
  }

  clear(): void {
    this.entry.set(null);
    this.nodes.set(null);
  }
}
