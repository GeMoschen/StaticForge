import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'sf-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-table.component.html',
})
export class SfTableComponent {}
