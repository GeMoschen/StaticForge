import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HashMap, TranslocoService } from '@jsverse/transloco';
import { SfDialogRef, injectDialogData } from '../../../shared/components/dialog/dialog-ref';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../shared/components/dialog/sf-dialog.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfSelectComponent, SfSelectOption } from '../../../shared/components/forms/sf-select.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { DATASETS } from './sample-content-data';

export interface SampleNewRecordSetData {
  /** Where the set will be created: the folder's name (the store's name at the top level). */
  readonly folder: string;
}

/** What the dialog closes with. */
export interface SampleNewRecordSetResult {
  readonly name: string;
  /** The id of the dataset the set is of. */
  readonly dataset: string;
}

/**
 * The New record set dialog (M35.20, gate round 10 — **awaiting sign-off**): a name and a dataset. **No dataset is
 * preselected** — the select shows the placeholder *Choose a dataset* — and **Create** stays disabled until a name and a
 * dataset are given, saying why. A note under the select explains that the dataset **can't be changed after the set is
 * created**: every record of the set has that dataset's fields. Enter creates; Escape, × and Cancel close without a result.
 */
@Component({
  selector: 'sf-sample-new-record-set-dialog',
  standalone: true,
  imports: [SfButtonComponent, SfDialogComponent, SfDialogFooterDirective, SfFieldComponent, SfInputComponent, SfSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-new-record-set-dialog.component.html',
})
export class SampleNewRecordSetDialogComponent {
  protected readonly data = injectDialogData<SampleNewRecordSetData>();
  private readonly ref = inject<SfDialogRef<SampleNewRecordSetResult>>(SfDialogRef);
  private readonly transloco = inject(TranslocoService);
  /** Re-evaluates the translated labels once the language file is in. */
  private readonly translation = toSignal(this.transloco.selectTranslation(), { initialValue: null });

  protected readonly name = signal('');
  protected readonly dataset = signal<string | null>(null);
  /** The name is only called missing once the person has typed in the field. */
  private readonly nameTouched = signal(false);

  protected readonly options = computed<SfSelectOption<string>[]>(() =>
    DATASETS.map((dataset) => ({ value: dataset.id, label: dataset.name })),
  );
  private readonly trimmed = computed(() => this.name().trim());
  protected readonly nameError = computed(() => (this.nameTouched() && this.trimmed() === '' ? this.t('name.required') : null));
  protected readonly valid = computed(() => this.trimmed() !== '' && this.dataset() !== null);
  /** Why Create is disabled (its tooltip); `null` while it is enabled. */
  protected readonly blockedReason = computed(() => {
    if (this.dataset() === null) {
      return this.t('create.chooseDataset');
    }
    return this.trimmed() === '' ? this.t('create.enterName') : null;
  });

  protected t(key: string, params?: HashMap): string {
    this.translation();
    return this.transloco.translate(`styleguide.sample.content.newSet.${key}`, params);
  }

  protected setName(value: string): void {
    this.nameTouched.set(true);
    this.name.set(value);
  }

  protected create(): void {
    const dataset = this.dataset();
    if (this.valid() && dataset !== null) {
      this.ref.close({ name: this.trimmed(), dataset });
    }
  }

  protected cancel(): void {
    this.ref.close();
  }
}
