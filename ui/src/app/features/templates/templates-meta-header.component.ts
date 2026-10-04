import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { saveStateOf } from '../../core/editor/editor-state';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfCopyableComponent } from '../../shared/components/display/sf-copyable.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfSaveStatusComponent } from '../../shared/components/layout/sf-save-status.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfAssetFavoriteComponent } from '../../shared/components/sf-asset-favorite.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { TemplatesSaveCoordinator } from './templates-save.coordinator';
import { TEMPLATE_ICONS } from './templates-tree.util';
import { TemplatesStore } from './templates.store';

/**
 * The template's header (M35.21 B, gate round 13), built like the page editor's: the name as the `h1` with its favorite
 * star and the kind badge, the inheritance chain as a breadcrumb above it, the save status (or why the template is
 * read-only), the primary **Save** (enabled when something changed, `Ctrl+S`) and the template's ⋮ — Duplicate, Rename…,
 * Move to…, Used by, Delete. The UID sits under it with a copy button (the Templates area is a developer area, so it is
 * always shown). Rename, move and copy are the area's dialogs: the ⋮ only asks for them through the store.
 */
@Component({
  selector: 'sf-template-meta-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfAssetFavoriteComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfCopyableComponent,
    SfIconComponent,
    SfPageHeaderComponent,
    SfSaveStatusComponent,
    TranslocoPipe,
  ],
  templateUrl: './templates-meta-header.component.html',
  styleUrl: './templates-meta-header.component.scss',
})
export class TemplateMetaHeaderComponent {
  protected readonly store = inject(TemplatesStore);
  protected readonly save = inject(TemplatesSaveCoordinator);
  private readonly transloco = inject(TranslocoService);
  private readonly timeTravel = inject(TimeTravelStore);

  protected readonly title = computed(() => {
    const d = this.store.detail();
    return d?.displayName || d?.uid || this.transloco.translate('templates.header.untitled');
  });

  protected readonly kind = computed(() => this.store.kind());
  protected readonly kindIcon = computed(() => TEMPLATE_ICONS[this.kind()]);
  protected readonly favoriteType = computed(() => this.store.detail()?.assetType ?? this.store.activeTemplateKind());

  /** The save status (M35.13): the same words and look in every editor. */
  protected readonly saveState = computed(() => saveStateOf({ dirty: this.save.dirty, saving: this.save.saving, error: this.save.error }));

  /** Why the template cannot be edited; the save status is for a template that can. */
  protected readonly readOnlyLabel = computed(() => {
    if (this.timeTravel.isTimeTravel()) {
      return this.transloco.translate('templates.readOnly.revision', { revision: this.timeTravel.activeRevision() ?? '—' });
    }
    return this.store.readOnly() ? this.transloco.translate('templates.readOnly.archived') : '';
  });

  /** The chain, root first, ending at this template: the ancestors link to their template. */
  protected readonly chain = computed(() => this.store.breadcrumb());

  protected readonly moreActions = computed<SfMenuItem[]>(() => {
    const t = (key: string) => this.transloco.translate(`templates.menu.${key}`);
    const locked = this.store.readOnly();
    return [
      { id: 'duplicate', label: t('duplicate'), icon: 'content_copy', disabled: locked },
      { id: 'rename', label: t('rename'), icon: 'edit', shortcut: 'F2', disabled: locked },
      { id: 'move', label: t('move'), icon: 'drive_file_move', disabled: locked },
      { id: 'usedBy', label: t('usedBy'), icon: 'link', separatorBefore: true },
      { id: 'delete', label: this.transloco.translate('templates.header.delete'), icon: 'delete', danger: true, disabled: locked, separatorBefore: true },
    ];
  });

  protected onMore(item: SfMenuItem): void {
    const uuid = this.store.detail()?.uuid ?? this.store.selectedUuid();
    if (!uuid) {
      return;
    }
    switch (item.id) {
      case 'duplicate':
      case 'rename':
      case 'move':
        this.store.itemRequest.set({ action: item.id, uuid });
        break;
      case 'usedBy':
        this.store.usedByUuid.set(uuid);
        break;
      case 'delete':
        void this.save.requestDelete();
        break;
    }
  }
}
