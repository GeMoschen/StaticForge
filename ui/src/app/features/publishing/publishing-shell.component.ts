import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AreaShellComponent } from '../frame/area-shell.component';

/** The Publishing area (`/p/:key/publishing`, M35.11): Runs, Targets, Publish policy, then the Checks. */
@Component({
  selector: 'sf-publishing-shell',
  standalone: true,
  imports: [AreaShellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<sf-area-shell area="publishing" />`,
  styles: ':host { display: block; height: 100%; }',
})
export class PublishingShellComponent {}
