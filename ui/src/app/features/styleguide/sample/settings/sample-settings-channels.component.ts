import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SfDataTableColumn } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { SfDrawerComponent, SfDrawerFooterDirective } from '../../../../shared/components/dialog/sf-drawer.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfSwitchComponent } from '../../../../shared/components/forms/sf-switch.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SampleSettingsSaveComponent } from './sample-settings-save.component';
import { HIGHLIGHT_LANGUAGES, HighlightLanguage, SettingsChannel } from './settings-data';
import { SettingsState } from './settings-state';

/** A channel being edited in the drawer (`original` null: a new one). */
interface ChannelDraft extends Omit<SettingsChannel, 'key'> {
  original: string | null;
  key: string;
}

/**
 * Settings › Channels (developer mode only): the output channels in an `sf-data-table` with an enabled switch per row;
 * "Add channel" and a row open the form in an `sf-drawer`. The page's save area saves the table.
 */
@Component({
  selector: 'sf-sample-settings-channels',
  standalone: true,
  imports: [
    SampleSettingsSaveComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfDrawerComponent,
    SfDrawerFooterDirective,
    SfFieldComponent,
    SfInputComponent,
    SfPageHeaderComponent,
    SfSelectComponent,
    SfSwitchComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-settings-channels.component.html',
  styleUrl: './sample-settings-channels.component.scss',
})
export class SampleSettingsChannelsComponent {
  protected readonly state = inject(SettingsState);
  protected readonly t = this.state.t;
  private readonly confirms = inject(ConfirmService);

  protected readonly draft = signal<ChannelDraft | null>(null);
  protected readonly rowKey = (row: SettingsChannel) => row.key;
  protected readonly rowLabel = (row: SettingsChannel) => row.name;

  protected readonly columns = computed<SfDataTableColumn<SettingsChannel>[]>(() => {
    const h = (id: string) => this.t(`channels.columns.${id}`);
    return [
      { id: 'key', header: h('key'), value: (r) => r.key, sortable: true, hideable: false, width: 120 },
      { id: 'name', header: h('name'), value: (r) => r.name, sortable: true, width: 200 },
      { id: 'enabled', header: h('enabled'), value: (r) => r.enabled, width: 120, searchable: false },
      { id: 'outputFolder', header: h('outputFolder'), value: (r) => r.outputFolder, width: 180 },
      { id: 'highlightAs', header: h('highlightAs'), value: (r) => this.t(`channels.highlight.${r.highlightAs}`), width: 160 },
    ];
  });

  protected readonly highlightOptions = computed<SfSelectOption<HighlightLanguage>[]>(() =>
    HIGHLIGHT_LANGUAGES.map((h) => ({ value: h, label: this.t(`channels.highlight.${h}`) })),
  );

  protected readonly drawerTitle = computed(() => {
    const draft = this.draft();
    return draft?.original ? this.t('channels.editTitle', { name: draft.name || draft.original }) : this.t('channels.newTitle');
  });

  constructor() {
    const row = this.state.drawerRow();
    const channel = this.state.channels().find((c) => c.key === row);
    if (channel) {
      this.edit(channel);
    }
  }

  protected setEnabled(row: SettingsChannel, enabled: boolean): void {
    this.state.channels.update((rows) => rows.map((c) => (c.key === row.key ? { ...c, enabled } : c)));
  }

  protected add(): void {
    this.draft.set({ original: null, key: '', name: '', enabled: true, outputFolder: '/', extension: 'html', highlightAs: 'html' });
  }

  protected edit(row: SettingsChannel): void {
    this.draft.set({ ...row, original: row.key });
    this.state.drawerRow.set(row.key);
  }

  protected close(): void {
    this.draft.set(null);
    this.state.drawerRow.set(null);
  }

  protected patch(change: Partial<ChannelDraft>): void {
    this.draft.update((d) => (d ? { ...d, ...change } : d));
  }

  protected apply(): void {
    const d = this.draft();
    if (!d?.key || !d.name) {
      return;
    }
    const { original, ...next } = d;
    this.state.channels.update((rows) => (original ? rows.map((c) => (c.key === original ? next : c)) : [...rows, next]));
    this.close();
  }

  protected async remove(): Promise<void> {
    const d = this.draft();
    if (!d?.original) {
      return;
    }
    const confirmed = await this.confirms.confirm({
      title: this.t('channels.removeTitle', { name: d.name }),
      message: this.t('channels.removeMessage'),
      confirmLabel: this.t('channels.removeConfirm'),
      tone: 'danger',
    });
    if (confirmed) {
      const key = d.original;
      this.state.channels.update((rows) => rows.filter((c) => c.key !== key));
      this.close();
    }
  }

  protected save(): void {
    this.state.channelsSaved.set(this.state.channels());
    this.state.notice();
  }
}
