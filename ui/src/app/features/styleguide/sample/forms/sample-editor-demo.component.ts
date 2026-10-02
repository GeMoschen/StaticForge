import { ChangeDetectionStrategy, Component, OnInit, computed, input, signal } from '@angular/core';
import { SampleFieldTagsPipe } from './sample-field-tags.pipe';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfComboboxComponent, SfComboboxOption } from '../../../../shared/components/forms/sf-combobox.component';
import { SfColorInputComponent } from '../../../../shared/components/forms/sf-color-input.component';
import { SfDateInputComponent } from '../../../../shared/components/forms/sf-date-input.component';
import { SfFinding } from '../../../../shared/components/forms/sf-finding.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfNumberInputComponent } from '../../../../shared/components/forms/sf-number-input.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfSwitchComponent } from '../../../../shared/components/forms/sf-switch.component';
import { SfTextareaComponent } from '../../../../shared/components/forms/sf-textarea.component';
import { injectSampleText } from '../changes/sample-area.util';
import { SampleCatalogFieldComponent } from '../sample-catalog-field.component';
import { SampleCard, TEASERS_FIELD, initialTeasers } from '../sample-catalog';
import { PICKER_PAGES, PICKER_RECORDS, PickerItem, SAMPLE_HIGHLIGHTS, SAMPLE_INTRO_HTML, SAMPLE_SEO } from './forms-data';
import { SampleGroupFieldComponent } from './sample-group-field.component';
import { SampleListFieldComponent } from './sample-list-field.component';
import { SampleMediaFieldComponent, SampleMediaValue } from './sample-media-field.component';
import { SampleReferenceFieldComponent, SampleLinkValue } from './sample-reference-field.component';
import { SampleRichTextComponent } from './sample-rich-text.component';
import { PICKER_MEDIA } from './forms-data';

/** The editor types of the content-definition language, lower case. */
export const EDITOR_TYPES = [
  'text',
  'textarea',
  'richtext',
  'markdown',
  'number',
  'boolean',
  'date',
  'datetime',
  'select',
  'multiselect',
  'color',
  'link',
  'media',
  'reference',
  'list',
  'group',
  'json',
  'catalog',
  'pagination',
] as const;
export type EditorType = (typeof EDITOR_TYPES)[number];

/** The states the gallery shows each editor in. */
export type EditorState = 'default' | 'required' | 'readonly' | 'computed';
export const EDITOR_STATES: readonly EditorState[] = ['default', 'required', 'readonly', 'computed'];

/**
 * One editor of the Content form gallery (M35.17 sample), in one state: `default` (filled, with a hint), `required` (empty,
 * so the field shows its required error once), `readonly` and `computed` (readable value, "Computed" cue). The
 * `language` is the chip next to the label (`null` = the template is not localized). Each editor is its real design:
 * the M35.6 control inside the shared field, or the sample composite (rich text, media, reference, list, group).
 */
@Component({
  selector: 'sf-sample-editor-demo',
  standalone: true,
  imports: [
    SfFieldComponent,
    SampleFieldTagsPipe,
    SampleCatalogFieldComponent,
    SampleGroupFieldComponent,
    SampleListFieldComponent,
    SampleMediaFieldComponent,
    SampleReferenceFieldComponent,
    SampleRichTextComponent,
    SfColorInputComponent,
    SfComboboxComponent,
    SfDateInputComponent,
    SfInputComponent,
    SfNumberInputComponent,
    SfSelectComponent,
    SfSwitchComponent,
    SfTextareaComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-editor-demo.component.scss',
  template: `
    <sf-field
      [label]="label()"
      [hint]="hint()"
      [required]="state() === 'required'"
      [empty]="empty()"
      [findings]="findings()"
    
        [tags]="language() | fieldTags: true">
      @switch (type()) {
        @case ('text') {
          <sf-input [readonly]="locked()" [value]="text()" (valueChange)="text.set($event)" />
        }
        @case ('textarea') {
          <sf-textarea [rows]="3" [readonly]="locked()" [value]="longText()" (valueChange)="longText.set($event)" />
        }
        @case ('richtext') {
          <sf-sample-rich-text [label]="label()" [readonly]="locked()" [invalid]="state() === 'required' && empty()" [value]="html()" (valueChange)="html.set($event)" />
        }
        @case ('markdown') {
          <sf-textarea [rows]="4" monospace [readonly]="locked()" [value]="markdown()" (valueChange)="markdown.set($event)" />
        }
        @case ('number') {
          <sf-number-input unit="€" [min]="0" [step]="0.1" [readonly]="locked()" [value]="number()" (valueChange)="number.set($event)" />
        }
        @case ('boolean') {
          <sf-switch [disabled]="locked()" [value]="flag()" (valueChange)="flag.set($event)" />
        }
        @case ('date') {
          <sf-date-input [readonly]="locked()" [value]="date()" (valueChange)="date.set($event)" />
        }
        @case ('datetime') {
          <sf-date-input mode="datetime" [readonly]="locked()" [value]="dateTime()" (valueChange)="dateTime.set($event)" />
        }
        @case ('select') {
          <sf-select [options]="roasts" [readonly]="locked()" [value]="roast()" (valueChange)="roast.set($event)" />
        }
        @case ('multiselect') {
          <sf-combobox multiple [options]="tagOptions" [readonly]="locked()" [value]="tags()" (valueChange)="tags.set($any($event))" />
        }
        @case ('color') {
          <sf-color-input [readonly]="locked()" [value]="color()" (valueChange)="color.set($event)" />
        }
        @case ('link') {
          <sf-sample-reference-field link [readonly]="locked()" [linkValue]="link()" (linkValueChange)="link.set($event)" />
        }
        @case ('media') {
          <sf-sample-media-field [developerMode]="false" [readonly]="locked()" [value]="media()" (valueChange)="media.set($event)" />
        }
        @case ('reference') {
          <sf-sample-reference-field [kind]="'record'" [readonly]="locked()" [reference]="reference()" (referenceChange)="reference.set($event)" />
        }
        @case ('list') {
          <sf-sample-list-field [label]="label()" [readonly]="locked()" [items]="items()" (itemsChange)="items.set($event)" />
        }
        @case ('group') {
          <sf-sample-group-field [name]="label()" [summary]="seoSummary()">
            <sf-field [label]="t('group.title')"
        [tags]="language() | fieldTags">
              <sf-input [readonly]="locked()" [value]="seoTitle()" (valueChange)="seoTitle.set($event)" />
            </sf-field>
            <sf-field [label]="t('group.canonical')">
              <sf-input [readonly]="locked()" [value]="seoCanonical()" (valueChange)="seoCanonical.set($event)" />
            </sf-field>
          </sf-sample-group-field>
        }
        @case ('json') {
          <sf-textarea [rows]="4" monospace [invalid]="jsonError() !== null" [readonly]="locked()" [value]="json()" (valueChange)="json.set($event)" />
        }
        @case ('catalog') {
          <sf-sample-catalog-field [catalogId]="'gallery-' + state()" [label]="label()" [types]="catalogTypes" [(cards)]="cards" />
        }
        @case ('pagination') {
          <div class="pagination">
            <sf-select [aria-label]="t('pagination.source')" [options]="sources" [readonly]="locked()" [value]="source()" (valueChange)="source.set($event)" />
            <sf-number-input [aria-label]="t('pagination.pageSize')" [min]="1" [max]="100" [readonly]="locked()" [value]="pageSize()" (valueChange)="pageSize.set($event)" />
            <sf-select [aria-label]="t('pagination.sort')" [options]="sorts" [readonly]="locked()" [value]="sort()" (valueChange)="sort.set($event)" />
          </div>
        }
      }
    </sf-field>
  `,
})
export class SampleEditorDemoComponent implements OnInit {
  readonly type = input.required<EditorType>();
  readonly state = input<EditorState>('default');
  /** The language chip: a language name, `'all'`, or `null` for a template that is not localized. */
  readonly language = input<string | null>(null);

  protected readonly t = injectSampleText('styleguide.sample.forms');
  protected readonly locked = computed(() => this.state() === 'readonly' || this.state() === 'computed');
  protected readonly label = computed(() => this.t(`editors.${this.type()}`));
  protected readonly hint = computed(() => {
    const state = this.state();
    return state === 'computed' ? this.t('hints.computed') : state === 'readonly' ? this.t('hints.readonly') : this.t(`hints.${this.type()}`);
  });

  // ── Values (nothing is saved) ──────────────────────────────────────────────
  protected readonly text = signal('Spring harvest arrives');
  protected readonly longText = signal('Our first lots from the Yirgacheffe highlands have landed in Hamburg.');
  protected readonly html = signal(SAMPLE_INTRO_HTML);
  protected readonly markdown = signal('## Brewing\n\nUse **93 °C** water and a 1:16 ratio.');
  protected readonly number = signal<number | null>(14.9);
  protected readonly flag = signal(true);
  protected readonly date = signal<string | null>('2026-09-14');
  protected readonly dateTime = signal<string | null>('2026-09-14T09:30');
  protected readonly roast = signal<string | null>('light');
  protected readonly tags = signal<string[]>(['harvest', 'ethiopia']);
  protected readonly color = signal<string | null>('#7a4b2a');
  protected readonly link = signal<SampleLinkValue>({ mode: 'page', page: PICKER_PAGES[3], url: '' });
  protected readonly media = signal<SampleMediaValue | null>({ item: PICKER_MEDIA[1], alt: 'Coffee cherries drying on raised beds' });
  protected readonly reference = signal<PickerItem | null>(PICKER_RECORDS[0]);
  protected readonly items = signal<readonly string[]>(SAMPLE_HIGHLIGHTS);
  protected readonly seoTitle = signal(SAMPLE_SEO.title);
  protected readonly seoCanonical = signal(SAMPLE_SEO.canonical);
  protected readonly json = signal('{\n  "origin": "Ethiopia",\n  "altitude": 1950\n}');
  protected readonly cards = signal<readonly SampleCard[]>(initialTeasers().slice(0, 2));
  protected readonly source = signal<string | null>('dataset');
  protected readonly pageSize = signal<number | null>(12);
  protected readonly sort = signal<string | null>('name');

  protected readonly catalogTypes = TEASERS_FIELD.types;
  protected readonly roasts: SfSelectOption<string>[] = [
    { value: 'light', label: 'Light' },
    { value: 'medium', label: 'Medium' },
    { value: 'dark', label: 'Dark' },
  ];
  protected readonly tagOptions: SfComboboxOption<string>[] = [
    { value: 'harvest', label: 'Harvest' },
    { value: 'ethiopia', label: 'Ethiopia' },
    { value: 'roastery', label: 'Roastery' },
  ];
  protected readonly sources: SfSelectOption<string>[] = [
    { value: 'dataset', label: 'Dataset' },
    { value: 'nav', label: 'Navigation' },
  ];
  protected readonly sorts: SfSelectOption<string>[] = [
    { value: 'name', label: 'Name' },
    { value: 'date', label: 'Date' },
  ];

  protected readonly seoSummary = computed(() => (this.seoTitle() ? `${this.seoTitle()} · ${this.seoCanonical()}` : ''));
  protected readonly jsonError = computed(() => {
    if (this.json().trim() === '') {
      return null;
    }
    try {
      JSON.parse(this.json());
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  });

  /** The control has no value. */
  protected readonly empty = computed(() => {
    switch (this.type()) {
      case 'text':
        return this.text().trim() === '';
      case 'textarea':
        return this.longText().trim() === '';
      case 'richtext':
        return this.html().replace(/<[^>]*>/g, '').trim() === '';
      case 'markdown':
        return this.markdown().trim() === '';
      case 'number':
        return this.number() === null;
      case 'date':
        return this.date() === null;
      case 'datetime':
        return this.dateTime() === null;
      case 'select':
        return this.roast() === null;
      case 'multiselect':
        return this.tags().length === 0;
      case 'color':
        return this.color() === null;
      case 'link':
        return this.link().page === null && this.link().url.trim() === '';
      case 'media':
        return this.media() === null;
      case 'reference':
        return this.reference() === null;
      case 'list':
        return this.items().length === 0;
      case 'group':
        return this.seoTitle().trim() === '';
      case 'json':
        return this.json().trim() === '';
      case 'catalog':
        return this.cards().length === 0;
      default:
        return false;
    }
  });

  /** A parse error of a JSON value, a missing alt text… — what a rule would report for the shown value. */
  protected readonly findings = computed<readonly SfFinding[]>(() => {
    const out: SfFinding[] = [];
    if (this.type() === 'json' && this.jsonError()) {
      out.push({ level: 'error', message: this.t('findings.jsonInvalid', { message: this.jsonError() }) });
    }
    return out;
  });

  /** The `required` state shows the field empty, so its required error is the thing to see. */
  ngOnInit(): void {
    if (this.state() !== 'required') {
      return;
    }
    this.text.set('');
    this.longText.set('');
    this.html.set('');
    this.markdown.set('');
    this.number.set(null);
    this.date.set(null);
    this.dateTime.set(null);
    this.roast.set(null);
    this.tags.set([]);
    this.color.set(null);
    this.link.set({ mode: 'page', page: null, url: '' });
    this.media.set(null);
    this.reference.set(null);
    this.items.set([]);
    this.seoTitle.set('');
    this.seoCanonical.set('');
    this.json.set('');
    this.cards.set([]);
  }
}
