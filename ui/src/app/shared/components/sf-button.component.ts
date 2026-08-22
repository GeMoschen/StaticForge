import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type SfButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

@Component({
  selector: 'sf-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-button.component.html',
  styleUrl: './sf-button.component.scss',
})
export class SfButtonComponent {
  readonly variant = input<SfButtonVariant>('primary');
  readonly disabled = input(false);
  readonly type = input<'button' | 'submit' | 'reset'>('button');
}
