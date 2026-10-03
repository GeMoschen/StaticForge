import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CODE_FORMAT_LABELS, CodeFormat, extensionOf, resolveCodeFormat } from '../../../../shared/code-editor/code-format';
import { SfCodePanelComponent } from '../../../../shared/code-editor/sf-code-panel.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfBannerComponent } from '../../../../shared/components/layout/sf-banner.component';
import { SfMenuComponent } from '../../../../shared/components/menu/sf-menu.component';
import { SfMenuItem } from '../../../../shared/components/menu/sf-menu-item';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { LANGUAGE_NAMES, SAMPLE_LANGS, SampleLang } from '../sample-data';
import { CSS_DIAGNOSTICS, SVG_DIAGNOSTICS, completionNames, mediaTypeOf } from './sample-media-data';
import { SampleMediaState } from './sample-media-state';

/** The formats the highlight menu offers (decision 104), besides Auto. */
export const HIGHLIGHT_CHOICES: readonly CodeFormat[] = ['CSS', 'JAVASCRIPT', 'JSON', 'XML', 'MARKDOWN', 'PLAIN'];

/**
 * The Source tab of a text file (decisions 102-106), as the app's `MediaDrawerSource` plus what it lacks: the text in
 * the code panel with completion of the project's names (global values, media UIDs, page paths) and, for SVG, of SVG
 * elements and attributes; a "Highlighted as ..." menu in the panel's header that overrides the format for this file
 * type (a project setting); the banners for a file that is too large, not valid UTF-8 or mixes line endings
 * (`banner=large|utf8|eol`); and a Language select for a file with one file per language.
 */
@Component({
  selector: 'sf-sample-media-source',
  standalone: true,
  imports: [SfBannerComponent, SfButtonComponent, SfCodePanelComponent, SfMenuComponent, SfSelectComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-media-source.component.html',
  styleUrl: './sample-media-source.component.scss',
})
export class SampleMediaSourceComponent {
  protected readonly state = inject(SampleMediaState);

  protected readonly file = computed(() => this.state.asset()!);
  protected readonly extension = computed(() => extensionOf(this.file().name) ?? '');
  protected readonly highlight = computed(() => this.state.highlightOf(this.file()));
  protected readonly isLocalized = computed(() => this.state.isLocalized(this.file()));
  /** Names for completion (Ctrl+Space inside an instruction). */
  protected readonly names = completionNames();

  protected readonly languageLabel = computed(() => {
    const { format, svg } = this.highlight();
    return svg ? 'SVG · XML' : CODE_FORMAT_LABELS[format];
  });
  protected readonly source = computed(() => this.state.sourceDraft() ?? this.state.sourceBase());

  /** The findings of the file's type, moved down by the lines the shown language or the damaged text added at the top. */
  protected readonly diagnostics = computed(() => {
    const file = this.file();
    const base = file.format === 'CSS' ? CSS_DIAGNOSTICS : SVG_DIAGNOSTICS;
    const shift = this.state.sourceBase().split('\n').length - (file.source ?? '').split('\n').length;
    return base.map((d) => ({ ...d, line: (d.line ?? 0) + shift }));
  });

  protected readonly languageOptions: readonly SfSelectOption<SampleLang>[] = SAMPLE_LANGS.map((lang) => ({
    value: lang,
    label: `${LANGUAGE_NAMES[lang]} (${lang.toUpperCase()})`,
  }));

  /** The "Highlighted as ..." menu: Auto and the formats, as one project setting for this file type. */
  protected readonly highlightItems = computed<SfMenuItem[]>(() => {
    const file = this.file();
    const type = `.${this.extension()}`;
    const group = this.state.t('source.highlight.group', { type });
    const overridden = this.state.highlightOverrides()[this.extension()] ?? null;
    const detected = resolveCodeFormat({ extension: this.extension(), mimeType: mediaTypeOf(file) });
    const detectedLabel = detected.svg ? 'SVG · XML' : CODE_FORMAT_LABELS[detected.format];
    const choose = (format: CodeFormat | null) => () => {
      this.state.setHighlight(file, format);
      this.state.notice('media.source.highlight.changed', {
        type,
        format: format ? CODE_FORMAT_LABELS[format] : this.state.t('source.highlight.auto'),
      });
    };
    return [
      {
        id: 'auto',
        label: this.state.t('source.highlight.auto'),
        description: this.state.t('source.highlight.detected', { format: detectedLabel }),
        icon: overridden === null ? 'check' : undefined,
        group,
        action: choose(null),
      },
      ...HIGHLIGHT_CHOICES.map<SfMenuItem>((format) => ({
        id: format.toLowerCase(),
        label: CODE_FORMAT_LABELS[format],
        icon: overridden === format ? 'check' : undefined,
        group,
        action: choose(format),
      })),
    ];
  });

  protected pickLanguage(lang: SampleLang | null): void {
    if (lang) {
      void this.state.requestTextLang(lang);
    }
  }

  protected download(): void {
    this.state.download([this.file()]);
  }

  /** "Replace file" of the large-file banner: the Details tab brings its Replace field into view. */
  protected replace(): void {
    this.state.tab.set('details');
    this.state.replaceRequest.set(true);
  }
}
