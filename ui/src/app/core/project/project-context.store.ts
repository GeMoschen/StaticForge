import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  catchError,
  finalize,
  forkJoin,
  map,
  Observable,
  of,
  tap,
} from 'rxjs';
import type { components } from '../api/generated/schema.d.ts';

type ProjectDetail = components['schemas']['ProjectDetail'];
type FolderView = components['schemas']['FolderView'];
type TemplateSummary = components['schemas']['TemplateSummary'];
type RevisionView = components['schemas']['RevisionView'];
type PageTemplateSummary = components['schemas']['PageTemplateSummary'];

@Injectable({ providedIn: 'root' })
export class ProjectContextStore {
  private readonly http = inject(HttpClient);

  readonly activeProjectKey = signal<string | null>(null);
  readonly project = signal<ProjectDetail | null>(null);
  readonly channels = signal<string[]>(['html']);
  readonly folderTree = signal<FolderView[]>([]);
  readonly pageTemplates = signal<TemplateSummary[]>([]);
  readonly sectionTemplates = signal<TemplateSummary[]>([]);
  readonly revisions = signal<RevisionView[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly currentRevision = computed<number | null>(() => {
    const revs = this.revisions();
    if (revs.length === 0) {
      return null;
    }
    return Math.max(...revs.map((r) => r.revisionId ?? 0));
  });

  loadFor(projectKey: string, force = false): Observable<void> {
    if (!force && this.activeProjectKey() === projectKey && this.project() !== null) {
      return of(undefined);
    }

    this.activeProjectKey.set(projectKey);
    this.loading.set(true);
    this.error.set(null);

    return forkJoin({
      detail: this.http.get<ProjectDetail>(`/api/v1/projects/${projectKey}`),
      folders: this.http.get<FolderView[]>(
        `/api/v1/projects/${projectKey}/folders?depth=10`,
      ),
      pageTemplates: this.http.get<PageTemplateSummary>(
        `/api/v1/projects/${projectKey}/page-templates`,
      ),
      sectionTemplates: this.http.get<PageTemplateSummary>(
        `/api/v1/projects/${projectKey}/section-templates`,
      ),
      revisions: this.http.get<RevisionView[]>(
        `/api/v1/projects/${projectKey}/revisions`,
      ),
    }).pipe(
      tap((res) => {
        this.project.set(res.detail);
        this.folderTree.set(res.folders ?? []);
        this.pageTemplates.set(res.pageTemplates.content ?? []);
        this.sectionTemplates.set(res.sectionTemplates.content ?? []);
        this.revisions.set(res.revisions ?? []);
      }),
      map(() => undefined),
      catchError(() => {
        this.error.set('Failed to load project');
        return of(undefined);
      }),
      finalize(() => this.loading.set(false)),
    );
  }

  refreshRevision(projectKey: string): void {
    this.http
      .get<RevisionView[]>(`/api/v1/projects/${projectKey}/revisions`)
      .subscribe({
        next: (revs) => this.revisions.set(revs ?? []),
        error: () => this.error.set('Failed to refresh revisions'),
      });
  }

  reset(): void {
    this.activeProjectKey.set(null);
    this.project.set(null);
    this.channels.set(['html']);
    this.folderTree.set([]);
    this.pageTemplates.set([]);
    this.sectionTemplates.set([]);
    this.revisions.set([]);
    this.loading.set(false);
    this.error.set(null);
  }
}
