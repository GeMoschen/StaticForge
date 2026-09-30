import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { ImportSessionStore } from './import-session.store';

/**
 * The import panel's archive options: skip existing ancestor folders, release state (M27.5.2), schedules (M27.8.2) and
 * existing URLs (M32.6). Changing one re-analyzes the archive (the host component's effect).
 */
@Component({
  selector: 'sf-import-options',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfIconComponent],
  templateUrl: './import-options.component.html',
  styleUrl: './import-options.component.scss',
})
export class ImportOptionsComponent {
  protected readonly sess = inject(ImportSessionStore);
}
