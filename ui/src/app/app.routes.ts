import { Routes } from '@angular/router';
import { authGuard, loginGuard, projectMemberGuard } from './core/auth/auth.guard';
import { projectResolver } from './core/project/project.resolver';
import { LoginComponent } from './features/auth/login.component';
import { PasswordChangeComponent } from './features/auth/password-change.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { ProjectShellComponent } from './features/dashboard/project-shell.component';
import { PagesListComponent } from './features/pages/pages-list.component';
import { PageEditorComponent } from './features/pages/page-editor.component';
import { MediaLibraryComponent } from './features/media/media-library.component';
import { NavigationComponent } from './features/navigation/navigation.component';
import { TemplatesComponent } from './features/templates/templates.component';
import { ProjectSettingsShellComponent } from './features/settings/project-settings-shell.component';
import { ProjectSettingsGeneralComponent } from './features/settings/project-settings-general.component';
import { ProjectSettingsMediaComponent } from './features/settings/project-settings-media.component';
import { ChannelsComponent } from './features/channels/channels.component';
import { GenerationComponent } from './features/generation/generation.component';
import { RevisionsListComponent } from './features/revisions/revisions-list.component';
import { RevisionDiffComponent } from './features/revisions/revision-diff.component';

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
        path: 'media',
        component: MediaLibraryComponent,
      },
      {
        path: 'navigation',
        component: NavigationComponent,
      },
      {
        path: 'templates',
        component: TemplatesComponent,
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
            path: 'revisions',
            component: RevisionsListComponent,
          },
          {
            path: 'revisions/:revisionId',
            component: RevisionDiffComponent,
          },
          {
            path: 'url-registry',
            loadComponent: () =>
              import('./features/settings/project-settings-url-registry.component').then(
                (m) => m.ProjectSettingsUrlRegistryComponent,
              ),
          },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
