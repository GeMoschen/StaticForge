import { describe, expect, it } from 'vitest';
import { routes } from '../../app.routes';
import { instanceAdminGuard } from '../../core/auth/auth.guard';
import { AppFrameComponent } from '../frame/app-frame.component';
import { AdminJobDetailComponent } from './admin-job-detail.component';
import { AdminJobsComponent } from './admin-jobs.component';
import { ADMIN_ROUTES } from './admin.routes';

describe('admin routes (M29.5.1)', () => {
  it('serves the jobs list and a job under the admin shell', () => {
    const children = ADMIN_ROUTES[0].children ?? [];
    expect(children.find((route) => route.path === 'jobs')?.component).toBe(AdminJobsComponent);
    expect(children.find((route) => route.path === 'jobs/:key')?.component).toBe(AdminJobDetailComponent);
  });

  it('loads the admin chunk only for instance admins', () => {
    const frame = routes.find((route) => route.component === AppFrameComponent);
    const admin = frame?.children?.find((route) => route.path === 'admin');
    expect(admin?.canMatch).toContain(instanceAdminGuard);
  });
});
