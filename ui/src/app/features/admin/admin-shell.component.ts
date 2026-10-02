import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Administration (M26, spec §24 screen 11) inside the app frame (M35.10): the frame's top bar and rail carry the
 * navigation between the users, projects, system jobs (M29) and audit trail of the whole instance; this is the page
 * body. Every page brings its own `sf-page-header` (the one `h1`) and fills the height it is given (M35.16).
 */
@Component({
  selector: 'sf-admin-shell',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet />`,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
  `,
})
export class AdminShellComponent {}
