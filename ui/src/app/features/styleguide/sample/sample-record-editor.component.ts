import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { SampleFieldTagsPipe } from './forms/sample-field-tags.pipe';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToastService } from '../../../core/ui/toast.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { SfCopyableComponent } from '../../../shared/components/display/sf-copyable.component';
import { SfStatusComponent } from '../../../shared/components/display/sf-status.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfNumberInputComponent } from '../../../shared/components/forms/sf-number-input.component';
import { SfSelectComponent, SfSelectOption } from '../../../shared/components/forms/sf-select.component';
import { SfTextareaComponent } from '../../../shared/components/forms/sf-textarea.component';
import { SfPageHeaderComponent } from '../../../shared/components/layout/sf-page-header.component';
import { SfSectionComponent } from '../../../shared/components/layout/sf-section.component';
import { SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { PICKER_MEDIA, PICKER_PAGES, PickerItem, SAMPLE_HIGHLIGHTS } from './forms/forms-data';
import { SampleListFieldComponent } from './forms/sample-list-field.component';
import { SampleMediaFieldComponent, SampleMediaValue } from './forms/sample-media-field.component';
import { SampleReferenceFieldComponent } from './forms/sample-reference-field.component';
import { RichTextCommand, SampleRichTextComponent } from './forms/sample-rich-text.component';
import { SampleBreadcrumbComponent } from './sample-breadcrumb.component';
import { SampleCard } from './sample-catalog';
import { SampleCatalogFieldComponent } from './sample-catalog-field.component';
import { SampleDataset, SampleDatasetField, SampleRecord, SampleValue, datasetById } from './sample-content-data';
import { LANGUAGE_NAMES, SAMPLE_LANGS } from './sample-data';
import { STATUS_ICONS, STATUS_TONES, SampleState } from './sample-state';
import { SfSaveStatusComponent } from '../../../shared/components/layout/sf-save-status.component';

const SAVE_DELAY_MS = 700;

/** One field of the form: its definition, current value and (for selects) options. */
interface RecordField {
  readonly field: SampleDatasetField;
  readonly value: SampleValue;
  readonly options: SfSelectOption<string>[];
}

/**
 * The record editor (M35.20 mocked): a header like the page editor's — breadcrumb, the record's display name (never its
 * UUID), status per language, save status, History, Release…, ⋮ with Delete — then the dataset's fields in `sf-field`s,
 * with the catalog field ("Tasting notes") as cards. Developer mode adds the dataset, UID and UUID. Edits change the
 * in-memory record only.
 */
@Component({
  selector: 'sf-sample-record-editor',
  standalone: true,
  imports: [
    SampleFieldTagsPipe,
    SfSaveStatusComponent,
    SampleBreadcrumbComponent,
    SampleCatalogFieldComponent,
    SampleListFieldComponent,
    SampleMediaFieldComponent,
    SampleReferenceFieldComponent,
    SampleRichTextComponent,
    SfButtonComponent,
    SfCopyableComponent,
    SfFieldComponent,
    SfIconComponent,
    SfInputComponent,
    SfNumberInputComponent,
    SfPageHeaderComponent,
    SfSectionComponent,
    SfSelectComponent,
    SfStatusComponent,
    SfTextareaComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-record-editor.component.html',
  styleUrl: './sample-record-editor.component.scss',
})
export class SampleRecordEditorComponent {
  protected readonly state = inject(SampleState);

  // The richer content form (M35.17): a rich-text field with a reduced toolbar, a reference, a list, a media field.
  protected readonly description = signal('<p>Washed Yirgacheffe with notes of <strong>jasmine</strong> and bergamot.</p>');
  protected readonly origin = signal<PickerItem | null>(PICKER_PAGES[10]);
  protected readonly notes = signal<readonly string[]>(SAMPLE_HIGHLIGHTS.slice(0, 2));
  protected readonly media = signal<SampleMediaValue | null>({ item: PICKER_MEDIA[0], alt: '' });
  protected readonly richFeatures: readonly RichTextCommand[] = ['bold', 'italic', 'ul', 'link', 'clear'];
  protected readonly chip = computed(() => LANGUAGE_NAMES[this.state.lang()]);
  protected forms(key: string): string {
    return this.state.t(`forms.record.${key}`);
  }
  protected isEmpty(value: unknown): boolean {
    return value === null || value === undefined || value === '';
  }
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);

  protected readonly langs = SAMPLE_LANGS;
  protected readonly tones = STATUS_TONES;
  protected readonly icons = STATUS_ICONS;
  protected readonly saving = signal(false);
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly current = this.state.record;
  protected readonly dataset = computed<SampleDataset>(() => datasetById(this.state.recordSet().dataset)!);
  protected readonly name = computed(() => this.state.recordName(this.current()));

  protected readonly fields = computed<RecordField[]>(() => {
    const record = this.current();
    return this.dataset().fields.map((field) => ({
      field,
      value: record?.values[field.id] ?? null,
      options: (field.options ?? []).map((o) => ({ value: o.value, label: o.label })),
    }));
  });
  protected readonly plainFields = computed(() => this.fields().filter((f) => f.field.type !== 'catalog'));
  protected readonly catalogFields = computed(() => this.fields().filter((f) => f.field.type === 'catalog'));

  protected readonly moreActions = computed<SfMenuItem[]>(() => [
    { id: 'duplicate', label: this.state.t('editor.duplicate'), icon: 'content_copy' },
    { id: 'move', label: this.state.t('editor.move'), icon: 'drive_file_move' },
    { id: 'copyLink', label: this.state.t('editor.copyLink'), icon: 'link' },
    { id: 'delete', label: this.state.t('editor.delete'), icon: 'delete', danger: true, separatorBefore: true },
  ]);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.saveTimer && clearTimeout(this.saveTimer));
  }

  protected text(value: SampleValue): string {
    return typeof value === 'string' ? value : value === null ? '' : String(value);
  }

  protected number(value: SampleValue): number | null {
    return typeof value === 'number' ? value : null;
  }

  protected cards(value: SampleValue): readonly SampleCard[] {
    return Array.isArray(value) ? value : [];
  }

  protected setValue(field: string, value: SampleValue): void {
    const record = this.current();
    if (!record) {
      return;
    }
    this.state.updateRecord(this.state.recordSetId(), { ...record, values: { ...record.values, [field]: value } });
    this.markSaving();
  }

  protected async release(): Promise<void> {
    const name = this.name();
    const confirmed = await this.confirms.confirm({
      title: this.state.t('editor.releaseTitle', { name }),
      message: this.state.t('editor.releaseMessage'),
      confirmLabel: this.state.t('editor.releaseConfirm'),
      details: SAMPLE_LANGS.map((lang) => lang.toUpperCase()),
    });
    if (confirmed) {
      this.toasts.show(this.state.t('editor.releaseDone', { name }), 'success');
    }
  }

  protected async secondary(item: SfMenuItem): Promise<void> {
    const record = this.current();
    if (item.id !== 'delete' || !record) {
      this.state.notice();
      return;
    }
    const name = this.name();
    const confirmed = await this.confirms.confirm({
      title: this.state.t('editor.deleteTitle', { name }),
      message: this.state.t('record.deleteMessage'),
      confirmLabel: this.state.t('record.deleteConfirm'),
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    const setId = this.state.recordSetId();
    const restore = this.state.removeRecords(setId, [record.id]);
    this.state.openRecordSet(setId);
    this.toasts.undo(this.state.t('folder.deleted', { count: 1, name }), restore);
  }

  private markSaving(): void {
    this.saving.set(true);
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saving.set(false);
      this.saveTimer = null;
    }, SAVE_DELAY_MS);
  }
}
