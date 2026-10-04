import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { LocalesStore } from '../../core/project/locales.store';
import { SfInputComponent } from '../../shared/components/forms/sf-input.component';
import type { SfFinding } from '../../shared/components/forms/sf-finding.component';
import { sfUniqueId } from '../../shared/components/forms/sf-field-context';
import { SfSwitchComponent } from '../../shared/components/forms/sf-switch.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfMenuComponent } from '../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent, SfFieldErrorDirective } from '../../shared/components/sf-field.component';
import { outputPathMessages, LOCALE_PLACEHOLDER } from './output-path.util';
import { DEFAULT_PAGINATION_PATH } from './pagination-path.util';
import { TemplatesEditing } from './templates-editing';
import { TemplatesStore } from './templates.store';

/**
 * The collapsible **Settings** section of the template (M35.21 B, gate round 13, decisions 158, 159, 163): display name,
 * category, *Abstract* (page templates; refused inline while pages use the template) or *Deprecated* (section templates),
 * the output path and the pagination path per channel, and the channels (a ✕ takes one off until the next save, *Add
 * channel* brings one of the project's channels in). Collapsed it shows the output paths as a one-line summary.
 *
 * The output path is checked while typing: a project with more than one language needs `{locale}` in it. The server's
 * warning (SF-GEN-0112) about the saved path stays the authority; the two never show as two messages for a channel.
 */
@Component({
  selector: 'sf-template-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    SfButtonComponent,
    SfFieldComponent,
    SfFieldErrorDirective,
    SfInputComponent,
    SfMenuComponent,
    SfSwitchComponent,
    TranslocoPipe,
  ],
  templateUrl: './templates-settings.component.html',
  styleUrl: './templates-settings.component.scss',
})
export class TemplateSettingsComponent {
  protected readonly store = inject(TemplatesStore);
  private readonly editing = inject(TemplatesEditing);
  private readonly locales = inject(LocalesStore);
  private readonly transloco = inject(TranslocoService);

  protected readonly settingsId = sfUniqueId('tpl-settings');
  protected readonly open = signal(false);
  protected readonly defaultPaginationPath = DEFAULT_PAGINATION_PATH;
  protected readonly localePlaceholder = LOCALE_PLACEHOLDER;
  /** The placeholders of a pagination path, passed as parameters (braces cannot stand in a message). */
  protected readonly placeholders = {
    pageNumber: '{pageNumber}',
    pagePath: '{pagePath}',
    folder: '{folder}',
    uid: '{uid}',
    ext: '{ext}',
    example: 'blog.html',
    exampleNext: 'blog-2.html',
  };

  protected readonly languageCount = computed(() => this.locales.locales().length);

  /** The one-line summary of a collapsed section: the output paths (page templates), else the channels. */
  protected readonly summary = computed(() => {
    const keys = this.store.channelKeys();
    if (!this.store.isSection()) {
      const paths = this.store.outputPaths();
      const shown = keys.filter((key) => paths[key]?.trim()).map((key) => (keys.length > 1 ? `${key}: ${paths[key].trim()}` : paths[key].trim()));
      if (shown.length > 0) {
        return shown.join('  ·  ');
      }
    }
    return keys.join('  ·  ');
  });

  /** Pages that stop *Abstract* (the server refused the save): shown under the switch, naming them. */
  protected readonly inUse = this.store.templateInUse;

  protected readonly addChannelItems = computed<SfMenuItem[]>(() =>
    this.store.availableChannels().map((channel) => ({
      id: channel.key ?? '',
      label: channel.name ?? channel.key ?? '',
      icon: 'add',
      action: () => this.editing.addChannel(channel.key ?? ''),
    })),
  );

  constructor() {
    // Whatever needs attention is not hidden behind a collapsed section.
    effect(() => {
      if (this.store.templateInUse() || Object.keys(this.store.paginationPathErrors()).length > 0) {
        untracked(() => this.open.set(true));
      }
    });
  }

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected setDisplayName(value: string | null): void {
    this.store.displayName.set(value ?? '');
  }

  protected setCategory(value: string | null): void {
    this.store.category.set(value ?? '');
  }

  protected setDeprecated(value: boolean): void {
    this.store.deprecated.set(value);
  }

  protected setAbstract(value: boolean): void {
    this.store.abstractTemplate.set(value);
    this.store.templateInUse.set(null);
  }

  protected outputPathOf(channel: string): string {
    return this.store.outputPaths()[channel] ?? '';
  }

  protected paginationPathOf(channel: string): string {
    return this.store.paginationPaths()[channel] ?? '';
  }

  protected setOutputPath(channel: string, value: string | null): void {
    this.store.outputPaths.update((paths) => ({ ...paths, [channel]: value ?? '' }));
  }

  protected setPaginationPath(channel: string, value: string | null): void {
    this.store.paginationPaths.update((paths) => ({ ...paths, [channel]: value ?? '' }));
  }

  protected removeChannel(channel: string): void {
    this.editing.removeChannel(channel);
  }

  protected restoreChannel(channel: string): void {
    this.editing.restoreChannel(channel);
  }

  /** One message per channel under its output path: the client check while typing, or the server's warning (never both). */
  protected outputPathFindings(channel: string): SfFinding[] {
    const messages = outputPathMessages({
      path: this.store.outputPaths()[channel] ?? '',
      savedPath: this.store.savedOutputPaths()[channel] ?? '',
      languageCount: this.languageCount(),
      server: this.store.outputPathWarningsOf(channel),
      clientMessage: this.transloco.translate('templates.settings.outputPathLocale', {
        count: this.languageCount(),
        placeholder: LOCALE_PLACEHOLDER,
      }),
    });
    return messages.map((message) => ({ level: 'warning', message }));
  }
}
