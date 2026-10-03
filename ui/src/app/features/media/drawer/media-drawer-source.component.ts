import { ChangeDetectionStrategy, Component, computed, effect, inject, output, untracked, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { problemOf } from '../../../core/api/problem.util';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { CODE_FORMAT_LABELS, type CodeFormat, extensionOf, resolveCodeFormat } from '../../../shared/code-editor/code-format';
import { SfCodePanelComponent } from '../../../shared/code-editor/sf-code-panel.component';
import { SfSelectComponent, type SfSelectOption } from '../../../shared/components/forms/sf-select.component';
import { SfBannerComponent } from '../../../shared/components/layout/sf-banner.component';
import { SfSkeletonComponent } from '../../../shared/components/layout/sf-skeleton.component';
import { SfMenuComponent } from '../../../shared/components/menu/sf-menu.component';
import type { SfMenuItem } from '../../../shared/components/menu/sf-menu-item';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { resolveHighlight } from './media-drawer-highlight';
import { MediaDrawerNamesStore } from './media-drawer-names.store';
import { MediaDrawerPreviewStore } from './media-drawer-preview.store';
import { MediaDrawerTextStore } from './media-drawer-text.store';
import { MediaDrawerStore } from './media-drawer.store';

/** The formats the highlight menu offers (decision 104), besides Auto. */
export const HIGHLIGHT_CHOICES: readonly CodeFormat[] = ['CSS', 'JAVASCRIPT', 'JSON', 'XML', 'MARKDOWN', 'PLAIN'];

/** What the Source tab warns about instead of (or above) the editor. */
export type SourceBanner = 'large' | 'utf8' | 'eol';

/**
 * The Source tab of a text file (decisions 102-106): the text in the code panel with completion of the project's names
 * (global values, media UIDs, pages) and, for SVG, of SVG elements and attributes; a "Highlighted as ..." menu in the
 * panel's header that overrides the format for this file type (the project's `codeHighlighting` by extension, which
 * needs the project admin's rights); the banners for a file that is too large, not valid UTF-8 or mixes line endings;
 * and a Language select for a file with one file per language. Saving is the drawer's footer.
 */
@Component({
  selector: 'sf-media-drawer-source',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfBannerComponent,
    SfButtonComponent,
    SfCodePanelComponent,
    SfMenuComponent,
    SfSelectComponent,
    SfSkeletonComponent,
    TranslocoPipe,
  ],
  templateUrl: './media-drawer-source.component.html',
  styleUrl: './media-drawer-source.component.scss',
})
export class MediaDrawerSourceComponent {
  /** "Replace file" of the large-file banner: the drawer brings the Details tab's Replace field into view. */
  readonly replaceRequested = output<void>();

  protected readonly core = inject(MediaDrawerStore);
  protected readonly text = inject(MediaDrawerTextStore);
  private readonly preview = inject(MediaDrawerPreviewStore);
  private readonly namesStore = inject(MediaDrawerNamesStore);
  private readonly project = inject(ProjectContextStore);
  protected readonly names = this.namesStore.names;

  private readonly languageSelect = viewChild(SfSelectComponent);

  protected readonly media = this.core.media;
  protected readonly extension = computed(() => extensionOf(this.media().fileName) ?? '');
  protected readonly highlight = computed(() => resolveHighlight(this.media(), this.project.project()?.codeHighlighting));
  protected readonly isLocalized = computed(() => this.core.localized() && this.core.showLocalization());
  protected readonly banner = computed<SourceBanner | null>(() => {
    if (this.text.tooLarge()) {
      return 'large';
    }
    return !this.text.sourceUtf8() ? 'utf8' : null;
  });
  protected readonly mixedEndings = computed(() => this.text.lineEnding() === 'MIXED');

  protected readonly languageLabel = computed(() => {
    const { format, svg } = this.highlight();
    return svg ? 'SVG · XML' : CODE_FORMAT_LABELS[format];
  });

  protected readonly languageOptions = computed<SfSelectOption<string>[]>(() =>
    this.core.locales.locales().map((locale) => ({
      value: locale.code ?? '',
      label: `${locale.label ?? locale.code} (${(locale.code ?? '').toUpperCase()})`,
    })),
  );

  /** The "Highlighted as ..." menu: Auto and the formats, as one project setting for this file type. */
  protected readonly highlightItems = computed<SfMenuItem[]>(() => {
    const type = `.${this.extension()}`;
    const group = this.core.t('source.highlight.group', { type });
    const overridden = this.project.project()?.codeHighlighting?.extensions?.[this.extension()] ?? null;
    const detected = resolveCodeFormat({ extension: this.extension(), mimeType: this.media().mimeType });
    const detectedLabel = detected.svg ? 'SVG · XML' : CODE_FORMAT_LABELS[detected.format];
    const reason = !this.core.permissions.canAdminProject()
      ? this.core.t('source.highlight.noRights')
      : !this.extension()
        ? this.core.t('source.highlight.noExtension')
        : undefined;
    const known = (format: string | null) => (HIGHLIGHT_CHOICES as readonly string[]).includes(format ?? '') ? (format as CodeFormat) : null;
    const current = known(overridden);
    return [
      {
        id: 'auto',
        label: this.core.t('source.highlight.auto'),
        description: this.core.t('source.highlight.detected', { format: detectedLabel }),
        icon: current === null ? 'check' : undefined,
        group,
        disabledReason: reason,
        action: () => void this.setHighlight(null),
      },
      ...HIGHLIGHT_CHOICES.map<SfMenuItem>((format) => ({
        id: format.toLowerCase(),
        label: CODE_FORMAT_LABELS[format],
        icon: current === format ? 'check' : undefined,
        group,
        disabledReason: reason,
        action: () => void this.setHighlight(format),
      })),
    ];
  });

  constructor() {
    // The names the completion offers are read when the tab is first shown.
    effect(() => {
      this.core.projectKey();
      untracked(() => this.namesStore.load());
    });
  }

  /** Writes the project's highlighting override for this file type (`PUT code-highlighting`); `null` is Auto. */
  private async setHighlight(format: CodeFormat | null): Promise<void> {
    const extension = this.extension();
    const current = this.project.project()?.codeHighlighting;
    if (!extension || !this.core.permissions.canAdminProject()) {
      return;
    }
    const extensions = { ...(current?.extensions ?? {}) };
    if (format) {
      extensions[extension] = format;
    } else {
      delete extensions[extension];
    }
    try {
      const updated = await firstValueFrom(
        this.core.api.updateCodeHighlighting(this.core.projectKey(), { extensions, mimeTypes: { ...(current?.mimeTypes ?? {}) } }),
      );
      this.project.project.set(updated);
      this.core.toasts.show(
        this.core.t('source.highlight.changed', {
          type: `.${extension}`,
          format: format ? CODE_FORMAT_LABELS[format] : this.core.t('source.highlight.auto'),
        }),
        'success',
      );
    } catch (error) {
      this.core.toasts.show(problemOf(error, this.core.t('source.highlight.failed')).detail, 'error');
    }
  }

  protected async pickLanguage(locale: string | null): Promise<void> {
    if (locale) {
      await this.text.pickTextLocale(locale);
    }
    // A refused switch (the leave dialog was cancelled) puts the select back.
    (this.languageSelect() as SfSelectComponent<string | null> | undefined)?.value.set(this.text.textLocale());
  }

  protected download(): void {
    this.preview.downloadVariant();
  }
}
