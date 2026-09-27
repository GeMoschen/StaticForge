import { Injectable, computed, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TimeTravelStore {
  readonly activeRevision = signal<number | null>(null);

  readonly isTimeTravel = computed(() => this.activeRevision() !== null);

  /**
   * The revisions at which a read came back compacted (`X-SF-Compacted: true` or `AssetDetailView.compacted`, M29.4.3),
   * reported by `compactedReadInterceptor`.
   */
  private readonly compactedReads = signal<ReadonlySet<number>>(new Set());

  /** Whether a read at the travelled-to revision showed compacted history (M29.5.2). */
  readonly readCompacted = computed(() => {
    const revision = this.activeRevision();
    return revision !== null && this.compactedReads().has(revision);
  });

  enter(revision: number): void {
    this.activeRevision.set(revision);
  }

  exit(): void {
    this.activeRevision.set(null);
    this.compactedReads.set(new Set());
  }

  /** Records that a read at `revision` returned compacted history. */
  noteCompactedRead(revision: number): void {
    if (this.compactedReads().has(revision)) {
      return;
    }
    const next = new Set(this.compactedReads());
    next.add(revision);
    this.compactedReads.set(next);
  }
}
