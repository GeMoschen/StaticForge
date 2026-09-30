import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { TreeScope } from './export-selection.types';
import { ExportSelectionStore } from './export-selection.store';
import { ExportTreeData } from './export-tree-data.service';

/**
 * One selectable folder tree of the export panel (Pages, Media, Navigation, Templates, Globals or Content): the
 * "Select all" header, the loading/empty states and the tri-state tree rows. All state lives in
 * {@link ExportSelectionStore} / {@link ExportTreeData}.
 */
@Component({
  selector: 'sf-export-tree-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, SfEmptyStateComponent, SfIconComponent, SfSpinnerComponent],
  templateUrl: './export-tree-section.component.html',
  styleUrl: './export-tree-section.component.scss',
})
export class ExportTreeSectionComponent {
  readonly scope = input.required<TreeScope>();
  readonly heading = input.required<string>();
  readonly selectAllLabel = input.required<string>();
  readonly emptyTitle = input.required<string>();
  readonly emptyDescription = input.required<string>();
  /** Optional hint line between the header and the tree. */
  readonly hint = input<string>('');

  protected readonly sel = inject(ExportSelectionStore);
  protected readonly data = inject(ExportTreeData);
}
