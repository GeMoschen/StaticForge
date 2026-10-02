import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AreaShellComponent } from '../frame/area-shell.component';

/**
 * The Settings area (`/p/:key/settings`, M35.11): a grouped side menu — PROJECT (General, Languages, Channels, Media,
 * Code highlighting), MAINTENANCE (Compaction, Import / export), PEOPLE (Members) — and the open sub-page beside it.
 */
@Component({
  selector: 'sf-settings-shell',
  standalone: true,
  imports: [AreaShellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<sf-area-shell area="settings" />`,
  styles: ':host { display: block; height: 100%; }',
})
export class SettingsShellComponent {}
