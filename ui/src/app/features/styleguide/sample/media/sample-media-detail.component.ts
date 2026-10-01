import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToastService } from '../../../../core/ui/toast.service';
import { CodeFormat } from '../../../../shared/code-editor/code-format';
import { SfCodePanelComponent } from '../../../../shared/code-editor/sf-code-panel.component';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { SfDrawerComponent, SfDrawerFooterDirective } from '../../../../shared/components/dialog/sf-drawer.component';
import { SfAvatarComponent } from '../../../../shared/components/display/sf-avatar.component';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfSwitchComponent } from '../../../../shared/components/forms/sf-switch.component';
import { SfMenuComponent, SfMenuItem } from '../../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SfTab, SfTabsComponent } from '../../../../shared/components/sf-tabs.component';
import { SfFileSizePipe } from '../../../../shared/pipes/sf-file-size.pipe';
import { LANGUAGE_NAMES, SAMPLE_LANGS, SampleLang } from '../sample-data';
import { STATUS_ICONS, STATUS_TONES } from '../sample-state';
import {
  CSS_DIAGNOSTICS,
  SVG_DIAGNOSTICS,
  SampleMediaFile,
  SampleMediaVersion,
  renderedSource,
  variantsOf,
} from './sample-media-data';
import { SampleMediaDetailsTabComponent } from './sample-media-details-tab.component';
import { SampleMediaState, SampleMediaTab } from './sample-media-state';

/** One row of the Languages tab. */
interface LanguageRow {
  readonly lang: SampleLang;
  readonly name: string;
  readonly isDefault: boolean;
  /** The language's own file; `null` = it uses the default language's file. */
  readonly fileName: string | null;
  readonly sizeBytes: number;
  readonly art: string | null;
}

const DEFAULT_LANG: SampleLang = 'de';
const CODE_FORMATS: Readonly<Record<string, CodeFormat>> = { CSS: 'CSS', SVG: 'XML' };
/** The code panel's language names (technical names, not translated). */
const LANGUAGE_LABELS: Readonly<Record<string, string>> = { CSS: 'CSS', SVG: 'SVG · XML' };

/**
 * The media detail (decisions 20, 21): a non-modal, resizable `sf-drawer` over the library's right side. The header
 * names the file and holds its status, previous/next and a ⋮ menu (Replace, Download, Copy link, Delete); ←/→ while
 * focus is in the header step through the library, Escape closes. Below, `sf-tabs` with every tab that applies to
 * the file: Details, Variants (images), Languages, Processing / Rendered / Source (text media), Used by, Versions.
 */
@Component({
  selector: 'sf-sample-media-detail',
  standalone: true,
  imports: [
    SampleMediaDetailsTabComponent,
    SfAvatarComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfCodePanelComponent,
    SfDrawerComponent,
    SfDrawerFooterDirective,
    SfEmptyStateComponent,
    SfFileSizePipe,
    SfIconComponent,
    SfMenuComponent,
    SfRelativeTimeComponent,
    SfStatusComponent,
    SfSwitchComponent,
    SfTabsComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-media-detail.component.html',
  styleUrl: './sample-media-detail.component.scss',
})
export class SampleMediaDetailComponent {
  protected readonly state = inject(SampleMediaState);
  protected readonly sample = this.state.sample;
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);

  protected readonly tones = STATUS_TONES;
  protected readonly icons = STATUS_ICONS;
  protected readonly tabsId = 'sample-media-tab';
  private readonly now = Date.now();

  protected readonly file = computed(() => this.state.asset()!);

  protected readonly tabs = computed<SfTab[]>(() => {
    const file = this.file();
    const dirty = { details: this.state.detailsDirty(), source: this.state.sourceDirty() } as Partial<Record<SampleMediaTab, boolean>>;
    return this.state.tabs().map((id) => ({
      id,
      label: this.state.t(`tabs.${id}`),
      dirty: dirty[id] ?? false,
      note: id === 'usedby' ? String(file.usages.length) : undefined,
    }));
  });

  /** "JPG · 4000 × 2667 · 1.2 MB". */
  protected readonly meta = computed(() => {
    const file = this.file();
    const size = new SfFileSizePipe().transform(file.sizeBytes);
    const dims = file.width && file.height ? `${file.width} × ${file.height}` : null;
    return [file.format, dims, size].filter(Boolean).join(' · ');
  });

  protected readonly positionText = computed(() => {
    const { index, count } = this.state.position();
    return index < 0 ? '' : this.state.t('detail.position', { index: index + 1, count });
  });

  protected readonly fileActions = computed<SfMenuItem[]>(() => [
    { id: 'replace', label: this.state.t('detail.replace'), icon: 'swap_horiz', action: () => this.replace() },
    { id: 'download', label: this.state.t('detail.download'), icon: 'download', action: () => this.state.download([this.file()]) },
    { id: 'copyLink', label: this.state.t('detail.copyLink'), icon: 'link', action: () => this.copyLink() },
    {
      id: 'delete',
      label: this.state.t('detail.delete'),
      icon: 'delete',
      danger: true,
      separatorBefore: true,
      action: () => void this.state.confirmDelete([this.file()]),
    },
  ]);

  // ── Tabs ───────────────────────────────────────────────────────────────────

  protected readonly variants = computed(() => variantsOf(this.file()));

  protected readonly languages = computed<LanguageRow[]>(() => {
    const file = this.file();
    return SAMPLE_LANGS.map((lang) => {
      const own = file.localized?.[lang];
      const isDefault = lang === DEFAULT_LANG;
      return {
        lang,
        name: LANGUAGE_NAMES[lang],
        isDefault,
        fileName: own?.fileName ?? (isDefault ? file.name : null),
        sizeBytes: own?.sizeBytes ?? file.sizeBytes,
        art: own?.art ?? (isDefault ? file.art : null),
      };
    });
  });

  protected readonly diagnostics = computed(() => (this.file().format === 'CSS' ? CSS_DIAGNOSTICS : SVG_DIAGNOSTICS));
  /** The last processing attempt's findings: only when the file is processed. */
  protected readonly processDiagnostics = computed(() => (this.state.assetProcessed() && this.file().format === 'CSS' ? CSS_DIAGNOSTICS : []));
  protected readonly codeFormat = computed<CodeFormat>(() => CODE_FORMATS[this.file().format] ?? 'PLAIN');
  protected readonly languageLabel = computed(() => LANGUAGE_LABELS[this.file().format] ?? this.file().format);
  protected readonly rendered = computed(() => renderedSource(this.file()));
  protected readonly source = computed(() => this.state.sourceDraft() ?? this.file().source ?? '');
  protected readonly dirty = computed(() => this.state.detailsDirty() || this.state.sourceDirty());

  protected selectTab(id: string): void {
    this.state.tab.set(id as SampleMediaTab);
  }

  protected minutesAgo(minutes: number): number {
    return this.now - minutes * 60_000;
  }

  /** ←/→ while focus is in the drawer's header step to the previous/next file. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.sf-drawer__header') || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    event.preventDefault();
    this.state.step(event.key === 'ArrowLeft' ? -1 : 1);
  }

  protected save(): void {
    if (!this.dirty()) {
      return;
    }
    this.state.save();
    this.toasts.show(this.state.t('detail.saved', { name: this.file().name }), 'success');
  }

  protected revert(): void {
    this.state.edits.set({});
    this.state.sourceDraft.set(null);
  }

  protected async restore(version: SampleMediaVersion): Promise<void> {
    const confirmed = await this.confirms.confirm({
      title: this.state.t('versions.restoreTitle', { version: version.version }),
      message: this.state.t('versions.restoreMessage', { name: this.file().name }),
      confirmLabel: this.state.t('versions.restoreConfirm'),
    });
    if (confirmed) {
      this.toasts.show(this.state.t('versions.restored', { version: version.version }), 'success');
    }
  }

  protected languageAction(row: LanguageRow, action: 'replace' | 'remove' | 'upload'): void {
    this.state.notice(`media.languages.${action}Notice`, { language: row.name });
  }

  protected openUsage(event: Event): void {
    event.preventDefault();
    this.state.notice('media.usedBy.openNotice');
  }

  private replace(): void {
    this.state.tab.set('details');
    this.state.replaceRequest.set(true);
  }

  private copyLink(): void {
    const url = `https://lumen-coffee.example/media/${this.file().name}`;
    void navigator.clipboard?.writeText(url).catch(() => undefined);
    this.toasts.show(this.state.t('detail.linkCopied'), 'success');
  }

  protected isCurrent(file: SampleMediaFile, version: SampleMediaVersion): boolean {
    return version.version === file.versions[0]?.version;
  }
}
