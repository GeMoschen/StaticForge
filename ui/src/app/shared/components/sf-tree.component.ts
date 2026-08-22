import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'sf-tree',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-tree.component.html',
})
export class SfTreeComponent {}
