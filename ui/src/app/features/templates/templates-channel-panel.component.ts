import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfOctlEditorComponent } from '../../shared/components/sf-octl-editor.component';
import { SfTabsComponent } from '../../shared/components/sf-tabs.component';
import { TemplatesEditing } from './templates-editing';
import { TemplatesStore } from './templates.store';

/** The channel templates (OCTL) of the open template: one tab and editor per channel, add, remove and undo. */
@Component({
  selector: 'sf-template-channel-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfOctlEditorComponent, SfTabsComponent],
  templateUrl: './templates-channel-panel.component.html',
  styleUrls: ['./templates-panel.scss', './templates-inheritance.scss', './templates-channel-panel.component.scss'],
})
export class TemplateChannelPanelComponent {
  protected readonly store = inject(TemplatesStore);
  protected readonly editing = inject(TemplatesEditing);

  protected onAddChannel(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const channelKey = select.value;
    select.value = '';
    if (channelKey) {
      this.editing.addChannel(channelKey);
    }
  }
}
