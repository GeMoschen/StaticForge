import { Injectable, inject, signal } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';

type RevisionView = components['schemas']['RevisionView'];

export interface RevisionFilters {
  since?: number;
  userId?: number;
  assetUuid?: string;
  changeType?: string;
}

@Injectable({ providedIn: 'root' })
export class RevisionsService {
  private readonly api = inject(ApiClient);

  readonly revisions = signal<RevisionView[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly filters = signal<RevisionFilters>({});

  private projectKey = '';

  load(projectKey: string): void {
    this.projectKey = projectKey;
    const f = this.filters();
    this.loading.set(true);
    this.error.set(null);
    this.api
      .listRevisions(projectKey, {
        since: f.since,
        userId: f.userId,
        assetUuid: f.assetUuid,
      })
      .subscribe({
        next: (revs) => {
          const changeType = f.changeType;
          this.revisions.set(
            changeType
              ? (revs ?? []).filter((r) => r.changeType === changeType)
              : (revs ?? []),
          );
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Could not load revisions — check your connection and try again.');
          this.loading.set(false);
        },
      });
  }

  setFilter(patch: Partial<RevisionFilters>): void {
    this.filters.update((current) => ({ ...current, ...patch }));
    if (this.projectKey) {
      this.load(this.projectKey);
    }
  }

  reset(): void {
    this.revisions.set([]);
    this.filters.set({});
    this.error.set(null);
    this.loading.set(false);
    this.projectKey = '';
  }
}
