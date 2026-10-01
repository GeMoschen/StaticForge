import { Injectable, computed, signal } from '@angular/core';
import { injectSampleDevMode, injectSampleNotice, injectSampleText } from '../changes/sample-area.util';
import {
  CHANNELS,
  DEV_ONLY_SECTIONS,
  EXPORT_STEPS,
  ExportStep,
  GENERAL,
  GeneralForm,
  LANGUAGES,
  SettingsChannel,
  SettingsLanguage,
  SettingsSection,
  TransferTab,
} from './settings-data';

/**
 * State of the sample's Settings area, provided by {@link SampleSettingsAreaComponent} and shared by its sub-pages:
 * the open section, drawer, import/export tab and step (mirrored in the query parameters by the area), developer mode,
 * the texts, and each page's saved values and draft. Drafts live here, so switching sections keeps unsaved edits; Save
 * only moves the draft into the saved values (nothing leaves the browser).
 */
@Injectable()
export class SettingsState {
  readonly section = signal<SettingsSection>('general');
  /** The Languages or Channels drawer opens for this row once (`sdrawer=1`: the first row). */
  readonly drawerRow = signal<string | null>(null);
  readonly transferTab = signal<TransferTab>('export');
  readonly exportStep = signal<ExportStep>('select');

  readonly devMode = injectSampleDevMode();
  /** A `styleguide.sample.settings.*` text. */
  readonly t = injectSampleText('styleguide.sample.settings');
  private readonly toast = injectSampleNotice();

  /** The section shown: a developer-only section falls back to General when developer mode is off. */
  readonly visibleSection = computed<SettingsSection>(() => {
    const section = this.section();
    return !this.devMode() && DEV_ONLY_SECTIONS.includes(section) ? 'general' : section;
  });

  // ── Page values: saved and draft ───────────────────────────────────────────
  readonly general = signal<GeneralForm>(GENERAL);
  readonly generalSaved = signal<GeneralForm>(GENERAL);
  readonly generalDirty = computed(() => {
    const a = this.general();
    const b = this.generalSaved();
    return a.name !== b.name || a.description !== b.description || a.defaultEditingLanguage !== b.defaultEditingLanguage;
  });

  readonly languages = signal<readonly SettingsLanguage[]>(LANGUAGES);
  readonly languagesSaved = signal<readonly SettingsLanguage[]>(LANGUAGES);
  readonly languagesDirty = computed(() => this.languages() !== this.languagesSaved());

  readonly channels = signal<readonly SettingsChannel[]>(CHANNELS);
  readonly channelsSaved = signal<readonly SettingsChannel[]>(CHANNELS);
  readonly channelsDirty = computed(() => this.channels() !== this.channelsSaved());

  /** Every action that would change something says so instead. */
  notice(key = 'notice', params?: Record<string, unknown>): void {
    this.toast(this.t(key, params));
  }

  open(section: SettingsSection): void {
    this.section.set(section);
    this.drawerRow.set(null);
  }

  stepIndex(step: ExportStep): number {
    return EXPORT_STEPS.indexOf(step);
  }
}
