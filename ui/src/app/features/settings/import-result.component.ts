import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { conflictIcon } from './import-conflicts.util';
import { ImportResultView } from './import-export.service';
import { ImportSessionStore } from './import-session.store';

/** What the last committed import did: the summary line plus the schedule/URL/redirect warnings. */
@Component({
  selector: 'sf-import-result',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfIconComponent],
  templateUrl: './import-result.component.html',
  styleUrl: './import-result.component.scss',
})
export class ImportResultComponent {
  protected readonly sess = inject(ImportSessionStore);
  protected readonly iconFor = conflictIcon;

  /** "Imported 2 schedule(s), replaced 1." — empty when the import brought none. */
  protected schedulesSummary(result: ImportResultView): string {
    const created = result.importedScheduleCount ?? 0;
    const replaced = result.updatedScheduleCount ?? 0;
    if (created + replaced === 0) {
      return '';
    }
    return `Imported ${created} schedule(s)` + (replaced > 0 ? `, replaced ${replaced}` : '') + '.';
  }

  /** "Imported 3 redirect(s)." — empty when the import brought none (M30.4.1). */
  protected redirectsSummary(result: ImportResultView): string {
    const imported = result.importedRedirectCount ?? 0;
    return imported > 0 ? `Imported ${imported} redirect(s).` : '';
  }

  /** "Imported 12 URL(s)." — empty when the import brought none (M32.6). */
  protected urlsSummary(result: ImportResultView): string {
    const imported = result.importedUrlCount ?? 0;
    return imported > 0 ? `Imported ${imported} URL(s).` : '';
  }
}
