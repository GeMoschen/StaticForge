import { Routes } from '@angular/router';
import { routeTitle } from '../../core/frame/route-title';
import { AdminAuditComponent } from './admin-audit.component';
import { AdminJobDetailComponent } from './admin-job-detail.component';
import { AdminJobsComponent } from './admin-jobs.component';
import { AdminProjectsComponent } from './admin-projects.component';
import { AdminShellComponent } from './admin-shell.component';
import { AdminUserDetailComponent } from './admin-user-detail.component';
import { AdminUsersComponent } from './admin-users.component';

/** `/admin/**` (M26, instance admins only — guarded where the chunk is loaded in `app.routes.ts`). */
export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    component: AdminShellComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'users' },
      { path: 'users', component: AdminUsersComponent, title: routeTitle('frame.sub.admin.users') },
      { path: 'users/:id', component: AdminUserDetailComponent, title: routeTitle('frame.sub.admin.users') },
      { path: 'projects', component: AdminProjectsComponent, title: routeTitle('frame.sub.admin.projects') },
      { path: 'jobs', component: AdminJobsComponent, title: routeTitle('frame.sub.admin.jobs') },
      { path: 'jobs/:key', component: AdminJobDetailComponent, title: routeTitle('frame.sub.admin.jobs') },
      { path: 'audit', component: AdminAuditComponent, title: routeTitle('frame.sub.admin.audit') },
    ],
  },
];
