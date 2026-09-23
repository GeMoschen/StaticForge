import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { components } from '../api/generated/schema.d.ts';
import { ProjectContextStore } from './project-context.store';

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
