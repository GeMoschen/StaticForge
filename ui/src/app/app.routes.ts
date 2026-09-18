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
import { ProjectSettingsLocalesComponent } from './features/settings/project-settings-locales.component';
import { ProjectSettingsMediaComponent } from './features/settings/project-settings-media.component';
import { ChannelsComponent } from './features/channels/channels.component';
import { GenerationComponent } from './features/generation/generation.component';
import { RevisionsListComponent } from './features/revisions/revisions-list.component';
import { RevisionDiffComponent } from './features/revisions/revision-diff.component';
import { ProjectSettingsImportExportComponent } from './features/settings/project-settings-import-export.component';
import { ProjectSettingsUrlRegistryComponent } from './features/settings/project-settings-url-registry.component';
import { ProjectSettingsTargetsComponent } from './features/settings/project-settings-targets.component';
import { ContentComponent } from './features/content/content.component';
import { RecordEditorComponent } from './features/content/record-editor.component';
import { MediaLibraryComponent } from './features/media/media-library.component';
import { TemplatesComponent } from './features/templates/templates.component';
import { SearchPageComponent } from './features/search/search-page.component';

/**
 * Every route component is imported eagerly: the app ships as one bundle with no lazy chunks (decided 2026-09-16 after
 * an "undefined ɵcmp" error opening a page with sections). The editor components import each other in a cycle
 * (section editor → content form → editor registry → catalog editor → section editor), which chunk boundaries make
 * fragile. The initial budget in `angular.json` is sized for the single bundle.
 */
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
        component: ContentComponent,
        children: [
          {
            path: 'records/:recordUuid',
            component: RecordEditorComponent,
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
        path: 'globals',
        component: GlobalsComponent,
      },
      {
        path: 'templates',
        component: TemplatesComponent,
      },
      {
        path: 'search',
        component: SearchPageComponent,
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
            path: 'locales',
            component: ProjectSettingsLocalesComponent,
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
