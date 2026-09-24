import { Routes } from '@angular/router';
import { AdminAuditComponent } from './admin-audit.component';
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
      { path: 'users', component: AdminUsersComponent },
      { path: 'users/:id', component: AdminUserDetailComponent },
      { path: 'projects', component: AdminProjectsComponent },
      { path: 'audit', component: AdminAuditComponent },
    ],
  },
];
