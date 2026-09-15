import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/**
 * Wraps Project Settings' sub-pages (General, Media, Channels, Generation,
 * Targets, Revisions, ...) with a shared tab bar. Each tab is a nested route so it keeps
 * its own lazy chunk, matching the `pages` → `:uuid` nesting pattern
 * already used elsewhere in `app.routes.ts`.
 */
@Component({
  selector: 'sf-project-settings',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-settings-shell.component.html',
  styleUrl: './project-settings-shell.component.scss',
})
export class ProjectSettingsShellComponent {
  readonly projectKey = input.required<string>();
}
