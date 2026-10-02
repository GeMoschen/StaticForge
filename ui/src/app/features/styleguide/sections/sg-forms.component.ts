import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SampleFieldTagsPipe } from '../sample/forms/sample-field-tags.pipe';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SfFinding } from '../../../shared/components/forms/sf-finding.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfNumberInputComponent } from '../../../shared/components/forms/sf-number-input.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent } from '../../../shared/components/forms/sf-select.component';
import { SfDateInputComponent } from '../../../shared/components/forms/sf-date-input.component';
import { SfTextareaComponent } from '../../../shared/components/forms/sf-textarea.component';
import { EDITOR_STATES, EDITOR_TYPES, SampleEditorDemoComponent } from '../sample/forms/sample-editor-demo.component';
import { PickerItem, PickerType } from '../sample/forms/picker-data';
import { PickerReview, SampleAssetPickerComponent } from '../sample/forms/sample-asset-picker.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SampleState } from '../sample/sample-state';
import { sectionOf } from '../styleguide.sections';

type ChipChoice = 'none' | 'language' | 'all';

/**
 * The Content form section of the style guide (M35.17): every editor of the content form in each of its states —
 * default, required (empty, so the required error shows once), read-only and computed — under one switch that shows
 * the language chip next to the label (not localized / a language / all languages); the four levels of inline findings
 * on one field; and the two-column layout, which is opt-in per field (`width: half` in the template).
 */
@Component({
  selector: 'sf-sg-forms',
  standalone: true,
  imports: [
    SfFieldComponent,
    SampleFieldTagsPipe,
    SampleEditorDemoComponent,
    SampleAssetPickerComponent,
    SfButtonComponent,
    SfDateInputComponent,
    SfInputComponent,
    SfNumberInputComponent,
    SfSegmentedComponent,
    SfSelectComponent,
    SfTextareaComponent,
    TranslocoPipe,
  ],
  // The catalog editor of the sample reads the sample's state (language file, toasts).
  providers: [SampleState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sg-forms.component.html',
  styleUrl: './sg-forms.component.scss',
})
export class SgFormsComponent {
  protected readonly s = sectionOf('contentForm');
  protected readonly types = EDITOR_TYPES;
  /** The asset picker's variants: what the field allows, and the data state shown for review. */
  protected readonly pickers: readonly {
    key: string;
    types: readonly PickerType[] | null;
    dataset: string | null;
    initial: PickerType | null;
    review: PickerReview;
  }[] = [
    { key: 'any', types: null, dataset: null, initial: null, review: 'live' },
    { key: 'pages', types: ['PAGE'], dataset: null, initial: null, review: 'live' },
    { key: 'media', types: ['MEDIA'], dataset: null, initial: null, review: 'live' },
    { key: 'records', types: ['RECORD'], dataset: 'products', initial: null, review: 'live' },
    { key: 'source', types: ['NAV_FOLDER', 'DATASET'], dataset: null, initial: null, review: 'live' },
    { key: 'loading', types: ['PAGE'], dataset: null, initial: null, review: 'loading' },
    { key: 'error', types: ['PAGE'], dataset: null, initial: null, review: 'error' },
  ];
  protected readonly openPicker = signal<string | null>(null);
  protected readonly picked = signal<PickerItem | null>(null);

  protected choose(item: PickerItem): void {
    this.picked.set(item);
    this.openPicker.set(null);
  }
  protected readonly states = EDITOR_STATES;

  protected readonly chip = signal<ChipChoice>('language');
  private readonly transloco = inject(TranslocoService);
  private readonly translation = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  /** A text of this section; reading it inside a `computed` tracks the language file. */
  private t(key: string): string {
    this.translation();
    return this.transloco.translate(`styleguide.forms.${key}`);
  }

  protected readonly chipOptions = computed<SfSegmentedOption<ChipChoice>[]>(() => [
    { value: 'none', label: this.t('chip.none') },
    { value: 'language', label: this.t('chip.language') },
    { value: 'all', label: this.t('chip.all') },
  ]);
  /** What the chip shows on a localized field: the editing language, "All languages" for a shared field, or nothing. */
  protected readonly language = computed(() => {
    const choice = this.chip();
    return choice === 'none' ? null : choice === 'all' ? 'all' : this.t('chip.english');
  });

  protected readonly levels = computed<readonly SfFinding[]>(() => [
    { level: 'hint', message: this.t('findings.hint') },
    { level: 'info', message: this.t('findings.info') },
    { level: 'warning', message: this.t('findings.warning') },
    { level: 'error', message: this.t('findings.error') },
  ]);
  protected readonly serverRule = computed<readonly SfFinding[]>(() => [{ level: 'error', message: this.t('findings.serverRule') }]);
  /** A field that every language shares shows "All languages" whenever the template is localized. */
  protected readonly shared = computed(() => (this.chip() === 'none' ? null : 'all'));

  protected readonly price = signal<number | null>(14.9);
}
