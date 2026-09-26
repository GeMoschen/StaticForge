import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';
import type { components } from '../api/generated/schema.d.ts';
import { ProjectContextStore } from './project-context.store';
import { projectDetail } from './testing/project-detail.fixture';

type FolderView = components['schemas']['FolderView'];

const TREE: FolderView[] = [
  {
    uuid: 'root',
    uid: 'content_root',
    path: '/content_root/',
    type: 'FOLDER',
    children: [
      { uuid: 'b', uid: 'zeta', displayName: 'zeta', path: '/content_root/zeta/', type: 'FOLDER', children: [] },
      { uuid: 'a', uid: 'staff', displayName: 'staff', path: '/content_root/staff/', type: 'FOLDER', children: [] },
    ],
  },
];

describe('ProjectContextStore.updateContentFolderTree', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  function store(): ProjectContextStore {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const instance = TestBed.inject(ProjectContextStore);
    instance.activeProjectKey.set('proj');
    return instance;
  }

  it("replaces the active project's Content tree, sorted like a load", () => {
    const context = store();

    context.updateContentFolderTree('proj', TREE);

    expect(context.contentFolderTree()[0].children?.map((f) => f.displayName)).toEqual(['staff', 'zeta']);
  });

  it("ignores another project's tree", () => {
    const context = store();

    context.updateContentFolderTree('other', TREE);

    expect(context.contentFolderTree()).toEqual([]);
  });
});

describe('ProjectContextStore detail refresh (M28.3.1)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', children: [] }]),
      ],
    });
    const context = TestBed.inject(ProjectContextStore);
    context.activeProjectKey.set('proj');
    context.project.set(projectDetail([]));
    return { context, router: TestBed.inject(Router), http: TestBed.inject(HttpTestingController) };
  }

  it('re-reads the permissions on every navigation inside the project, however soon after the last read', async () => {
    const { context, router, http } = await setup();

    await router.navigateByUrl('/p/proj/pages');
    http.expectOne('/api/v1/projects/proj').flush(projectDetail([]));
    // The policy changes; the very next navigation shows it, even right after a read.
    await router.navigateByUrl('/p/proj/changes');
    http.expectOne('/api/v1/projects/proj').flush(projectDetail(['RELEASE']));

    expect(context.project()?.permissions).toEqual(['RELEASE']);
  });

  it('a navigation during a read gets one more read that starts after it; a burst shares it', async () => {
    const { context, router, http } = await setup();

    await router.navigateByUrl('/p/proj/pages');
    const first = http.expectOne('/api/v1/projects/proj');
    await router.navigateByUrl('/p/proj/changes');
    await router.navigateByUrl('/p/proj/schedules');
    http.expectNone('/api/v1/projects/proj');

    first.flush(projectDetail([]));
    http.expectOne('/api/v1/projects/proj').flush(projectDetail(['RELEASE', 'INCREMENTAL_BUILD']));

    expect(context.project()?.permissions).toEqual(['RELEASE', 'INCREMENTAL_BUILD']);
  });
});
