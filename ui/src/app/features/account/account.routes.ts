import { Routes } from '@angular/router';
import { unsavedChangesGuard } from '../../core/editor/unsaved-changes.guard';
import { routeTitle } from '../../core/frame/route-title';
import { AccountPasswordComponent } from './account-password.component';
import { AccountPreferencesComponent } from './account-preferences.component';
import { AccountProfileComponent } from './account-profile.component';
import { AccountProjectsComponent } from './account-projects.component';
import { AccountSessionsComponent } from './account-sessions.component';
import { AccountShellComponent } from './account-shell.component';

/**
 * `/account/**` (M35.16): My account, one section per page. `/account` opens Profile; the old `/account#password`
 * link opens Password. Profile and Password ask before they are left with unsaved changes.
 */
export const ACCOUNT_ROUTES: Routes = [
  {
    path: 'account',
    component: AccountShellComponent,
    title: routeTitle('frame.section.account'),
    children: [
      { path: '', pathMatch: 'full', redirectTo: ({ fragment }) => (fragment === 'password' ? 'password' : 'profile') },
      { path: 'profile', component: AccountProfileComponent, title: routeTitle('frame.sub.account.profile'), canDeactivate: [unsavedChangesGuard] },
      { path: 'password', component: AccountPasswordComponent, title: routeTitle('frame.sub.account.password'), canDeactivate: [unsavedChangesGuard] },
      { path: 'preferences', component: AccountPreferencesComponent, title: routeTitle('frame.sub.account.preferences') },
      { path: 'projects', component: AccountProjectsComponent, title: routeTitle('frame.sub.account.projects') },
      { path: 'sessions', component: AccountSessionsComponent, title: routeTitle('frame.sub.account.sessions') },
    ],
  },
];
