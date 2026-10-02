import { Injectable, computed, inject, signal } from '@angular/core';
import { UnsavedChangesService, type SaveResult } from '../../../../shared/components/dialog/unsaved-changes.service';
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
  /** Why the last General save was refused (the name is required); cleared by the next edit or a good save. */
  readonly generalError = signal<string | null>(null);
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

  private readonly unsaved = inject(UnsavedChangesService);

  /** Whether a section has unsaved changes. */
  dirtyOf(section: SettingsSection): boolean {
    switch (section) {
      case 'general':
        return this.generalDirty();
      case 'languages':
        return this.languagesDirty();
      case 'channels':
        return this.channelsDirty();
      default:
        return false;
    }
  }

  /** Saves a section's draft: General needs a name; the others always succeed. */
  saveSection(section: SettingsSection): SaveResult {
    if (section === 'general') {
      if (this.general().name.trim() === '') {
        this.generalError.set(this.t('general.nameRequired'));
        return { ok: false, message: this.t('general.nameRequired') };
      }
      this.generalError.set(null);
      this.generalSaved.set(this.general());
    } else if (section === 'languages') {
      this.languagesSaved.set(this.languages());
    } else if (section === 'channels') {
      this.channelsSaved.set(this.channels());
    }
    return { ok: true };
  }

  /** Throws the draft of a section away. */
  discardSection(section: SettingsSection): void {
    if (section === 'general') {
      this.general.set(this.generalSaved());
      this.generalError.set(null);
    } else if (section === 'languages') {
      this.languages.set(this.languagesSaved());
    } else if (section === 'channels') {
      this.channels.set(this.channelsSaved());
    }
  }

  /** Whether the open section may be left: it has no unsaved changes, or the person saved or discarded them. */
  async canLeaveSection(): Promise<boolean> {
    const section = this.visibleSection();
    if (!this.dirtyOf(section)) {
      return true;
    }
    return this.unsaved.confirmLeave({
      name: `${this.t('title')} › ${this.t(`sections.${section}`)}`,
      save: async () => this.saveSection(section),
      discard: () => this.discardSection(section),
    });
  }

  open(section: SettingsSection): void {
    this.section.set(section);
    this.drawerRow.set(null);
  }

  stepIndex(step: ExportStep): number {
    return EXPORT_STEPS.indexOf(step);
  }
}
