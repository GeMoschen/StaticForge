import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Signal,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SfAssetPickerDialogComponent, type AssetPicked } from './sf-asset-picker-dialog.component';
import { SfButtonComponent } from './sf-button.component';
import { SfFieldComponent } from './sf-field.component';
import { SfSpinnerComponent } from './sf-spinner.component';
import { concreteTemplates } from '../../features/templates/inheritance.util';
import { deriveUid, UID_PATTERN } from '../uid.util';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

type TemplateSummary = components['schemas']['TemplateSummary'];

export type CreateAssetKind =
  | 'FOLDER'
  | 'PAGE'
  | 'PAGE_TEMPLATE'
  | 'SECTION_TEMPLATE'
  | 'PAGE_REFERENCE'
  | 'GLOBAL_SET'
  | 'DATASET'
  | 'RECORD_SET'
  | 'RECORD';
export type CreateAssetScope = 'PAGES' | 'MEDIA' | 'NAVIGATION' | 'GLOBALS' | 'CONTENT';

/** A dataset a new record set is of (the dialog's dataset chooser, M25.5.1). */
export interface CreateAssetDatasetOption {
  uuid?: string;
  displayName?: string;
  uid?: string;
}

/** Kind-appropriate payload emitted by `create` — the dialog never calls a create API itself, the caller does. */
export interface CreateAssetFormValue {
  displayName: string;
  templateUuid?: string;
  label?: string;
  targetKind?: string;
  targetAssetUuid?: string;
  /** For `RECORD_SET`: the dataset of the set's records (fixed for the set's life). */
  datasetUuid?: string;
  /** For `RECORD_SET`: a uid the user chose; absent when the server should derive it from the name. */
  uid?: string;
}

function nonBlank(control: AbstractControl): ValidationErrors | null {
  const value = (control.value ?? '').toString();
  return value.trim().length > 0 ? null : { required: true };
}

/** A blank uid is fine (the server derives one); anything else must be a valid uid. */
function uidOrBlank(control: AbstractControl): ValidationErrors | null {
  const value = (control.value ?? '').toString().trim();
  return !value || UID_PATTERN.test(value) ? null : { uid: true };
}

const TITLES: Record<CreateAssetKind, string> = {
  FOLDER: 'New folder',
  PAGE: 'New page',
  PAGE_TEMPLATE: 'New page template',
  SECTION_TEMPLATE: 'New section template',
  PAGE_REFERENCE: 'New reference',
  GLOBAL_SET: 'New property set',
  DATASET: 'New dataset',
  RECORD_SET: 'New record set',
  RECORD: 'New record',
};

/**
 * Shared "create asset" modal — one dialog for the creation flows (folder,
 * page, page/section template, navigation reference, global property set, dataset, record set, record) that used to be raw
 * `window.prompt` calls or one-off inline panels. Adapts its fields to
 * `kind`, validates with Reactive Forms, and emits the collected values via
 * `create` — it never calls a create API itself; the caller does that and
 * drives `submitting` back in. On error the caller just leaves `open` true
 * and the entered data stays put so the user can retry.
 */
@Component({
  selector: 'sf-create-asset-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfAssetPickerDialogComponent, SfButtonComponent, SfFieldComponent, SfSpinnerComponent],
  templateUrl: './sf-create-asset-dialog.component.html',
  styleUrl: './sf-create-asset-dialog.component.scss',
})
export class SfCreateAssetDialogComponent {
  readonly kind = input.required<CreateAssetKind>();
  readonly scope = input<CreateAssetScope | null>(null);
  readonly open = input.required<boolean>();
  readonly submitting = input(false);
  readonly projectKey = input.required<string>();
  readonly templates = input<TemplateSummary[]>([]);
  /** Page templates a page may use: abstract templates are layouts for other templates (M20). */
  protected readonly templateOptions = computed(() => concreteTemplates(this.templates()));
  /** For `RECORD_SET`: the live datasets to choose from. */
  readonly datasets = input<CreateAssetDatasetOption[]>([]);
  /** For `RECORD_SET`: the dataset preselected in the chooser (otherwise the first one). */
  readonly initialDatasetUuid = input<string | null>(null);

  readonly create = output<CreateAssetFormValue>();
  readonly closed = output<void>();

  private readonly fb = inject(FormBuilder);

  private readonly panelRef = viewChild<ElementRef<HTMLDivElement>>('panel');
  private readonly nameInputRef = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  protected readonly showPicker = signal(false);
  protected readonly targetLabel = signal('');

  protected readonly title: Signal<string> = computed(() => TITLES[this.kind()]);
  protected readonly showTemplateField = computed(() => this.kind() === 'PAGE');
  protected readonly showTargetField = computed(() => this.kind() === 'PAGE_REFERENCE');
  protected readonly showLabelField = computed(() => this.kind() === 'PAGE_REFERENCE');
  /** A record's dataset is its set's (M25): only a new record set picks one — always visibly, as it's permanent. */
  protected readonly showDatasetField = computed(() => this.kind() === 'RECORD_SET');
  protected readonly showUidField = computed(() => this.kind() === 'RECORD_SET');
  /** Set once the user types a uid of their own; until then the uid follows the name. */
  private readonly uidEdited = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    displayName: ['', [nonBlank]],
    templateUuid: [''],
    label: [''],
    targetAssetUuid: [''],
    datasetUuid: [''],
    uid: ['', [uidOrBlank]],
  });

  constructor() {
    // Adapt validators to the active kind — templateUuid only required for
    // PAGE, targetAssetUuid only required for PAGE_REFERENCE.
    effect(() => {
      const kind = this.kind();
      const templateCtrl = this.form.controls.templateUuid;
      const targetCtrl = this.form.controls.targetAssetUuid;
      templateCtrl.setValidators(kind === 'PAGE' ? [Validators.required] : []);
      templateCtrl.updateValueAndValidity({ emitEvent: false });
      targetCtrl.setValidators(kind === 'PAGE_REFERENCE' ? [Validators.required] : []);
      targetCtrl.updateValueAndValidity({ emitEvent: false });
      const datasetCtrl = this.form.controls.datasetUuid;
      datasetCtrl.setValidators(kind === 'RECORD_SET' ? [Validators.required] : []);
      datasetCtrl.updateValueAndValidity({ emitEvent: false });
    });

    // The uid suggestion follows the name until the user writes their own.
    this.form.controls.displayName.valueChanges.pipe(takeUntilDestroyed()).subscribe((name) => {
      if (this.kind() === 'RECORD_SET' && !this.uidEdited()) {
        this.form.controls.uid.setValue(deriveUid(name ?? ''), { emitEvent: false });
      }
    });

    // A set's dataset defaults to the preselected one, or the first there is — written into the
    // control, so what the select shows is what gets submitted.
    effect(
      () => {
        const open = this.open();
        const datasets = this.datasets();
        const initial = this.initialDatasetUuid();
        if (!open || this.kind() !== 'RECORD_SET') {
          return;
        }
        untracked(() => {
          const preferred = datasets.find((d) => d.uuid === initial)?.uuid ?? datasets[0]?.uuid ?? '';
          if (!this.form.controls.datasetUuid.value) {
            this.form.controls.datasetUuid.setValue(preferred);
          }
        });
      },
      { allowSignalWrites: true },
    );

    // Reset only when the dialog transitions to closed (explicit
    // cancel/Escape, or the caller toggling `open` back to false on
    // success) — never merely because `submitting` flipped back to false,
    // so a failed create leaves the user's entry intact to retry.
    effect(
      () => {
        const isOpen = this.open();
        if (isOpen) {
          untracked(() => this.focusNameField());
        } else {
          untracked(() => this.resetForm());
        }
      },
      { allowSignalWrites: true },
    );
  }

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (!this.open()) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.showPicker()) {
        this.closePicker();
      } else {
        this.cancel();
      }
      return;
    }
    if (event.key === 'Tab') {
      this.trapFocus(event);
    }
  }

  protected onTargetPicked(picked: AssetPicked): void {
    this.form.patchValue({ targetAssetUuid: picked.uuid });
    this.form.controls.targetAssetUuid.markAsTouched();
    this.targetLabel.set(picked.label);
    const nameCtrl = this.form.controls.displayName;
    if (!nameCtrl.value?.trim()) {
      nameCtrl.setValue(picked.label);
    }
    this.showPicker.set(false);
  }

  protected openPicker(): void {
    this.showPicker.set(true);
  }

  protected closePicker(): void {
    this.showPicker.set(false);
  }

  protected onUidInput(): void {
    this.uidEdited.set(true);
  }

  protected cancel(): void {
    this.resetForm();
    this.closed.emit();
  }

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    const kind = this.kind();
    const value = this.form.getRawValue();
    const payload: CreateAssetFormValue = { displayName: value.displayName.trim() };
    if (kind === 'PAGE') {
      payload.templateUuid = value.templateUuid;
    }
    if (kind === 'PAGE_REFERENCE') {
      payload.label = value.label.trim() || undefined;
      payload.targetKind = 'PAGE';
      payload.targetAssetUuid = value.targetAssetUuid;
    }
    if (kind === 'RECORD_SET') {
      payload.datasetUuid = value.datasetUuid;
      const uid = value.uid.trim();
      if (uid && uid !== deriveUid(payload.displayName)) {
        payload.uid = uid;
      }
    }
    this.create.emit(payload);
  }

  private resetForm(): void {
    this.form.reset({ displayName: '', templateUuid: '', label: '', targetAssetUuid: '', datasetUuid: '', uid: '' });
    this.uidEdited.set(false);
    this.targetLabel.set('');
    this.showPicker.set(false);
  }

  private focusNameField(): void {
    queueMicrotask(() => this.nameInputRef()?.nativeElement.focus());
  }

  private trapFocus(event: KeyboardEvent): void {
    const panel = this.panelRef()?.nativeElement;
    if (!panel) {
      return;
    }
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]'),
    ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
    if (focusables.length === 0) {
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
