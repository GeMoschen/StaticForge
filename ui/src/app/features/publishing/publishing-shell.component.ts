import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AreaShellComponent } from '../frame/area-shell.component';
import { PublishingBuildActionComponent } from './publishing-build-action.component';
import { PublishingStatusComponent } from './publishing-status.component';

/**
 * The Publishing area (`/p/:key/publishing`, M35.11): Runs, Targets, Publish policy, then the Checks. Its page header
 * shows the build status and *Build now* (M35.24).
 */
@Component({
  selector: 'sf-publishing-shell',
  standalone: true,
  imports: [AreaShellComponent, PublishingBuildActionComponent, PublishingStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sf-area-shell area="publishing">
      <sf-publishing-status sfAreaStatus />
      <sf-publishing-build-action sfAreaActions />
    </sf-area-shell>
  `,
  styles: ':host { display: block; height: 100%; }',
})
export class PublishingShellComponent {}
