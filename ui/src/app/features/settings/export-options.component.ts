import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ExportSelectionStore } from './export-selection.store';

/** The export panel's "Additional data" toggles (output channels, generation targets, schedules). */
@Component({
  selector: 'sf-export-options',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './export-options.component.html',
  styleUrl: './export-options.component.scss',
})
export class ExportOptionsComponent {
  protected readonly sel = inject(ExportSelectionStore);
}
