import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SfIconComponent } from './sf-icon.component';

@Component({
  selector: 'sf-empty-state',
  standalone: true,
  imports: [SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-empty-state.component.html',
  styleUrl: './sf-empty-state.component.scss',
})
export class SfEmptyStateComponent {
  readonly title = input('Nothing here yet');
  readonly description = input<string>();
  readonly icon = input<string>();
}
