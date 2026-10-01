import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SfDataTableColumn } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { SfDrawerComponent, SfDrawerFooterDirective } from '../../../../shared/components/dialog/sf-drawer.component';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfComboboxComponent, SfComboboxOption } from '../../../../shared/components/forms/sf-combobox.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfSwitchComponent } from '../../../../shared/components/forms/sf-switch.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SampleSettingsSaveComponent } from './sample-settings-save.component';
import { LANGUAGE_CHOICES, SettingsLanguage } from './settings-data';
import { SettingsState } from './settings-state';

/** A language being edited in the drawer (`original` null: a new one). */
interface LanguageDraft {
  original: string | null;
  code: string | null;
  label: string;
  fallbacks: string[];
  isDefault: boolean;
  withoutPrefix: boolean;
}

/**
 * Settings › Languages: the project's languages in an `sf-data-table` (default badge, fallbacks, pages); "Add
 * language" and a row open the form in an `sf-drawer`. Applying the drawer changes the table; the page's save area
 * saves the table. Removing asks first; the default language can't be removed.
 */
@Component({
  selector: 'sf-sample-settings-languages',
  standalone: true,
  imports: [
    SampleSettingsSaveComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfComboboxComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfDrawerComponent,
    SfDrawerFooterDirective,
    SfFieldComponent,
    SfInputComponent,
    SfPageHeaderComponent,
    SfSwitchComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-settings-languages.component.html',
  styleUrl: './sample-settings-languages.component.scss',
})
export class SampleSettingsLanguagesComponent {
  protected readonly state = inject(SettingsState);
  protected readonly t = this.state.t;
  private readonly confirms = inject(ConfirmService);

  protected readonly draft = signal<LanguageDraft | null>(null);
  protected readonly rowKey = (row: SettingsLanguage) => row.code;
  protected readonly rowLabel = (row: SettingsLanguage) => row.label;

  protected readonly columns = computed<SfDataTableColumn<SettingsLanguage>[]>(() => {
    const h = (id: string) => this.t(`languages.columns.${id}`);
    return [
      { id: 'label', header: h('label'), value: (r) => r.label, sortable: true, hideable: false, width: 240 },
      { id: 'code', header: h('code'), value: (r) => r.code, sortable: true, width: 120 },
      { id: 'fallbacks', header: h('fallbacks'), value: (r) => this.fallbackText(r), width: 240 },
      { id: 'pages', header: h('pages'), value: (r) => r.pages, sortable: true, align: 'end', width: 140 },
    ];
  });

  protected readonly codeOptions = computed<SfComboboxOption<string>[]>(() => {
    const draft = this.draft();
    const taken = new Set(this.state.languages().map((l) => l.code));
    return LANGUAGE_CHOICES.map((c) => ({
      value: c.code,
      label: c.code,
      description: c.label,
      disabled: taken.has(c.code) && c.code !== draft?.original,
    }));
  });

  protected readonly fallbackOptions = computed<SfComboboxOption<string>[]>(() => {
    const code = this.draft()?.code;
    return this.state
      .languages()
      .filter((l) => l.code !== code)
      .map((l) => ({ value: l.code, label: l.label, description: l.code }));
  });

  protected readonly drawerTitle = computed(() => {
    const draft = this.draft();
    return draft?.original ? this.t('languages.editTitle', { name: draft.label || draft.original }) : this.t('languages.newTitle');
  });

  constructor() {
    const row = this.state.drawerRow();
    const language = this.state.languages().find((l) => l.code === row);
    if (language) {
      this.edit(language);
    }
  }

  protected fallbackText(row: SettingsLanguage): string {
    const labels = row.fallbacks.map((code) => this.state.languages().find((l) => l.code === code)?.label ?? code);
    return labels.join(' → ');
  }

  protected add(): void {
    this.draft.set({ original: null, code: null, label: '', fallbacks: [], isDefault: false, withoutPrefix: false });
  }

  protected edit(row: SettingsLanguage): void {
    this.draft.set({ original: row.code, code: row.code, label: row.label, fallbacks: [...row.fallbacks], isDefault: row.isDefault, withoutPrefix: row.withoutPrefix });
    this.state.drawerRow.set(row.code);
  }

  protected close(): void {
    this.draft.set(null);
    this.state.drawerRow.set(null);
  }

  protected patch(change: Partial<LanguageDraft>): void {
    this.draft.update((d) => (d ? { ...d, ...change } : d));
  }

  protected pickCode(value: string | string[] | null): void {
    const code = typeof value === 'string' ? value : null;
    const draft = this.draft();
    const choice = LANGUAGE_CHOICES.find((c) => c.code === code);
    this.patch({ code, label: draft?.label || choice?.label || '' });
  }

  protected pickFallbacks(value: string | string[] | null): void {
    this.patch({ fallbacks: Array.isArray(value) ? value : value ? [value] : [] });
  }

  protected apply(): void {
    const d = this.draft();
    if (!d?.code || !d.label) {
      return;
    }
    const existing = this.state.languages().find((l) => l.code === d.original);
    const next: SettingsLanguage = {
      code: d.code,
      label: d.label,
      fallbacks: d.fallbacks,
      isDefault: d.isDefault,
      withoutPrefix: d.withoutPrefix,
      pages: existing?.pages ?? 0,
    };
    this.state.languages.update((rows) => {
      const list = existing ? rows.map((l) => (l.code === d.original ? next : l)) : [...rows, next];
      return d.isDefault ? list.map((l) => (l === next ? l : { ...l, isDefault: false })) : list;
    });
    this.close();
  }

  protected async remove(): Promise<void> {
    const d = this.draft();
    if (!d?.original) {
      return;
    }
    const confirmed = await this.confirms.confirm({
      title: this.t('languages.removeTitle', { name: d.label }),
      message: this.t('languages.removeMessage'),
      confirmLabel: this.t('languages.removeConfirm'),
      tone: 'danger',
    });
    if (confirmed) {
      const code = d.original;
      this.state.languages.update((rows) =>
        rows.filter((l) => l.code !== code).map((l) => (l.fallbacks.includes(code) ? { ...l, fallbacks: l.fallbacks.filter((f) => f !== code) } : l)),
      );
      this.close();
    }
  }

  protected save(): void {
    this.state.languagesSaved.set(this.state.languages());
    this.state.notice();
  }
}
