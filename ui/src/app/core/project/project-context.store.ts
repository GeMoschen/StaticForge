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
  /** The pages tree's folders. Entirely separate from `mediaFolderTree` — the two stores never share a folder. */
  readonly pageFolderTree = signal<FolderView[]>([]);
  /** The media library's folders. Entirely separate from `pageFolderTree`. */
  readonly mediaFolderTree = signal<FolderView[]>([]);
  readonly pageTemplates = signal<TemplateSummary[]>([]);
  readonly sectionTemplates = signal<TemplateSummary[]>([]);
  readonly revisions = signal<RevisionView[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /**
   * Set to a page's uuid whenever its bodies/sections change from outside its own editor
   * (e.g. a cross-page section move), so any loaded nav-tree node for it can refresh.
   * Uses `equal: () => false` so two mutations of the *same* page in a row (e.g. add a
   * section, then remove one) each still notify — the default signal equality would treat
   * the second `set()` with an identical uuid as a no-op and silently skip the effect.
   */
  readonly pageMutated = signal<string | null>(null, { equal: () => false });

  notifyPageChanged(uuid: string): void {
    this.pageMutated.set(uuid);
  }

  /** The page currently open in the editor, so its nav-tree node can auto-expand. Once set for a page, that node is never auto-collapsed again. */
  readonly activePageUuid = signal<string | null>(null);
  /** The `?body=`/`?section=` currently focused in the editor (if any), so the nav tree can highlight the matching row. */
  readonly activeBodyName = signal<string | null>(null);
  readonly activeSectionInstanceId = signal<string | null>(null);

  setActivePage(uuid: string | null, bodyName: string | null = null, sectionInstanceId: string | null = null): void {
    this.activePageUuid.set(uuid);
    this.activeBodyName.set(bodyName);
    this.activeSectionInstanceId.set(sectionInstanceId);
  }

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
      pageFolders: this.http.get<FolderView[]>(
        `/api/v1/projects/${projectKey}/folders?scope=PAGES&depth=10`,
      ),
      mediaFolders: this.http.get<FolderView[]>(
        `/api/v1/projects/${projectKey}/folders?scope=MEDIA&depth=10`,
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
        this.pageFolderTree.set(res.pageFolders ?? []);
        this.mediaFolderTree.set(res.mediaFolders ?? []);
        this.pageTemplates.set(res.pageTemplates.content ?? []);
        this.sectionTemplates.set(res.sectionTemplates.content ?? []);
        this.revisions.set(res.revisions ?? []);
      }),
      map(() => undefined),
      catchError(() => {
        this.error.set('Could not load project — check your connection and try again.');
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
        error: () => this.error.set('Could not refresh revisions — check your connection and try again.'),
      });
  }

  reset(): void {
    this.activeProjectKey.set(null);
    this.project.set(null);
    this.channels.set(['html']);
    this.pageFolderTree.set([]);
    this.mediaFolderTree.set([]);
    this.pageTemplates.set([]);
    this.sectionTemplates.set([]);
    this.revisions.set([]);
    this.loading.set(false);
    this.error.set(null);
  }
}
