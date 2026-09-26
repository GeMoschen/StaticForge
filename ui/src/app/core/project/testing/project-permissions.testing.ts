import { Injector, Provider, StaticProvider, computed, inject } from '@angular/core';
import { AuthStore } from '../../auth/auth.store';
import { ProjectAccessStore } from '../project-access.store';
import { ProjectContextStore } from '../project-context.store';
import { ProjectPermissionsStore } from '../project-permissions.store';

/** What a spec's user is in the open project; anything left out comes from the spec's own providers. */
export interface TestPermissionOptions {
  /** The effective role; omitted, the spec's `AuthStore.roleFor` decides. */
  role?: () => string | null;
  /** `ProjectDetail.permissions` as the server would send them. */
  permissions?: () => string[];
  /** Read-only (time travel, archived); omitted, the spec's `ProjectAccessStore` decides. */
  readOnly?: () => boolean;
  userId?: () => number | null;
  projectKey?: string;
}

/**
 * The real {@link ProjectPermissionsStore} over stubbed inputs, for component specs: the component under test reads
 * its rights exactly as in the app, while the spec states the role, the server's publish permissions and the
 * read-only state. Pass functions so a spec can read its own signals (e.g. `() => timeTravel.isTimeTravel()`).
 */
export function provideProjectPermissions(options: TestPermissionOptions = {}): Provider {
  return {
    provide: ProjectPermissionsStore,
    useFactory: () => {
      const parent = inject(Injector);
      const providers: StaticProvider[] = [
        { provide: ProjectPermissionsStore, useClass: ProjectPermissionsStore, deps: [] },
        {
          provide: ProjectContextStore,
          useValue: {
            activeProjectKey: computed(() => options.projectKey ?? 'proj'),
            project: computed(() => ({ permissions: options.permissions?.() ?? [] })),
          },
        },
      ];
      if (options.role || options.userId) {
        const auth = parent.get(AuthStore, null, { optional: true });
        providers.push({
          provide: AuthStore,
          useValue: {
            roleFor: (key: string) => (options.role ? options.role() : (auth?.roleFor(key) ?? null)),
            userId: computed(() =>
              options.userId ? options.userId() : typeof auth?.userId === 'function' ? auth.userId() : null,
            ),
          },
        });
      }
      if (options.readOnly) {
        const readOnly = options.readOnly;
        providers.push({ provide: ProjectAccessStore, useValue: { readOnly: computed(() => readOnly()) } });
      }
      return Injector.create({ providers, parent }).get(ProjectPermissionsStore);
    },
  };
}
