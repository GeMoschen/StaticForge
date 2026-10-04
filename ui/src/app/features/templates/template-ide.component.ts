import { DestroyRef, ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { errorCount } from '../../shared/code-editor/cdl-sections';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { SfSkeletonComponent } from '../../shared/components/layout/sf-skeleton.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfSplitterComponent } from '../../shared/components/splitter/sf-splitter.component';
import { panelIdOf, SfTabsComponent, tabIdOf, type SfTab } from '../../shared/components/sf-tabs.component';
import { SfAssetImpactComponent } from '../generation/insight/sf-asset-impact.component';
import { TemplateCdlPanelComponent } from './templates-cdl-panel.component';
import { TemplateChannelPanelComponent } from './templates-channel-panel.component';
import { TemplatesLoader } from './templates-loader';
import { TemplateMetaHeaderComponent } from './templates-meta-header.component';
import { TemplateSaveOutcomesComponent } from './templates-save-outcomes.component';
import { TemplatesSaveCoordinator } from './templates-save.coordinator';
import { TemplateSettingsComponent } from './templates-settings.component';
import { TemplatesStore } from './templates.store';

/** Two editors side by side from here; below it they stack as tabs (CDL | Channels) so nothing is clipped. */
export const TEMPLATE_WIDE_QUERY = '(min-width: 1280px)';
const STACK_TABS = 'tpl-ide-stack';

/**
 * The template IDE (M35.21 B, gate round 13): the header, the banners, the collapsible Settings and the code — the CDL
 * panel and the channel panel in an `sf-splitter` from 1280 px, as tabs (CDL | Channels, each with its error count)
 * below it. Also the states of the view: nothing selected, loading (a skeleton), a failed read (with Retry), and the
 * question before a save that discards translations (`ConfirmService`; the server's message says how many).
 */
@Component({
  selector: 'sf-template-ide',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfAssetImpactComponent,
    SfButtonComponent,
    SfEmptyStateComponent,
    SfSkeletonComponent,
    SfSplitterComponent,
    SfTabsComponent,
    TemplateCdlPanelComponent,
    TemplateChannelPanelComponent,
    TemplateMetaHeaderComponent,
    TemplateSaveOutcomesComponent,
    TemplateSettingsComponent,
    TranslocoPipe,
  ],
  templateUrl: './template-ide.component.html',
  styleUrl: './template-ide.component.scss',
})
export class TemplateIdeComponent {
  protected readonly store = inject(TemplatesStore);
  protected readonly save = inject(TemplatesSaveCoordinator);
  private readonly loader = inject(TemplatesLoader);
  private readonly confirms = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);

  protected readonly stackTabsId = STACK_TABS;
  protected readonly wide = signal(typeof matchMedia !== 'function' || matchMedia(TEMPLATE_WIDE_QUERY).matches);
  protected readonly stack = signal<'cdl' | 'channels'>('cdl');

  /** CDL | Channels with the errors of each side. */
  protected readonly stackTabs = computed<SfTab[]>(() => [
    { id: 'cdl', label: this.transloco.translate('templates.ide.cdl'), errors: errorCount(this.store.cdlDiagnostics()) },
    {
      id: 'channels',
      label: this.transloco.translate('templates.ide.channels'),
      errors: Object.values(this.store.octlDiagnostics()).reduce((sum, list) => sum + errorCount(list), 0),
    },
  ]);

  constructor() {
    if (typeof matchMedia === 'function') {
      const query = matchMedia(TEMPLATE_WIDE_QUERY);
      const listener = (event: MediaQueryListEvent) => this.wide.set(event.matches);
      query.addEventListener?.('change', listener);
      inject(DestroyRef).onDestroy(() => query.removeEventListener?.('change', listener));
    }

    // "This change discards translations": the server refused and wrote nothing; the person decides.
    effect(() => {
      const message = this.save.pendingDiscard();
      if (message) {
        untracked(() => void this.askDiscard(message));
      }
    });
  }

  private async askDiscard(message: string): Promise<void> {
    const t = (key: string) => this.transloco.translate(`templates.discard.${key}`);
    const confirmed = await this.confirms.confirm({
      title: t('title'),
      message,
      confirmLabel: t('confirm'),
      cancelLabel: t('keep'),
      tone: 'danger',
    });
    if (confirmed) {
      this.save.confirmDiscardAndSave();
    } else {
      this.save.cancelDiscard();
    }
  }

  protected selectStack(id: string): void {
    this.stack.set(id === 'channels' ? 'channels' : 'cdl');
  }

  protected tabId(id: string): string {
    return tabIdOf(STACK_TABS, id);
  }

  protected panelId(id: string): string {
    return panelIdOf(STACK_TABS, id);
  }

  protected retry(): void {
    const key = this.store.projectKey();
    const uuid = this.store.selectedUuid();
    if (key && uuid) {
      this.loader.reloadDetail(key, uuid);
    }
  }
}
