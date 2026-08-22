import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'sf-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-table.component.html',
  styleUrl: './sf-table.component.scss',
})
export class SfTableComponent {}
