import { Injectable, computed, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TimeTravelStore {
  readonly activeRevision = signal<number | null>(null);

  readonly isTimeTravel = computed(() => this.activeRevision() !== null);

  enter(revision: number): void {
    this.activeRevision.set(revision);
  }

  exit(): void {
    this.activeRevision.set(null);
  }
}
