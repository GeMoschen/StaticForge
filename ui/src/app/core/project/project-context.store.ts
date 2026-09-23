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
import { sortFolderTree } from '../../shared/tree-sort.util';

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
  /** The navigation tree's folders (`PAGE_REFERENCE` leaves). Entirely separate from the other two. */
  readonly navigationFolderTree = signal<FolderView[]>([]);
  /** The templates tree's folders — two fixed, protected roots ("Page Templates"/"Section Templates"), each holding one template kind. Entirely separate from the other three. */
  readonly templateFolderTree = signal<FolderView[]>([]);
  /** The Globals store's folders (`GLOBAL_SET` leaves). Entirely separate from the other four. */
  readonly globalsFolderTree = signal<FolderView[]>([]);
  /** The Content store's folders, with its record sets as `type: RECORD_SET` leaf nodes (M25). Entirely separate from the other five. */
  readonly contentFolderTree = signal<FolderView[]>([]);
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

  /**
   * Replaces the Content store's tree with one the Content screen just loaded (M25). Its folder and record-set
   * writes don't go through {@link loadFor}, so without this the shared tree — which the export picker and the
   * search page read — kept the folders of the project's first load. Ignored for another project than the
   * active one.
   */
  updateContentFolderTree(projectKey: string, tree: FolderView[]): void {
    if (this.activeProjectKey() === projectKey) {
      this.contentFolderTree.set(sortFolderTree(tree));
    }
  }

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
      navigationFolders: this.http.get<FolderView[]>(
        `/api/v1/projects/${projectKey}/folders?scope=NAVIGATION&depth=10`,
      ),
      templateFolders: this.http.get<FolderView[]>(
        `/api/v1/projects/${projectKey}/folders?scope=TEMPLATES&depth=10`,
      ),
      globalsFolders: this.http.get<FolderView[]>(
        `/api/v1/projects/${projectKey}/folders?scope=GLOBALS&depth=10`,
      ),
      contentFolders: this.http.get<FolderView[]>(
        `/api/v1/projects/${projectKey}/folders?scope=CONTENT&depth=10`,
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
        this.pageFolderTree.set(sortFolderTree(res.pageFolders ?? []));
        this.mediaFolderTree.set(sortFolderTree(res.mediaFolders ?? []));
        this.navigationFolderTree.set(sortFolderTree(res.navigationFolders ?? []));
        this.templateFolderTree.set(sortFolderTree(res.templateFolders ?? []));
        this.globalsFolderTree.set(sortFolderTree(res.globalsFolders ?? []));
        this.contentFolderTree.set(sortFolderTree(res.contentFolders ?? []));
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
    this.navigationFolderTree.set([]);
    this.templateFolderTree.set([]);
    this.globalsFolderTree.set([]);
    this.pageTemplates.set([]);
    this.sectionTemplates.set([]);
    this.revisions.set([]);
    this.loading.set(false);
    this.error.set(null);
  }
}
