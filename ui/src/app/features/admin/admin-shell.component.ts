import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { UserMenuComponent } from '../account/user-menu.component';

/** Administration (M26, spec §24 screen 11): users, projects and the audit trail of the whole instance. */
@Component({
  selector: 'sf-admin-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, SfIconComponent, UserMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="admin">
      <header class="admin__bar">
        <a class="admin__back" routerLink="/"><sf-icon name="arrow_back" /> Projects</a>
        <sf-user-menu />
      </header>
      <h1 class="admin__title">Administration</h1>
      <nav class="admin__tabs" aria-label="Administration">
        <a class="admin__tab" routerLink="users" routerLinkActive="admin__tab--active" ariaCurrentWhenActive="page">
          Users
        </a>
        <a class="admin__tab" routerLink="projects" routerLinkActive="admin__tab--active" ariaCurrentWhenActive="page">
          Projects
        </a>
        <a class="admin__tab" routerLink="audit" routerLinkActive="admin__tab--active" ariaCurrentWhenActive="page">
          Audit
        </a>
      </nav>
      <main class="admin__body">
        <router-outlet />
      </main>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .admin {
      max-width: 1200px;
      margin: 0 auto;
      padding: var(--sf-5) var(--sf-6) var(--sf-7);
    }
    .admin__bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--sf-3);
      margin-bottom: var(--sf-3);
    }
    .admin__back {
      display: inline-flex;
      align-items: center;
      gap: var(--sf-1);
      color: var(--sf-slate);
      font-size: var(--sf-text-sm);
      text-decoration: none;
    }
    .admin__back:hover {
      color: var(--sf-ink);
    }
    .admin__title {
      margin: 0 0 var(--sf-4);
      font-family: var(--sf-font-display);
      font-size: var(--sf-text-2xl);
      color: var(--sf-ink);
    }
    .admin__tabs {
      display: flex;
      gap: var(--sf-1);
      border-bottom: 1px solid var(--sf-line);
      margin-bottom: var(--sf-4);
    }
    .admin__tab {
      padding: var(--sf-2) var(--sf-3);
      margin-bottom: -1px;
      border-bottom: 2px solid transparent;
      color: var(--sf-slate);
      font-size: var(--sf-text-sm);
      text-decoration: none;
    }
    .admin__tab:hover {
      color: var(--sf-ink);
    }
    .admin__tab--active {
      color: var(--sf-ink);
      border-bottom-color: var(--sf-signal);
      font-weight: 600;
    }
  `,
})
export class AdminShellComponent {}
