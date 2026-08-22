import { Injectable, signal } from '@angular/core';

export type ClipboardAssetType = 'PAGE' | 'MEDIA' | 'FOLDER';

export interface ClipboardEntry {
  mode: 'cut' | 'copy';
  assetType: ClipboardAssetType;
  uuid: string;
  label: string;
}

/**
 * Root-provided cut/copy/paste clipboard shared by the pages tree and the
 * media tree. Holds only the pending item + mode; the actual API calls
 * (move for cut, duplicate+move for copy) live in each list component since
 * they differ per asset type.
 */
@Injectable({ providedIn: 'root' })
export class TreeClipboardService {
  readonly entry = signal<ClipboardEntry | null>(null);

  cut(assetType: ClipboardAssetType, uuid: string, label: string): void {
    this.entry.set({ mode: 'cut', assetType, uuid, label });
  }

  copy(assetType: ClipboardAssetType, uuid: string, label: string): void {
    this.entry.set({ mode: 'copy', assetType, uuid, label });
  }

  clear(): void {
    this.entry.set(null);
  }
}
