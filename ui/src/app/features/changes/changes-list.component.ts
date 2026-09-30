import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChildren } from '@angular/core';
import { ProjectMembersStore } from '../../core/project/project-members.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfRelativeTimePipe } from '../../shared/pipes/sf-relative-time.pipe';
import { ReleaseBadgeComponent } from '../release/release-badge.component';
import { assetName } from '../release/release-choice.util';
import { localeTag, statusLabel } from '../release/release-status.util';
import { typeInfo } from './changes-query.util';
import { type ChangeRowView, ChangesStore } from './changes.store';

/**
 * The table of unreleased (asset, locale) rows with its pager.
 *
 * <p>Keyboard (§24.6): ↑/↓ move between rows, Space toggles the row's selection, Enter opens its diff.
 */
@Component({
  selector: 'sf-changes-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfButtonComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    SfSpinnerComponent,
    SfRelativeTimePipe,
    ReleaseBadgeComponent,
  ],
  templateUrl: './changes-list.component.html',
  styleUrl: './changes-list.component.scss',
})
export class ChangesListComponent {
  protected readonly store = inject(ChangesStore);
  protected readonly members = inject(ProjectMembersStore);
  protected readonly permissions = inject(ProjectPermissionsStore);

  private readonly rowElements = viewChildren<ElementRef<HTMLElement>>('row');

  protected typeInfo = typeInfo;
  protected localeTag = localeTag;
  protected statusLabel = statusLabel;
  protected name = assetName;

  /** The badge input for one row: its own status in its own locale. */
  protected releaseOf(row: ChangeRowView): Record<string, { status: string }> {
    return { [row.locale ?? '']: { status: row.status ?? '' } };
  }

  protected folderText(row: ChangeRowView): string {
    // Stored paths start with the store root (`/pages_root/about/`): show the part below it.
    const segments = (row.folderPath ?? '').split('/').filter((s) => s.length > 0);
    return segments.length > 1 ? `/${segments.slice(1).join('/')}/` : '/';
  }

  protected onRowKeydown(event: KeyboardEvent, row: ChangeRowView, index: number): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.focusRow(Math.min(index + 1, this.store.rows().length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.focusRow(Math.max(index - 1, 0));
        break;
      case ' ':
        event.preventDefault();
        this.store.toggleRow(row);
        break;
      case 'Enter':
        event.preventDefault();
        this.store.openDiff(row, index);
        break;
    }
  }

  private focusRow(index: number): void {
    this.store.activeIndex.set(index);
    queueMicrotask(() => this.rowElements()[index]?.nativeElement.focus());
  }
}
