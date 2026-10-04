import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SfDialogRef, injectDialogData } from '../../../shared/components/dialog/dialog-ref';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../shared/components/dialog/sf-dialog.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfRadioGroupComponent, SfRadioOption } from '../../../shared/components/forms/sf-radio-group.component';
import { SfSelectComponent, SfSelectOption } from '../../../shared/components/forms/sf-select.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { injectSampleText } from './changes/sample-area.util';
import { SampleTemplateEntry, SampleTemplateKind, templatesInside } from './sample-content-data';

/** The kinds the dialog creates; a folder is made inline in the tree or from the folder's header. */
export type SampleNewTemplateKind = Exclude<SampleTemplateKind, 'folder'>;

export interface SampleNewTemplateData {
  /** Where it will be created: the folder's name. */
  readonly folder: string;
  /** The kind, when the person already picked it in a *New* menu; `null` from the header button, which asks. */
  readonly kind: SampleNewTemplateKind | null;
}

export interface SampleNewTemplateResult {
  readonly kind: SampleNewTemplateKind;
  readonly name: string;
  readonly uid: string;
  /** The template it extends (page and section templates), if any. */
  readonly parent: string | null;
}

const NO_PARENT = '__none__';

/** A UID derived from a name: lower case, digits and underscores, starting with a letter. */
export function uidOf(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+/, '').replace(/_+$/, '');
}

/**
 * The New template dialog (M35.21, gate round 13 — **awaiting sign-off**). The **kind is chosen explicitly**: page
 * template, section template or dataset — never taken from what is selected in the tree. Opened from a *New ▸ kind* menu
 * entry the kind is already what the person picked; from the header's *New* button nothing is chosen and **Create** says
 * so. **Name** and **UID** (derived from the name until it is edited), and for page and section templates an optional
 * **Based on** template. A note says the kind can't be changed afterwards. Enter creates; Escape, × and Cancel close.
 */
@Component({
  selector: 'sf-sample-new-template-dialog',
  standalone: true,
  imports: [SfButtonComponent, SfDialogComponent, SfDialogFooterDirective, SfFieldComponent, SfInputComponent, SfRadioGroupComponent, SfSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-new-template-dialog.component.html',
  styleUrl: './sample-new-template-dialog.component.scss',
})
export class SampleNewTemplateDialogComponent {
  protected readonly data = injectDialogData<SampleNewTemplateData>();
  private readonly ref = inject<SfDialogRef<SampleNewTemplateResult>>(SfDialogRef);
  protected readonly t = injectSampleText('styleguide.sample.templateNew');

  protected readonly kind = signal<SampleNewTemplateKind | null>(this.data.kind);
  protected readonly name = signal('');
  private readonly uidEdited = signal<string | null>(null);
  private readonly nameTouched = signal(false);
  protected readonly parent = signal<string>(NO_PARENT);

  protected readonly kinds = computed<SfRadioOption<SampleNewTemplateKind>[]>(() =>
    (['page', 'section', 'dataset'] as const).map((value) => ({
      value,
      label: this.t(`kind.${value}`),
      description: this.t(`kindHint.${value}`),
    })),
  );
  protected readonly uid = computed(() => this.uidEdited() ?? uidOf(this.name()));
  private readonly trimmed = computed(() => this.name().trim());
  protected readonly nameError = computed(() => (this.nameTouched() && this.trimmed() === '' ? this.t('name.required') : null));
  protected readonly uidError = computed(() => (this.uid() === '' && this.trimmed() !== '' ? this.t('uid.invalid') : null));

  /** Page templates extend page templates, section templates extend section templates; a dataset extends nothing. */
  protected readonly parentOptions = computed<SfSelectOption<string>[]>(() => {
    const kind = this.kind();
    const candidates = templatesInside(null).filter((entry: SampleTemplateEntry) => entry.kind === kind);
    return [{ value: NO_PARENT, label: this.t('parent.none') }, ...candidates.map((entry) => ({ value: entry.id, label: entry.name }))];
  });

  protected readonly valid = computed(() => this.kind() !== null && this.trimmed() !== '' && this.uid() !== '');
  /** Why Create is disabled (its tooltip); `null` while it is enabled. */
  protected readonly blockedReason = computed(() =>
    this.kind() === null ? this.t('create.chooseKind') : this.trimmed() === '' ? this.t('create.enterName') : this.uid() === '' ? this.t('uid.invalid') : null,
  );

  protected chooseKind(kind: SampleNewTemplateKind | null): void {
    this.kind.set(kind);
    this.parent.set(NO_PARENT);
  }

  protected setName(value: string): void {
    this.nameTouched.set(true);
    this.name.set(value);
  }

  protected setUid(value: string): void {
    this.uidEdited.set(value);
  }

  protected create(): void {
    const kind = this.kind();
    if (this.valid() && kind !== null) {
      this.ref.close({ kind, name: this.trimmed(), uid: this.uid(), parent: kind === 'dataset' || this.parent() === NO_PARENT ? null : this.parent() });
    }
  }

  protected cancel(): void {
    this.ref.close();
  }
}
