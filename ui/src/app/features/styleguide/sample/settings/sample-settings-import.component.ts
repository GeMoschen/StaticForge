import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SfTableIdentityComponent } from '../../../../shared/components/data-table/sf-table-identity.component';
import { SfDataTableColumn } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { SfFileDropComponent } from '../../../../shared/components/forms/sf-file-drop.component';
import { SfRadioGroupComponent, SfRadioOption } from '../../../../shared/components/forms/sf-radio-group.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import {
  CONFLICT_CHOICES,
  ConflictChoice,
  IMPORT_ARCHIVE_ITEMS,
  IMPORT_ARCHIVE_NAME,
  IMPORT_CONFLICTS,
  ImportConflict,
  ReleaseMode,
} from './settings-data';
import { SettingsState } from './settings-state';

/** The sample starts with an archive already chosen and analysed, so the conflicts show without a real file. */
function sampleArchive(): File {
  return new File([''], IMPORT_ARCHIVE_NAME, { type: 'application/zip' });
}

/**
 * Import / export › Import: the archive in an `sf-file-drop`, then the analysis — the conflicts with a per-row choice
 * (keep / replace / skip), the release-state option and the Import button. Removing the archive hides the analysis.
 */
@Component({
  selector: 'sf-sample-settings-import',
  standalone: true,
  imports: [
    SfTableIdentityComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfFieldComponent,
    SfFileDropComponent,
    SfIconComponent,
    SfRadioGroupComponent,
    SfSelectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-settings-import.component.html',
  styleUrl: './sample-settings-import.component.scss',
})
export class SampleSettingsImportComponent {
  protected readonly state = inject(SettingsState);
  protected readonly t = this.state.t;

  protected readonly files = signal<File[]>([sampleArchive()]);
  protected readonly conflicts = signal<readonly ImportConflict[]>(IMPORT_CONFLICTS);
  protected readonly releaseMode = signal<ReleaseMode>('keep');
  protected readonly rowKey = (row: ImportConflict) => row.id;
  protected readonly rowLabel = (row: ImportConflict) => row.name;

  protected readonly archive = computed(() => this.files()[0] ?? null);

  protected readonly columns = computed<SfDataTableColumn<ImportConflict>[]>(() => {
    const h = (id: string) => this.t(`import.columns.${id}`);
    return [
      { id: 'name', header: h('name'), value: (r) => r.name, sortable: true, hideable: false, width: 260 },
      { id: 'store', header: h('store'), value: (r) => this.t(`stores.${r.store}`), sortable: true, width: 140 },
      { id: 'reason', header: h('reason'), value: (r) => this.t(`import.reasons.${r.reason}`), width: 260 },
      { id: 'choice', header: h('choice'), value: (r) => r.choice, width: 180, searchable: false },
    ];
  });

  protected readonly choiceOptions = computed<SfSelectOption<ConflictChoice>[]>(() =>
    CONFLICT_CHOICES.map((c) => ({ value: c, label: this.t(`import.choices.${c}`) })),
  );

  protected readonly releaseOptions = computed<SfRadioOption<ReleaseMode>[]>(() =>
    (['keep', 'draft'] as const).map((m) => ({
      value: m,
      label: this.t(`import.release.${m}`),
      description: this.t(`import.release.${m}Hint`),
    })),
  );

  protected readonly analysis = computed(() =>
    this.t('import.analysis', { items: IMPORT_ARCHIVE_ITEMS, conflicts: this.conflicts().length }),
  );

  /** "2 replace · 2 keep · 1 skip": what the import will do with the conflicts. */
  protected readonly choiceSummary = computed(() =>
    CONFLICT_CHOICES.map((c) => [c, this.conflicts().filter((r) => r.choice === c).length] as const)
      .filter(([, n]) => n > 0)
      .map(([c, n]) => this.t(`import.choiceCount.${c}`, { n }))
      .join(' · '),
  );

  protected choose(row: ImportConflict, choice: ConflictChoice | null): void {
    if (choice) {
      this.conflicts.update((rows) => rows.map((r) => (r.id === row.id ? { ...r, choice } : r)));
    }
  }

  protected chooseAll(choice: ConflictChoice): void {
    this.conflicts.update((rows) => rows.map((r) => ({ ...r, choice })));
  }

  protected runImport(): void {
    this.state.notice();
  }
}
