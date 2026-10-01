import { Routes } from '@angular/router';

/** `/styleguide/**` (M35.9): the living style guide and the sample screen — a lazy chunk, guarded in `app.routes.ts`. */
export const STYLEGUIDE_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./styleguide-page.component').then((m) => m.StyleguidePageComponent),
  },
  {
    path: 'sample',
    loadComponent: () => import('./sample/sample-screen.component').then((m) => m.SampleScreenComponent),
  },
];
