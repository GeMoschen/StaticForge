import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { SampleFieldTagsPipe } from './forms/sample-field-tags.pipe';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToastService } from '../../../core/ui/toast.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { SfCopyableComponent } from '../../../shared/components/display/sf-copyable.component';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfStatusComponent } from '../../../shared/components/display/sf-status.component';
import { SfDateInputComponent } from '../../../shared/components/forms/sf-date-input.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfNumberInputComponent } from '../../../shared/components/forms/sf-number-input.component';
import { SfSelectComponent, SfSelectOption } from '../../../shared/components/forms/sf-select.component';
import { SfTextareaComponent } from '../../../shared/components/forms/sf-textarea.component';
import { SfBannerComponent } from '../../../shared/components/layout/sf-banner.component';
import { SfPageHeaderComponent } from '../../../shared/components/layout/sf-page-header.component';
import { SfSectionComponent } from '../../../shared/components/layout/sf-section.component';
import { SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfEmptyStateComponent } from '../../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { PICKER_MEDIA, PICKER_PAGES, PickerItem, SAMPLE_HIGHLIGHTS } from './forms/forms-data';
import { SampleListFieldComponent } from './forms/sample-list-field.component';
import { SampleMediaFieldComponent, SampleMediaValue } from './forms/sample-media-field.component';
import { SampleReferenceFieldComponent } from './forms/sample-reference-field.component';
import { RichTextCommand, SampleRichTextComponent } from './forms/sample-rich-text.component';
import { SampleBreadcrumbComponent } from './sample-breadcrumb.component';
import { SampleCard } from './sample-catalog';
import { SampleCatalogFieldComponent } from './sample-catalog-field.component';
import { FIXED_RECORD, FIXED_RECORD_USAGES, SampleDataset, SampleDatasetField, SampleRecord, SampleValue, datasetById } from './sample-content-data';
import { SampleContentPanelComponent, SampleContentPanelTab, SampleIssue } from './sample-content-panel.component';
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
 * UUID), status per language, save status, Checks, History, Release…, ⋮ — then the dataset's fields in `sf-field`s,
 * with the catalog field ("Tasting notes") as cards. Developer mode adds the dataset, UID and UUID. Edits change the
 * in-memory record only.
 *
 * Gate round 11: the ⋮ menu is **Save now**, **Move…** (another record set of the dataset), **Copy link**, **Used by…**
 * and **Delete…** (which says when pages or templates use the record); **Checks** (with a count badge) and **Used by…**
 * open the drawer; a **deleted record** shows a banner and **Restore**, its form locked; and the three states where no
 * record is on screen — *Record not found*, *Not there yet* (no such revision) and *Could not load the record* — each
 * with its way out (`state=notfound|revision|error|deleted`).
 */
@Component({
  selector: 'sf-sample-record-editor',
  standalone: true,
  imports: [
    SampleContentPanelComponent,
    SampleFieldTagsPipe,
    SfBadgeComponent,
    SfBannerComponent,
    SfDateInputComponent,
    SfEmptyStateComponent,
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
  /** `state=deleted`: the record is deleted — a banner and Restore, nothing to edit. */
  private readonly review = this.state.recordReview();
  protected readonly deleted = signal(this.review === 'deleted');
  /** `state=notfound|revision|error`: no record on screen, and what says why. */
  protected readonly missing = signal(this.review === 'deleted' ? null : this.review);
  protected readonly panelTab = signal<SampleContentPanelTab | null>(null);
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

  protected readonly moreActions = computed<SfMenuItem[]>(() => {
    const locked = this.deleted();
    return [
      { id: 'saveNow', label: this.state.t('record.menu.saveNow'), icon: 'save', disabled: locked },
      { id: 'move', label: this.state.t('record.menu.move'), icon: 'drive_file_move', disabled: locked },
      { id: 'copyLink', label: this.state.t('record.menu.copyLink'), icon: 'link', separatorBefore: true },
      { id: 'usedBy', label: this.state.t('record.menu.usedBy'), icon: 'account_tree' },
      { id: 'delete', label: this.state.t('record.menu.delete'), icon: 'delete', danger: true, disabled: locked, separatorBefore: true },
    ];
  });

  protected readonly booleanOptions = computed<SfSelectOption<string>[]>(() => [
    { value: 'true', label: this.state.t('dataset.yes') },
    { value: 'false', label: this.state.t('dataset.no') },
  ]);

  /** What uses the record: the fixed record is read by a page and another record, any other by nothing. */
  protected readonly usages = computed(() => (this.state.recordId() === FIXED_RECORD ? FIXED_RECORD_USAGES : []));

  /** The checks of the record's values (the dataset's rules): an error for a missing name or price, a note for low stock. */
  protected readonly issues = computed<SampleIssue[]>(() => {
    const record = this.current();
    if (!record) {
      return [];
    }
    const has = (id: string) => this.dataset().fields.some((field) => field.id === id);
    const issues: SampleIssue[] = [];
    if (this.name() === this.state.t('record.untitled')) {
      issues.push({ level: 'error', message: this.state.t('contentPanel.issues.nameRequired'), path: this.dataset().displayField });
    }
    const price = record.values['price'];
    if (has('price') && this.dataset().fields.find((field) => field.id === 'price')?.required && !(typeof price === 'number' && price > 0)) {
      issues.push({ level: 'error', message: this.state.t('contentPanel.issues.priceRequired'), path: 'price' });
    }
    const stock = record.values['stock'];
    if (has('stock') && typeof stock === 'number' && stock < 5) {
      issues.push({ level: 'warning', message: this.state.t('contentPanel.issues.lowStock', { count: stock }), path: 'stock' });
    }
    return issues.sort((a, b) => Number(b.level === 'error') - Number(a.level === 'error'));
  });
  protected readonly checkCount = computed(() => this.issues().length);
  protected readonly checkErrors = computed(() => this.issues().filter((issue) => issue.level === 'error').length);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.saveTimer && clearTimeout(this.saveTimer));
    // `panel=checks|usedby` (and the same from elsewhere): the drawer opens.
    effect(
      () => {
        const panel = this.state.contentPanel();
        if (panel) {
          untracked(() => {
            this.panelTab.set(panel === 'checks' ? 'issues' : 'usages');
            this.state.contentPanel.set(null);
          });
        }
      },
      { allowSignalWrites: true },
    );
  }

  protected openPanel(tab: SampleContentPanelTab): void {
    this.state.closeDrawers();
    this.panelTab.update((open) => (open === tab ? null : tab));
  }

  protected restore(): void {
    this.deleted.set(false);
    this.toasts.show(this.state.t('record.restored'), 'success');
  }

  /** The way out of a state without a record. */
  protected leave(): void {
    if (this.missing() === 'notfound') {
      this.state.openArea('content');
    } else {
      this.missing.set(null);
      this.state.recordReview.set(null);
    }
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
    if (!record) {
      return;
    }
    switch (item.id) {
      case 'saveNow':
        this.markSaving();
        return;
      case 'move': {
        const target = await this.state.moveRecordsToSet(this.state.recordSetId(), [record.id]);
        if (target) {
          this.state.recordSetId.set(target);
        }
        return;
      }
      case 'copyLink':
        await this.copyLink();
        return;
      case 'usedBy':
        this.state.closeDrawers();
        this.panelTab.set('usages');
        return;
    }
    const name = this.name();
    const used = this.usages().length;
    const confirmed = await this.confirms.confirm({
      title: this.state.t('editor.deleteTitle', { name }),
      message: used > 0 ? this.state.t('record.deleteUsed', { count: used }) : this.state.t('record.deleteMessage'),
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

  private async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(location.href);
      this.toasts.show(this.state.t('record.linkCopied'), 'success');
    } catch {
      this.toasts.show(this.state.t('record.linkFailed'), 'error');
    }
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
