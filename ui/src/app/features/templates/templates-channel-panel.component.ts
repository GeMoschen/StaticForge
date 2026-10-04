import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SfCodePanelComponent } from '../../shared/code-editor/sf-code-panel.component';
import { sfUniqueId } from '../../shared/components/forms/sf-field-context';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfMenuComponent } from '../../shared/components/menu/sf-menu.component';
import { panelIdOf, SfTabsComponent, tabIdOf } from '../../shared/components/sf-tabs.component';
import { TemplatesEditing } from './templates-editing';
import { TemplatesStore } from './templates.store';

/**
 * The channel templates (OCTL) of the open template (M35.21 B): one tab per channel with its error count and unsaved dot,
 * each source in an `sf-code-panel` (header strip with *Find*, problems with jump to line, status line; the format of the
 * text between the instructions names the language). One editor per channel stays alive while another shows, so its undo
 * history never crosses channels. Adding and removing channels is in *Settings*; a template without a channel offers
 * *Add channel* here too.
 */
@Component({
  selector: 'sf-template-channel-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfCodePanelComponent, SfMenuComponent, SfTabsComponent, TranslocoPipe],
  templateUrl: './templates-channel-panel.component.html',
  styleUrl: './templates-channel-panel.component.scss',
})
export class TemplateChannelPanelComponent {
  protected readonly store = inject(TemplatesStore);
  protected readonly editing = inject(TemplatesEditing);
  private readonly transloco = inject(TranslocoService);

  protected readonly idPrefix = sfUniqueId('tpl-channel');

  protected readonly addChannelItems = computed<SfMenuItem[]>(() =>
    this.store.availableChannels().map((channel) => ({
      id: channel.key ?? '',
      label: channel.name ?? channel.key ?? '',
      icon: 'add',
      action: () => this.editing.addChannel(channel.key ?? ''),
    })),
  );

  protected tabId(key: string): string {
    return tabIdOf(this.idPrefix, key);
  }

  protected panelId(key: string): string {
    return panelIdOf(this.idPrefix, key);
  }

  protected languageLabel(key: string): string {
    return `OCTL · ${this.store.channelFormats()[key]?.format ?? 'PLAIN'}`;
  }

  protected labelOf(key: string): string {
    return this.transloco.translate('templates.channels.editorLabel', {
      name: this.store.detail()?.displayName || this.store.detail()?.uid || '',
      channel: key,
    });
  }
}
