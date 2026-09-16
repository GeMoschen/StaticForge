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

type TemplateSummary = components['schemas']['TemplateSummary'];

export type CreateAssetKind =
  | 'FOLDER'
  | 'PAGE'
  | 'PAGE_TEMPLATE'
  | 'SECTION_TEMPLATE'
  | 'PAGE_REFERENCE'
  | 'GLOBAL_SET';
export type CreateAssetScope = 'PAGES' | 'MEDIA' | 'NAVIGATION' | 'GLOBALS';

/** Kind-appropriate payload emitted by `create` — the dialog never calls a create API itself, the caller does. */
export interface CreateAssetFormValue {
  displayName: string;
  templateUuid?: string;
  label?: string;
  targetKind?: string;
  targetAssetUuid?: string;
}

function nonBlank(control: AbstractControl): ValidationErrors | null {
  const value = (control.value ?? '').toString();
  return value.trim().length > 0 ? null : { required: true };
}

const TITLES: Record<CreateAssetKind, string> = {
  FOLDER: 'New folder',
  PAGE: 'New page',
  PAGE_TEMPLATE: 'New page template',
  SECTION_TEMPLATE: 'New section template',
  PAGE_REFERENCE: 'New reference',
  GLOBAL_SET: 'New property set',
};

/**
 * Shared "create asset" modal — one dialog for the 6 creation flows (folder,
 * page, page/section template, navigation reference, global property set) that used to be raw
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

  protected readonly form = this.fb.nonNullable.group({
    displayName: ['', [nonBlank]],
    templateUuid: [''],
    label: [''],
    targetAssetUuid: [''],
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
    });

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
    this.create.emit(payload);
  }

  private resetForm(): void {
    this.form.reset({ displayName: '', templateUuid: '', label: '', targetAssetUuid: '' });
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
