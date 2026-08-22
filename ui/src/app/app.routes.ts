import { Routes } from '@angular/router';
import { authGuard, loginGuard, projectMemberGuard } from './core/auth/auth.guard';
import { projectResolver } from './core/project/project.resolver';

export const routes: Routes = [
  {
    path: 'login',
    canMatch: [loginGuard],
    loadComponent: () =>
      import('./features/auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'account/password',
    canMatch: [authGuard],
    loadComponent: () =>
      import('./features/auth/password-change.component').then(
        (m) => m.PasswordChangeComponent,
      ),
  },
  {
    path: '',
    canMatch: [authGuard],
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then(
        (m) => m.DashboardComponent,
      ),
  },
  {
    path: 'p/:projectKey',
    canMatch: [authGuard, projectMemberGuard('VIEWER')],
    resolve: { project: projectResolver },
    loadComponent: () =>
      import('./features/dashboard/project-shell.component').then(
        (m) => m.ProjectShellComponent,
      ),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'pages' },
      {
        path: 'pages',
        loadComponent: () =>
          import('./features/pages/pages-list.component').then(
            (m) => m.PagesListComponent,
          ),
      },
      {
        path: 'pages/:uuid',
        loadComponent: () =>
          import('./features/pages/page-editor.component').then(
            (m) => m.PageEditorComponent,
          ),
      },
      {
        path: 'media',
        loadComponent: () =>
          import('./features/media/media-library.component').then(
            (m) => m.MediaLibraryComponent,
          ),
      },
      {
        path: 'generation',
        loadComponent: () =>
          import('./features/generation/generation.component').then(
            (m) => m.GenerationComponent,
          ),
      },
      {
        path: 'structures',
        loadComponent: () =>
          import('./features/structures/structures.component').then(
            (m) => m.StructuresComponent,
          ),
      },
      {
        path: 'templates',
        loadComponent: () =>
          import('./features/templates/templates.component').then(
            (m) => m.TemplatesComponent,
          ),
      },
      {
        path: 'channels',
        loadComponent: () =>
          import('./features/channels/channels.component').then(
            (m) => m.ChannelsComponent,
          ),
      },
      {
        path: 'revisions',
        loadComponent: () =>
          import('./features/revisions/revisions-list.component').then(
            (m) => m.RevisionsListComponent,
          ),
      },
      {
        path: 'revisions/:revisionId',
        loadComponent: () =>
          import('./features/revisions/revision-diff.component').then(
            (m) => m.RevisionDiffComponent,
          ),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
