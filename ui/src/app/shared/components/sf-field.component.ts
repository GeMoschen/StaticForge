import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'sf-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-field.component.html',
  styleUrl: './sf-field.component.scss',
})
export class SfFieldComponent {
  readonly label = input<string>();
  readonly hint = input<string>();
}
