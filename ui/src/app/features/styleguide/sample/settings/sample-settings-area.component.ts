import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject } from '@angular/core';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfSideNavComponent, SfSideNavItem } from '../../../../shared/components/layout/sf-side-nav.component';
import { SfEmptyStateComponent } from '../../../../shared/components/sf-empty-state.component';
import { injectSampleQuery, oneOf } from '../changes/sample-area.util';
import { SampleSettingsChannelsComponent } from './sample-settings-channels.component';
import { SampleSettingsGeneralComponent } from './sample-settings-general.component';
import { SampleSettingsLanguagesComponent } from './sample-settings-languages.component';
import { SampleSettingsTransferComponent } from './sample-settings-transfer.component';
import {
  DEV_ONLY_SECTIONS,
  EXPORT_STEPS,
  SECTION_GROUPS,
  SECTION_ICONS,
  SETTINGS_SECTIONS,
  SettingsSection,
  TRANSFER_TABS,
  UNBUILT_SECTIONS,
} from './settings-data';
import { SampleState } from '../sample-state';
import { SettingsState } from './settings-state';

/**
 * The sample's Settings area (M35.25 preview, M35.9 decisions 31–32): a grouped secondary side menu (`sf-side-nav`) —
 * PROJECT (General, Languages, Channels in developer mode, Media, Code highlighting), MAINTENANCE (Compaction, Import /
 * export), PEOPLE (Members) — and the chosen sub-page beside it, each with its own page header (one `h1`) and one save
 * area. Media, Code highlighting, Compaction and Members are listed but not built in the sample.
 *
 * Query parameters (read on load, written back as the user clicks; other parameters stay): `ssec` — the section,
 * `sdrawer=1` — the Languages or Channels drawer for the first row, `itab=import` — the Import tab, `istep` — the export
 * step (`select | options | run | result`; `run` is a scripted, paused run). Developer mode: the sample screen's
 * `SampleState.developerMode` when inside it, else the `dev` parameter (`dev=0` = off). Nothing is saved.
 */
@Component({
  selector: 'sf-sample-settings-area',
  standalone: true,
  imports: [
    SampleSettingsChannelsComponent,
    SampleSettingsGeneralComponent,
    SampleSettingsLanguagesComponent,
    SampleSettingsTransferComponent,
    SfEmptyStateComponent,
    SfPageHeaderComponent,
    SfSideNavComponent,
  ],
  providers: [SettingsState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-settings-area.component.html',
  styleUrl: './sample-settings-area.component.scss',
})
export class SampleSettingsAreaComponent {
  protected readonly state = inject(SettingsState);
  protected readonly t = this.state.t;
  private readonly query = injectSampleQuery();

  protected readonly navItems = computed<SfSideNavItem[]>(() => {
    const t = this.t;
    const dev = this.state.devMode();
    const dirty: Partial<Record<SettingsSection, boolean>> = {
      general: this.state.generalDirty(),
      languages: this.state.languagesDirty(),
      channels: this.state.channelsDirty(),
    };
    return SETTINGS_SECTIONS.filter((id) => dev || !DEV_ONLY_SECTIONS.includes(id)).map((id) => ({
      id,
      label: t(`sections.${id}`),
      icon: SECTION_ICONS[id],
      group: t(`groups.${SECTION_GROUPS[id]}`),
      badge: dirty[id] ? t('nav.unsaved') : null,
      badgeTone: 'warning' as const,
    }));
  });

  protected readonly unbuilt = computed(() => UNBUILT_SECTIONS.includes(this.state.visibleSection()));

  constructor() {
    const section = oneOf<SettingsSection>(this.query.get('ssec'), SETTINGS_SECTIONS);
    if (section) {
      this.state.section.set(section);
    }
    if (this.query.get('sdrawer') === '1') {
      const visible = this.state.visibleSection();
      const first = visible === 'languages' ? this.state.languages()[0]?.code : visible === 'channels' ? this.state.channels()[0]?.key : null;
      this.state.drawerRow.set(first ?? null);
    }
    const tab = oneOf(this.query.get('itab'), TRANSFER_TABS);
    if (tab) {
      this.state.transferTab.set(tab);
    }
    const step = oneOf(this.query.get('istep'), EXPORT_STEPS);
    if (step) {
      this.state.exportStep.set(step);
    }

    // Leaving the screen (rail, tree) with unsaved changes in the open section asks first.
    const sample = inject(SampleState, { optional: true });
    const unregister = sample?.registerGuard(() => this.state.canLeaveSection());
    inject(DestroyRef).onDestroy(() => unregister?.());

    effect(() => {
      const visible = this.state.visibleSection();
      const transfer = visible === 'importexport';
      const exporting = transfer && this.state.transferTab() === 'export';
      this.query.set({
        ssec: visible,
        sdrawer: this.state.drawerRow() !== null && (visible === 'languages' || visible === 'channels') ? '1' : null,
        itab: transfer && !exporting ? this.state.transferTab() : null,
        istep: exporting && this.state.exportStep() !== 'select' ? this.state.exportStep() : null,
      });
    });
  }

  protected async selectSection(id: string): Promise<void> {
    if (await this.state.canLeaveSection()) {
      this.state.open(id as SettingsSection);
    }
  }
}
