import { Routes } from '@angular/router';
import { authGuard, loginGuard, projectMemberGuard } from './core/auth/auth.guard';
import { projectResolver } from './core/project/project.resolver';
import { LoginComponent } from './features/auth/login.component';
import { PasswordChangeComponent } from './features/auth/password-change.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { ProjectShellComponent } from './features/dashboard/project-shell.component';
import { PagesListComponent } from './features/pages/pages-list.component';
import { PageEditorComponent } from './features/pages/page-editor.component';
import { NavigationComponent } from './features/navigation/navigation.component';
import { GlobalsComponent } from './features/globals/globals.component';
import { ProjectSettingsShellComponent } from './features/settings/project-settings-shell.component';
import { ProjectSettingsGeneralComponent } from './features/settings/project-settings-general.component';
import { ProjectSettingsMediaComponent } from './features/settings/project-settings-media.component';
import { ChannelsComponent } from './features/channels/channels.component';
import { GenerationComponent } from './features/generation/generation.component';
import { RevisionsListComponent } from './features/revisions/revisions-list.component';
import { RevisionDiffComponent } from './features/revisions/revision-diff.component';
import { ProjectSettingsImportExportComponent } from './features/settings/project-settings-import-export.component';
import { ProjectSettingsUrlRegistryComponent } from './features/settings/project-settings-url-registry.component';
import { ProjectSettingsTargetsComponent } from './features/settings/project-settings-targets.component';

export const routes: Routes = [
  {
    path: 'login',
    canMatch: [loginGuard],
    component: LoginComponent,
  },
  {
    path: 'account/password',
    canMatch: [authGuard],
    component: PasswordChangeComponent,
  },
  {
    path: '',
    canMatch: [authGuard],
    component: DashboardComponent,
  },
  {
    path: 'p/:projectKey',
    canMatch: [authGuard, projectMemberGuard('VIEWER')],
    resolve: { project: projectResolver },
    component: ProjectShellComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'pages' },
      {
        path: 'pages',
        component: PagesListComponent,
        children: [
          {
            path: ':uuid',
            component: PageEditorComponent,
          },
        ],
      },
      {
        path: 'content',
        // Lazy like media: the grid and record editor are only needed in the Content store.
        loadComponent: () => import('./features/content/content.component').then((m) => m.ContentComponent),
        children: [
          {
            path: 'records/:recordUuid',
            loadComponent: () =>
              import('./features/content/record-editor.component').then((m) => m.RecordEditorComponent),
          },
        ],
      },
      {
        path: 'media',
        // Lazy: the library, its drawer and the text media editor (M18) are the largest single
        // feature and only needed on this route, which keeps the initial bundle under its budget.
        loadComponent: () =>
          import('./features/media/media-library.component').then((m) => m.MediaLibraryComponent),
      },
      {
        path: 'navigation',
        component: NavigationComponent,
      },
      {
        path: 'globals',
        component: GlobalsComponent,
      },
      {
        path: 'templates',
        // Lazy since M19: the dataset schema editor joined the templates screen.
        loadComponent: () => import('./features/templates/templates.component').then((m) => m.TemplatesComponent),
      },
      {
        path: 'settings',
        component: ProjectSettingsShellComponent,
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'general' },
          {
            path: 'general',
            component: ProjectSettingsGeneralComponent,
          },
          {
            path: 'media',
            component: ProjectSettingsMediaComponent,
          },
          {
            path: 'channels',
            component: ChannelsComponent,
          },
          {
            path: 'generation',
            component: GenerationComponent,
          },
          {
            path: 'targets',
            component: ProjectSettingsTargetsComponent,
          },
          {
            path: 'revisions',
            component: RevisionsListComponent,
          },
          {
            path: 'revisions/:revisionId',
            component: RevisionDiffComponent,
          },
          {
            path: 'url-registry',
            component: ProjectSettingsUrlRegistryComponent,
          },
          {
            path: 'import-export',
            component: ProjectSettingsImportExportComponent,
          },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
