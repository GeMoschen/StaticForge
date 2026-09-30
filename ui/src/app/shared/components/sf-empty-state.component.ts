import { TranslocoPipe } from '@jsverse/transloco';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SfIconComponent } from './sf-icon.component';

@Component({
  selector: 'sf-empty-state',
  standalone: true,
  imports: [SfIconComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-empty-state.component.html',
  styleUrl: './sf-empty-state.component.scss',
})
export class SfEmptyStateComponent {
  /** The heading; the shared "Nothing here yet" when omitted. */
  readonly title = input<string | null>(null);
  readonly description = input<string>();
  readonly icon = input<string>();
}
