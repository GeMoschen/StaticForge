import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * Administration (M26, spec §24 screen 11) inside the app frame (M35.10): the frame's top bar and rail carry the
 * navigation between the users, projects, system jobs (M29) and audit trail of the whole instance; this is the page
 * body.
 */
@Component({
  selector: 'sf-admin-shell',
  standalone: true,
  imports: [RouterOutlet, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="admin">
      <h1 class="admin__title">{{ 'frame.section.admin' | transloco }}</h1>
      <div class="admin__body">
        <router-outlet />
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .admin {
      padding: var(--sf-space-5) var(--sf-space-6) var(--sf-space-8);
    }
    .admin__title {
      margin: 0 0 var(--sf-space-4);
      color: var(--sf-text);
      font-size: var(--sf-fs-20);
      line-height: var(--sf-lh-20);
      font-weight: var(--sf-weight-semibold);
    }
  `,
})
export class AdminShellComponent {}
