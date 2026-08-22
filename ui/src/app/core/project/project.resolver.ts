import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { map } from 'rxjs';
import { ProjectContextStore } from './project-context.store';
import type { components } from '../api/generated/schema.d.ts';

type ProjectDetail = components['schemas']['ProjectDetail'];

export const projectResolver: ResolveFn<ProjectDetail> = (route) => {
  const store = inject(ProjectContextStore);
  const key = route.paramMap.get('projectKey');

  if (!key) {
    return store.project() ?? {};
  }

  return store.loadFor(key).pipe(map(() => store.project() ?? { key }));
};
