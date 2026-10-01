import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfCheckboxComponent } from '../../../shared/components/forms/sf-checkbox.component';
import { SfColorInputComponent } from '../../../shared/components/forms/sf-color-input.component';
import { SfComboboxComponent } from '../../../shared/components/forms/sf-combobox.component';
import { SfDateInputComponent } from '../../../shared/components/forms/sf-date-input.component';
import { SfFileDropComponent } from '../../../shared/components/forms/sf-file-drop.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfNumberInputComponent } from '../../../shared/components/forms/sf-number-input.component';
import { SfRadioGroupComponent } from '../../../shared/components/forms/sf-radio-group.component';
import { SfSearchInputComponent } from '../../../shared/components/forms/sf-search-input.component';
import { SfSegmentedComponent } from '../../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent } from '../../../shared/components/forms/sf-select.component';
import { SfSliderComponent } from '../../../shared/components/forms/sf-slider.component';
import { SfSwitchComponent } from '../../../shared/components/forms/sf-switch.component';
import { SfTextareaComponent } from '../../../shared/components/forms/sf-textarea.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { BUTTONS, BUTTON_SIZES, BUTTON_VARIANTS, FORMS } from '../styleguide.demo';
import { sectionOf } from '../styleguide.sections';

/** One column of the state grid: a caption key and how the control is set. */
export interface ControlState {
  readonly id: 'normal' | 'readonly' | 'disabled' | 'invalid';
  readonly key: string;
  readonly normal: boolean;
  readonly readonly: boolean;
  readonly disabled: boolean;
  readonly invalid: boolean;
}

const state = (id: ControlState['id']): ControlState => ({
  id,
  key: `styleguide.page.states.${id}`,
  normal: id === 'normal',
  readonly: id === 'readonly',
  disabled: id === 'disabled',
  invalid: id === 'invalid',
});

export const CONTROL_STATES: readonly ControlState[] = [state('normal'), state('readonly'), state('disabled'), state('invalid')];

/**
 * The buttons and form-control sections of the style guide (M35.9): every button variant, size and state, and every
 * form control inside `sf-field` in its normal, read-only, disabled and invalid state. The values are shared by the
 * four states of a control, so typing in the normal one shows how the others render the same value.
 */
@Component({
  selector: 'sf-sg-controls',
  standalone: true,
  imports: [
    SfButtonComponent,
    SfCheckboxComponent,
    SfColorInputComponent,
    SfComboboxComponent,
    SfDateInputComponent,
    SfFieldComponent,
    SfFileDropComponent,
    SfInputComponent,
    SfNumberInputComponent,
    SfRadioGroupComponent,
    SfSearchInputComponent,
    SfSegmentedComponent,
    SfSelectComponent,
    SfSliderComponent,
    SfSwitchComponent,
    SfTextareaComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sg-controls.component.html',
  styleUrl: './sg-controls.component.scss',
})
export class SgControlsComponent {
  protected readonly s = { buttons: sectionOf('buttons'), forms: sectionOf('forms') };
  protected readonly variants = BUTTON_VARIANTS;
  protected readonly sizes = BUTTON_SIZES;
  protected readonly b = BUTTONS;
  protected readonly f = FORMS;
  protected readonly states = CONTROL_STATES;

  protected readonly pressed = signal(false);

  protected readonly text = signal<string>(FORMS.input.value);
  protected readonly longText = signal<string>(FORMS.textarea.value);
  protected readonly locale = signal<string | null>(FORMS.select.value);
  protected readonly count = signal<number | null>(FORMS.number.value);
  protected readonly date = signal<string | null>(FORMS.date.value);
  protected readonly time = signal<string | null>(FORMS.time.value);
  protected readonly dateTime = signal<string | null>(FORMS.datetime.value);
  protected readonly query = signal<string>(FORMS.search.value);
  protected readonly color = signal<string | null>(FORMS.color.value);
  protected readonly files = signal<File[]>([]);
  protected readonly checked = signal(true);
  protected readonly allChecked = signal(false);
  protected readonly someChecked = signal(true);
  protected readonly mode = signal<string | null>(FORMS.radio.value);
  protected readonly developer = signal(false);
  protected readonly view = signal<string | null>(FORMS.segmented.value);
  protected readonly template = signal<string | string[] | null>(FORMS.combobox.value);
  protected readonly tags = signal<string | string[] | null>([...FORMS.multi.value]);
  protected readonly quality = signal<number | null>(FORMS.slider.value);
  protected readonly layoutValue = signal('');
}
