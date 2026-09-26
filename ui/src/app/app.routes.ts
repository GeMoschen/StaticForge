import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { authGuard, instanceAdminGuard, loginGuard, projectMemberGuard } from './core/auth/auth.guard';
import { passwordChangeGuard, setPasswordGuard } from './core/auth/password-change.guard';
import { projectResolver } from './core/project/project.resolver';
import { LoginComponent } from './features/auth/login.component';
import { AccountComponent } from './features/account/account.component';
import { SetPasswordComponent } from './features/account/set-password.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { ProjectShellComponent } from './features/dashboard/project-shell.component';
import { PagesListComponent } from './features/pages/pages-list.component';
import { PageEditorComponent } from './features/pages/page-editor.component';
import { NavigationComponent } from './features/navigation/navigation.component';
import { GlobalsComponent } from './features/globals/globals.component';
import { ProjectSettingsShellComponent } from './features/settings/project-settings-shell.component';
import { ProjectSettingsGeneralViewComponent } from './features/settings/project-settings-general-view.component';
import { ProjectSettingsGenerationViewComponent } from './features/settings/project-settings-generation-view.component';
import { ProjectSettingsMembersComponent } from './features/settings/project-settings-members.component';
import { RevisionsListComponent } from './features/revisions/revisions-list.component';
import { RevisionDiffComponent } from './features/revisions/revision-diff.component';
import { ProjectSettingsImportExportComponent } from './features/settings/project-settings-import-export.component';
import { ProjectSettingsUrlRegistryComponent } from './features/settings/project-settings-url-registry.component';
import { ContentComponent } from './features/content/content.component';
import { RecordEditorComponent } from './features/content/record-editor.component';
import { RecordSetViewComponent } from './features/content/record-set-view.component';
import { MediaLibraryComponent } from './features/media/media-library.component';
import { TemplatesComponent } from './features/templates/templates.component';
import { SearchPageComponent } from './features/search/search-page.component';
import { ChangesComponent } from './features/changes/changes.component';
import { SchedulesComponent } from './features/schedules/schedules.component';

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
    path: 'account/set-password',
    canMatch: [authGuard, setPasswordGuard],
    component: SetPasswordComponent,
  },
  // The old standalone password page is a section of My account now (M26).
  {
    path: 'account/password',
    redirectTo: () => inject(Router).createUrlTree(['/account'], { fragment: 'password' }),
  },
  {
    path: 'account',
    canMatch: [authGuard, passwordChangeGuard],
    component: AccountComponent,
  },
  {
    path: '',
    canMatch: [authGuard, passwordChangeGuard],
    component: DashboardComponent,
  },
  // Instance administration (M26) is the one lazy chunk: only instance admins open it, and it shares no editor
  // components with the rest of the app (the reason for the single bundle, see above).
  {
    path: 'admin',
    canMatch: [authGuard, passwordChangeGuard, instanceAdminGuard],
    loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  {
    path: 'p/:projectKey',
    canMatch: [authGuard, passwordChangeGuard, projectMemberGuard('VIEWER')],
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
            path: 'sets/:setUuid',
            component: RecordSetViewComponent,
          },
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
        path: 'changes',
        component: ChangesComponent,
      },
      {
        path: 'schedules',
        component: SchedulesComponent,
      },
      {
        path: 'settings',
        component: ProjectSettingsShellComponent,
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'general' },
          {
            path: 'general',
            component: ProjectSettingsGeneralViewComponent,
          },
          {
            path: 'members',
            component: ProjectSettingsMembersComponent,
          },
          {
            path: 'generation',
            component: ProjectSettingsGenerationViewComponent,
          },
          // The Channels, Languages and Media tabs are now sections of "General", and Targets a
          // section of "Generation"; their old paths stay as redirects so existing links keep working.
          { path: 'media', redirectTo: 'general' },
          { path: 'locales', redirectTo: 'general' },
          { path: 'channels', redirectTo: 'general' },
          { path: 'targets', redirectTo: 'generation' },
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
