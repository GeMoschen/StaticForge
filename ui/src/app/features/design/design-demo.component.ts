import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'sf-design-demo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './design-demo.component.html',
  styleUrl: './design-demo.component.scss',
})
export class DesignDemoComponent {}
