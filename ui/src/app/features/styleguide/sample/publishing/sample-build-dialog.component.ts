import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfComboboxComponent, SfComboboxOption } from '../../../../shared/components/forms/sf-combobox.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { DEFAULT_TARGET, PAGES, RunMode, TARGETS, planFor } from './publishing-data';
import { PublishingState } from './publishing-state';

/**
 * Build now (M35.24 preview): the target (the default preselected), Full / Incremental, a page scope picker (pages
 * and folders, several) and the dry-run plan of what Start would do — counts and the first entries. Nothing starts.
 */
@Component({
  selector: 'sf-sample-build-dialog',
  standalone: true,
  imports: [
    SfButtonComponent,
    SfComboboxComponent,
    SfDialogComponent,
    SfDialogFooterDirective,
    SfFieldComponent,
    SfIconComponent,
    SfSegmentedComponent,
    SfSelectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-build-dialog.component.html',
  styleUrl: './sample-build-dialog.component.scss',
})
export class SampleBuildDialogComponent {
  readonly closed = output<void>();

  protected readonly state = inject(PublishingState);
  protected readonly t = this.state.t;

  protected readonly target = signal<string | null>(DEFAULT_TARGET.id);
  protected readonly mode = signal<RunMode | null>('incremental');
  protected readonly scope = signal<string[]>([]);

  protected readonly targetOptions = computed<SfSelectOption<string>[]>(() =>
    TARGETS.map((t) => ({ value: t.id, label: t.isDefault ? this.t('build.defaultTarget', { name: t.name }) : t.name })),
  );
  protected readonly modeOptions = computed<SfSegmentedOption<RunMode>[]>(() => [
    { value: 'incremental', label: this.t('mode.incremental'), icon: 'bolt' },
    { value: 'full', label: this.t('mode.full'), icon: 'all_inclusive' },
  ]);
  protected readonly scopeOptions = computed<SfComboboxOption<string>[]>(() =>
    PAGES.map((p) => ({
      value: p.id,
      label: p.name,
      description: p.path,
      group: p.folder ? this.t('build.folders') : this.t('build.pages'),
    })).sort((a, b) => a.group.localeCompare(b.group)),
  );

  protected readonly plan = computed(() => planFor(this.mode() ?? 'incremental', this.scope()));

  protected setScope(value: unknown): void {
    this.scope.set(Array.isArray(value) ? (value as string[]) : []);
  }

  protected start(): void {
    this.state.notice('build.notStarted');
    this.closed.emit();
  }
}
