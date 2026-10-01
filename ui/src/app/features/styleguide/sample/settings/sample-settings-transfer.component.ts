import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfTab, SfTabsComponent } from '../../../../shared/components/sf-tabs.component';
import { SampleSettingsExportComponent } from './sample-settings-export.component';
import { SampleSettingsImportComponent } from './sample-settings-import.component';
import { TRANSFER_TABS, TransferTab } from './settings-data';
import { SettingsState } from './settings-state';

/**
 * Settings › Import / export: one page (one `h1`) with Export | Import tabs; the tabs name the parts, so the panels
 * have no headings of their own (M35.25: no duplicated headings). Nothing here is a form to save.
 */
@Component({
  selector: 'sf-sample-settings-transfer',
  standalone: true,
  imports: [SampleSettingsExportComponent, SampleSettingsImportComponent, SfPageHeaderComponent, SfTabsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-settings-transfer.component.html',
  styleUrl: './sample-settings-transfer.component.scss',
})
export class SampleSettingsTransferComponent {
  protected readonly state = inject(SettingsState);
  protected readonly t = this.state.t;

  protected readonly tabs = computed<SfTab[]>(() => TRANSFER_TABS.map((id) => ({ id, label: this.t(`transfer.${id}`) })));

  protected selectTab(id: string): void {
    this.state.transferTab.set(id as TransferTab);
  }
}
