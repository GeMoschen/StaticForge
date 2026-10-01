import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SampleCrumb } from './sample-state';

/**
 * The sample's breadcrumb: an ordered list of folder buttons ending in the current item (`aria-current`). Used in the
 * top bar (on the dark chrome) and in the page headers.
 */
@Component({
  selector: 'sf-sample-breadcrumb',
  standalone: true,
  imports: [SfButtonComponent, SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-breadcrumb.component.scss',
  template: `
    <nav class="crumbs" [attr.aria-label]="label()">
      <ol class="crumbs__list">
        @for (crumb of crumbs(); track $index; let last = $last) {
          <li class="crumbs__item">
            @if (last) {
              <span class="crumbs__current" aria-current="page">{{ crumb.label }}</span>
            } @else {
              <sf-button variant="ghost" size="sm" (click)="navigate.emit(crumb.target ?? null)">{{ crumb.label }}</sf-button>
              <sf-icon class="crumbs__sep" name="chevron_right" />
            }
          </li>
        }
      </ol>
    </nav>
  `,
})
export class SampleBreadcrumbComponent {
  readonly crumbs = input.required<readonly SampleCrumb[]>();
  readonly label = input.required<string>();
  /** A folder segment was chosen (`null` = the Pages root). */
  readonly navigate = output<string | null>();
}
