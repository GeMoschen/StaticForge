import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { conflictIcon } from './import-conflicts.util';
import { ImportConflictView } from './import-export.service';
import { ImportSessionStore } from './import-session.store';

/**
 * The analysis of the loaded archive: blocking issues, assets left out, warnings, and the Cancel/Import actions
 * (emitted to the host, which owns the project key).
 */
@Component({
  selector: 'sf-import-conflict-report',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfEmptyStateComponent, SfIconComponent],
  templateUrl: './import-conflict-report.component.html',
  styleUrl: './import-conflict-report.component.scss',
})
export class ImportConflictReportComponent {
  readonly cancelled = output<void>();
  readonly confirmed = output<void>();

  protected readonly sess = inject(ImportSessionStore);
  protected readonly iconFor = conflictIcon;

  /**
   * Whether a conflict is about an archived asset, whose explicit/implicit pick the badge shows (a schedule's or a
   * redirect's isn't).
   */
  protected hasProvenance(conflict: ImportConflictView): boolean {
    const type = conflict.type ?? '';
    return !type.includes('SCHEDULE') && !type.startsWith('REDIRECT_') && !type.startsWith('URL_');
  }

  /** The badge of an asset left out of the import: a record outside a record set says what it is. */
  protected notImportedLabel(type: string | undefined): string {
    return type === 'RECORD_OUTSIDE_RECORD_SET' ? 'Record will not be imported' : 'Will not be imported';
  }
}
