import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { SfDialogRef, injectDialogData } from '../../shared/components/dialog/dialog-ref';
import { SfDialogComponent, SfDialogFooterDirective } from '../../shared/components/dialog/sf-dialog.component';
import { SfInputComponent } from '../../shared/components/forms/sf-input.component';
import { SfRadioGroupComponent, type SfRadioOption } from '../../shared/components/forms/sf-radio-group.component';
import { SfSelectComponent, type SfSelectOption } from '../../shared/components/forms/sf-select.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';

/** The kinds the dialog creates; a folder is made inline in the tree. */
export type NewTemplateKind = 'page' | 'section' | 'dataset';

export interface NewTemplateData {
  /** Where each kind is created: the folder's name (the folder it was started from for its own kind, else the fixed folder of the kind). */
  readonly folders: Readonly<Record<NewTemplateKind, string>>;
  /** The folder the dialog was started in, when there is one; shown while no kind is chosen. */
  readonly started: string | null;
  /** The kind, when the person already picked it in a *New* menu; `null` from the header button, which asks. */
  readonly kind: NewTemplateKind | null;
  /** The existing templates and datasets *Based on* can copy, by kind. */
  readonly candidates: readonly NewTemplateCandidate[];
}

export interface NewTemplateCandidate {
  readonly uuid: string;
  readonly name: string;
  readonly kind: NewTemplateKind;
}

export interface NewTemplateResult {
  readonly kind: NewTemplateKind;
  readonly name: string;
  readonly uid: string;
  /** The uuid of the template or dataset whose contents the new one copies; `null` starts empty. */
  readonly basedOn: string | null;
}

const NOTHING = '__none__';

/** A UID derived from a name: lower case, digits and underscores, starting with a letter. */
export function uidOf(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+/, '').replace(/_+$/, '');
}

const UID_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * The New template dialog (M35.21, gate decision 155). The **kind is chosen explicitly** — page template, section
 * template or dataset — and never taken from what is selected in the tree. Opened from a *New ▸ kind* menu entry the kind
 * is already what the person picked; from the header's *New* button nothing is chosen and **Create** says so. **Name**,
 * and **UID** (derived from the name until it is edited). A note says the kind can't be changed afterwards, and where it
 * is created is stated. Enter creates; Escape, × and Cancel close.
 */
@Component({
  selector: 'sf-new-template-dialog',
  standalone: true,
  imports: [SfButtonComponent, SfDialogComponent, SfDialogFooterDirective, SfFieldComponent, SfInputComponent, SfRadioGroupComponent, SfSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './new-template-dialog.component.html',
  styleUrl: './new-template-dialog.component.scss',
})
export class NewTemplateDialogComponent {
  protected readonly data = injectDialogData<NewTemplateData>();
  private readonly ref = inject<SfDialogRef<NewTemplateResult>>(SfDialogRef);
  private readonly transloco = inject(TranslocoService);

  protected readonly t = (key: string, params?: Record<string, unknown>): string => this.transloco.translate(`templates.newDialog.${key}`, params);

  protected readonly kind = signal<NewTemplateKind | null>(this.data.kind);
  protected readonly name = signal('');
  private readonly uidEdited = signal<string | null>(null);
  private readonly nameTouched = signal(false);
  protected readonly basedOn = signal<string>(NOTHING);
  /** *Based on*: the existing items of the chosen kind, or none to start empty. */
  protected readonly basedOnOptions = computed<SfSelectOption<string>[]>(() => [
    { value: NOTHING, label: this.t('basedOn.none') },
    ...this.data.candidates.filter((c) => c.kind === this.kind()).map((c) => ({ value: c.uuid, label: c.name })),
  ]);

  protected readonly kinds = computed<SfRadioOption<NewTemplateKind>[]>(() =>
    (['page', 'section', 'dataset'] as const).map((value) => ({
      value,
      label: this.t(`kinds.${value}`),
      description: this.t(`kindHint.${value}`),
    })),
  );
  /** "Created in Page templates." — the folder of the chosen kind; before a kind is chosen, the folder it was started in. */
  protected readonly where = computed(() => {
    const kind = this.kind();
    const folder = kind ? this.data.folders[kind] : this.data.started;
    return folder ? this.t('where', { folder }) : this.t('whereKind');
  });
  protected readonly uid = computed(() => this.uidEdited() ?? uidOf(this.name()));
  private readonly trimmed = computed(() => this.name().trim());
  protected readonly nameError = computed(() => (this.nameTouched() && this.trimmed() === '' ? this.t('name.required') : null));
  private readonly uidValid = computed(() => UID_PATTERN.test(this.uid()));
  protected readonly uidError = computed(() => (this.trimmed() !== '' && !this.uidValid() ? this.t('uid.invalid') : null));

  protected readonly valid = computed(() => this.kind() !== null && this.trimmed() !== '' && this.uidValid());
  /** Why Create is disabled (its tooltip); `null` while it is enabled. */
  protected readonly blockedReason = computed(() =>
    this.kind() === null ? this.t('create.chooseKind') : this.trimmed() === '' ? this.t('create.enterName') : !this.uidValid() ? this.t('uid.invalid') : null,
  );

  protected chooseKind(kind: NewTemplateKind | null): void {
    this.kind.set(kind);
    this.basedOn.set(NOTHING);
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
      this.ref.close({ kind, name: this.trimmed(), uid: this.uid(), basedOn: this.basedOn() === NOTHING ? null : this.basedOn() });
    }
  }

  protected cancel(): void {
    this.ref.close();
  }
}
