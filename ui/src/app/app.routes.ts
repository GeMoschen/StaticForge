import { Routes } from '@angular/router';
import { authGuard, instanceAdminGuard, loginGuard, projectMemberGuard } from './core/auth/auth.guard';
import { passwordChangeGuard, setPasswordGuard } from './core/auth/password-change.guard';
import { styleguideGuard } from './features/styleguide/styleguide.guard';
import { unsavedChangesGuard } from './core/editor/unsaved-changes.guard';
import { developerModeGuard } from './core/frame/developer-mode.guard';
import { routeTitle } from './core/frame/route-title';
import { projectResolver } from './core/project/project.resolver';
import { LoginComponent } from './features/auth/login.component';
import { ACCOUNT_ROUTES } from './features/account/account.routes';
import { SetPasswordComponent } from './features/account/set-password.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { ProjectShellComponent } from './features/dashboard/project-shell.component';
import { AppFrameComponent } from './features/frame/app-frame.component';
import { PagesListComponent } from './features/pages/pages-list.component';
import { PageEditorComponent } from './features/pages/page-editor.component';
import { NavigationComponent } from './features/navigation/navigation.component';
import { navigationLeaveGuard } from './features/navigation/navigation-leave.guard';
import { GlobalsComponent } from './features/globals/globals.component';
import { globalsLeaveGuard } from './features/globals/globals-leave.guard';
import { ProjectSettingsGeneralComponent } from './features/settings/project-settings-general.component';
import { ProjectSettingsLocalesComponent } from './features/settings/project-settings-locales.component';
import { ProjectSettingsMediaComponent } from './features/settings/project-settings-media.component';
import { ProjectSettingsCodeHighlightingPageComponent } from './features/settings/project-settings-code-highlighting-page.component';
import { ProjectSettingsCompactionComponent } from './features/settings/project-settings-compaction.component';
import { ProjectSettingsMembersComponent } from './features/settings/project-settings-members.component';
import { ProjectSettingsImportExportComponent } from './features/settings/project-settings-import-export.component';
import { ProjectSettingsUrlRegistryComponent } from './features/settings/project-settings-url-registry.component';
import { ProjectSettingsQualityComponent } from './features/settings/project-settings-quality.component';
import { ProjectSettingsRedirectsComponent } from './features/settings/project-settings-redirects.component';
import { ProjectSettingsTargetsComponent } from './features/settings/project-settings-targets.component';
import { ProjectSettingsPublishPolicyComponent } from './features/settings/project-settings-publish-policy.component';
import { SettingsShellComponent } from './features/settings/settings-shell.component';
import { ChannelsComponent } from './features/channels/channels.component';
import { PublishingShellComponent } from './features/publishing/publishing-shell.component';
import { PublishingRunsComponent } from './features/publishing/publishing-runs.component';
import { HistoryPageComponent } from './features/history/history-page.component';
import { ContentComponent } from './features/content/content.component';
import { RecordEditorComponent } from './features/content/record-editor.component';
import { RecordSetViewComponent } from './features/content/record-set-view.component';
import { MediaLibraryComponent } from './features/media/media-library.component';
import { mediaLeaveGuard } from './features/media/media-leave.guard';
import { TemplateEditorComponent } from './features/templates/template-editor.component';
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
/** Settings pages that moved, as `[old sub-path, new path]` below the project (see the routes). */
export const MOVED_FROM_SETTINGS: readonly (readonly [string, string])[] = [
  ['generation', 'publishing/runs'],
  ['targets', 'publishing/targets'],
  ['quality', 'publishing/quality'],
  ['redirects', 'publishing/redirects'],
  ['url-registry', 'publishing/urls'],
  ['revisions/:revisionId', 'history/:revisionId'],
  ['revisions', 'history'],
];

export const routes: Routes = [
  {
    // The living style guide (M35.9): dev builds, or instance admins.
    path: 'styleguide',
    canMatch: [styleguideGuard],
    loadChildren: () => import('./features/styleguide/styleguide.routes').then((m) => m.STYLEGUIDE_ROUTES),
  },
  {
    path: 'login',
    canMatch: [loginGuard],
    component: LoginComponent,
    title: routeTitle('frame.title.login'),
  },
  {
    path: 'account/set-password',
    canMatch: [authGuard, setPasswordGuard],
    component: SetPasswordComponent,
    title: routeTitle('frame.title.setPassword'),
  },
  {
    // The app frame (M35.10): top bar, rail and banners around every authenticated screen.
    path: '',
    canMatch: [authGuard, passwordChangeGuard],
    component: AppFrameComponent,
    children: [
      ...ACCOUNT_ROUTES,
      {
        path: '',
        pathMatch: 'full',
        component: DashboardComponent,
        title: routeTitle('frame.section.dashboard'),
      },
      // Instance administration (M26) is the one lazy chunk: only instance admins open it, and it shares no editor
      // components with the rest of the app (the reason for the single bundle, see above).
      {
        path: 'admin',
        canMatch: [instanceAdminGuard],
        title: routeTitle('frame.section.admin'),
        loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
      },
      {
        path: 'p/:projectKey',
        canMatch: [projectMemberGuard('VIEWER')],
        resolve: { project: projectResolver },
        component: ProjectShellComponent,
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'pages' },
          {
            path: 'pages',
            title: routeTitle('frame.section.pages'),
            component: PagesListComponent,
            children: [
              {
                // Another page, or leaving the editor, asks about unsaved changes first (M35.13).
                path: ':uuid',
                canDeactivate: [unsavedChangesGuard],
                component: PageEditorComponent,
              },
            ],
          },
          {
            path: 'content',
            title: routeTitle('frame.section.content'),
            component: ContentComponent,
            children: [
              {
                path: 'sets/:setUuid',
                component: RecordSetViewComponent,
              },
              {
                path: 'records/:recordUuid',
                canDeactivate: [unsavedChangesGuard],
                component: RecordEditorComponent,
              },
            ],
          },
          {
            path: 'media',
            title: routeTitle('frame.section.media'),
            // The detail drawer's unsaved edits: another file, closing it or leaving the library asks first (M35.19).
            canDeactivate: [mediaLeaveGuard],
            runGuardsAndResolvers: 'always',
            component: MediaLibraryComponent,
          },
          {
            path: 'navigation',
            title: routeTitle('frame.section.navigation'),
            // Unsaved edits in the open menu item: another entry, the Favorites list or leaving the area asks first (M35.22).
            canDeactivate: [navigationLeaveGuard],
            runGuardsAndResolvers: 'always',
            component: NavigationComponent,
          },
          {
            path: 'globals',
            title: routeTitle('frame.section.globals'),
            // Unsaved edits in the open global set: another set, a folder or leaving the area asks first (M35.22).
            canDeactivate: [globalsLeaveGuard],
            runGuardsAndResolvers: 'always',
            component: GlobalsComponent,
          },
          {
            path: 'templates',
            title: routeTitle('frame.section.templates'),
            component: TemplatesComponent,
            children: [
              {
                // Another template, a folder or leaving the area asks about unsaved changes first (M35.13).
                path: ':uuid',
                canDeactivate: [unsavedChangesGuard],
                component: TemplateEditorComponent,
              },
            ],
          },
          {
            path: 'search',
            title: routeTitle('frame.section.search'),
            component: SearchPageComponent,
          },
          {
            path: 'changes',
            title: routeTitle('frame.section.changes'),
            component: ChangesComponent,
          },
          {
            path: 'schedules',
            title: routeTitle('frame.section.schedules'),
            component: SchedulesComponent,
          },
          // Pages that moved out of Settings (M35.11): Publishing took over Generation, Targets, Quality, Redirects and
          // URLs, History took over Revisions. Each redirect keeps the query (`?run=`) and a revision's id; they sit
          // before `settings` so its shell never matches them.
          ...MOVED_FROM_SETTINGS.map(([from, to]) => ({ path: `settings/${from}`, redirectTo: to })),
          {
            // Publishing (M35.11): the runs, where they go and how, and the checks on what they produce.
            path: 'publishing',
            title: routeTitle('frame.section.publishing'),
            component: PublishingShellComponent,
            children: [
              { path: '', pathMatch: 'full', redirectTo: 'runs' },
              { path: 'runs', title: routeTitle('frame.sub.publishing.runs'), component: PublishingRunsComponent },
              { path: 'targets', title: routeTitle('frame.sub.publishing.targets'), component: ProjectSettingsTargetsComponent },
              { path: 'policy', title: routeTitle('frame.sub.publishing.policy'), component: ProjectSettingsPublishPolicyComponent },
              { path: 'quality', title: routeTitle('frame.sub.publishing.quality'), component: ProjectSettingsQualityComponent },
              { path: 'redirects', title: routeTitle('frame.sub.publishing.redirects'), component: ProjectSettingsRedirectsComponent },
              { path: 'urls', title: routeTitle('frame.sub.publishing.urls'), component: ProjectSettingsUrlRegistryComponent },
            ],
          },
          // The project's history (M35.12): the timeline, and a revision's detail beside it. It was Settings › Revisions.
          { path: 'history', title: routeTitle('frame.section.history'), component: HistoryPageComponent },
          { path: 'history/:revisionId', title: routeTitle('frame.section.history'), component: HistoryPageComponent },
          {
            path: 'settings',
            title: routeTitle('frame.section.settings'),
            component: SettingsShellComponent,
            children: [
              { path: '', pathMatch: 'full', redirectTo: 'general' },
              { path: 'general', title: routeTitle('frame.sub.settings.general'), component: ProjectSettingsGeneralComponent },
              { path: 'languages', title: routeTitle('frame.sub.settings.languages'), component: ProjectSettingsLocalesComponent },
              {
                path: 'channels',
                title: routeTitle('frame.sub.settings.channels'),
                canActivate: [developerModeGuard('general')],
                component: ChannelsComponent,
              },
              { path: 'media', title: routeTitle('frame.sub.settings.media'), component: ProjectSettingsMediaComponent },
              {
                path: 'code-highlighting',
                title: routeTitle('frame.sub.settings.code-highlighting'),
                component: ProjectSettingsCodeHighlightingPageComponent,
              },
              { path: 'compaction', title: routeTitle('frame.sub.settings.compaction'), component: ProjectSettingsCompactionComponent },
              {
                path: 'import-export',
                title: routeTitle('frame.sub.settings.import-export'),
                component: ProjectSettingsImportExportComponent,
              },
              { path: 'members', title: routeTitle('frame.sub.settings.members'), component: ProjectSettingsMembersComponent },
              // The Languages tab was called Locales.
              { path: 'locales', redirectTo: 'languages' },
            ],
          },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
