import { Injectable, signal } from '@angular/core';

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
 * Root-provided cut/copy/paste clipboard shared by the pages tree, the
 * media tree, and the templates tree. Holds only the pending item + mode;
 * the actual API calls (move for cut, duplicate+move for copy) live in each
 * list component since they differ per asset type.
 */
@Injectable({ providedIn: 'root' })
export class TreeClipboardService {
  readonly entry = signal<ClipboardEntry | null>(null);

  cut(assetType: ClipboardAssetType, uuid: string, label: string, templateKind?: ClipboardTemplateKind): void {
    this.entry.set({ mode: 'cut', assetType, uuid, label, templateKind });
  }

  copy(assetType: ClipboardAssetType, uuid: string, label: string, templateKind?: ClipboardTemplateKind): void {
    this.entry.set({ mode: 'copy', assetType, uuid, label, templateKind });
  }

  clear(): void {
    this.entry.set(null);
  }
}
