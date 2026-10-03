import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfSwitchComponent } from '../../../shared/components/forms/sf-switch.component';
import { SfBannerComponent } from '../../../shared/components/layout/sf-banner.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfFileSizePipe } from '../../../shared/pipes/sf-file-size.pipe';
import { isTransparent } from '../library/media-library.util';
import type { LocaleFileRow } from '../media-locale-files.util';
import { MediaDrawerFilesStore } from './media-drawer-files.store';
import { MediaDrawerStore } from './media-drawer.store';

/**
 * The Languages tab (decision 21): "Different file per language" and, for localized media, one row per language: its
 * thumbnail, the file it renders (or the language it falls back to), Replace / Upload and Remove. A file can be
 * dropped on a row too. Turning the setting off while other languages have their own file asks first (409
 * SF-MEDIA-0505): the banner lists what would be discarded.
 */
@Component({
  selector: 'sf-media-drawer-localization',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfBadgeComponent, SfBannerComponent, SfButtonComponent, SfFileSizePipe, SfIconComponent, SfSwitchComponent, TranslocoPipe],
  templateUrl: './media-drawer-localization.component.html',
  styleUrl: './media-drawer-localization.component.scss',
})
export class MediaDrawerLocalizationComponent {
  protected readonly core = inject(MediaDrawerStore);
  protected readonly files = inject(MediaDrawerFilesStore);
  private readonly transloco = inject(TranslocoService);

  private readonly picker = viewChild.required<ElementRef<HTMLInputElement>>('picker');
  private readonly toggle = viewChild(SfSwitchComponent);
  private pickFor: string | null = null;

  protected checker(): boolean {
    return isTransparent(this.core.media().mimeType);
  }

  /** The label of the language a row falls back to ("German (DE)"). */
  protected fallbackOf(row: LocaleFileRow): string | null {
    if (row.own || !row.fromLocale) {
      return null;
    }
    const language = this.core.locales.locales().find((locale) => locale.code === row.fromLocale);
    return language?.label ?? row.fromLocale;
  }

  protected async onSwitch(wanted: boolean): Promise<void> {
    // Putting the switch back (below) reports a change too; it is the server's state already.
    if (wanted === this.core.localized()) {
      return;
    }
    await this.files.setLocalized(wanted);
    // The switch shows what the server says: a refused change (or the discard question) puts it back.
    this.toggle()?.value.set(this.core.localized());
  }

  protected async confirmUnlocalize(): Promise<void> {
    await this.files.confirmUnlocalize();
    this.toggle()?.value.set(this.core.localized());
  }

  protected choose(row: LocaleFileRow): void {
    this.pickFor = row.locale;
    this.picker().nativeElement.click();
  }

  protected onPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const locale = this.pickFor;
    input.value = '';
    this.pickFor = null;
    if (file && locale) {
      void this.files.uploadLocaleFile(locale, file);
    }
  }

  protected rowLabel(key: string, row: LocaleFileRow): string {
    return this.transloco.translate(`media.drawer.languages.${key}`, { language: row.label });
  }
}
