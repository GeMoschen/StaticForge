import { ChangeDetectionStrategy, Component, afterNextRender, computed, effect, inject, untracked, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfMenuComponent, SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import { SfTreeAction, SfTreeComponent, SfTreeDeleteRequest } from '../../../shared/components/sf-tree.component';
import { SfTreeLoader, SfTreeNode } from '../../../shared/components/tree/tree-model';
import { SampleTemplateEntry, SampleTemplateKind, templateChildren, templatePath } from './sample-content-data';
import { FAVORITES_NODE, SampleFavorite, templateFavorite } from './sample-favorites';
import { favoriteChildren, favoriteNodes, favoritesNode, isFavoriteNode } from './sample-favorites-nodes';
import type { ContextMenuItem } from '../../../shared/services/context-menu.service';
import { SampleState } from './sample-state';

export const TEMPLATE_ICONS: Readonly<Record<SampleTemplateKind, string>> = {
  folder: 'folder',
  page: 'web',
  section: 'view_agenda',
  dataset: 'dataset',
};

/**
 * The Templates tree (developer mode, M35.21 mocked): page templates, section templates and datasets in folders, with a
 * filter and a New menu that names the kind explicitly. Creating, renaming and deleting only say so.
 */
@Component({
  selector: 'sf-sample-templates-tree',
  standalone: true,
  imports: [SfMenuComponent, SfTreeComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sample-tree' },
  styleUrl: './sample-tree-pane.scss',
  template: `
    <section class="pane" aria-labelledby="sample-templates-title">
      <div class="pane__head">
        <span class="pane__title" id="sample-templates-title">{{ 'styleguide.sample.rail.templates' | transloco }}</span>
        <sf-menu
          variant="secondary"
          size="sm"
          [text]="'styleguide.sample.tree.new' | transloco"
          [label]="'styleguide.sample.templates.newLabel' | transloco"
          [items]="newItems()"
        />
      </div>
      <sf-tree
        class="pane__tree"
        [label]="'styleguide.sample.rail.templates' | transloco"
        [loadChildren]="loader()"
        [selection]="selection()"
        [multiselect]="false"
        [actions]="actions"
        [expandActions]="false"
        [menuItems]="menuItems"
        [allowAction]="allowAction"
        (open)="onOpen($event)"
        (rename)="state.notice()"
        (create)="state.notice()"
        (delete)="onDelete($event)"
      />
    </section>
  `,
})
export class SampleTemplatesTreeComponent {
  protected readonly state = inject(SampleState);
  private readonly tree = viewChild.required<SfTreeComponent<SampleTemplateEntry>>(SfTreeComponent);
  protected readonly actions: readonly SfTreeAction[] = ['rename', 'delete'];
  /** The *Favorites* branch is a view: nothing in it is renamed, deleted or created. */
  protected readonly allowAction = (_action: SfTreeAction, nodes: readonly SfTreeNode<SampleTemplateEntry>[]): boolean =>
    !nodes.some((node) => isFavoriteNode(node.id));

  /** The context menu's *Add to favorites* / *Remove from favorites* for a template, dataset or folder (M35.15). */
  protected readonly menuItems = (nodes: readonly SfTreeNode<SampleTemplateEntry>[]): ContextMenuItem[] => {
    const node = nodes.length === 1 ? nodes[0] : null;
    if (!node || isFavoriteNode(node.id) || !node.data) {
      return [];
    }
    const favorite = templateFavorite(node.data);
    return [
      {
        label: this.state.t(this.state.isFavoriteKey(favorite.key) ? 'favorites.remove' : 'favorites.add'),
        icon: 'star',
        action: () => this.state.toggleFavoriteOf(favorite),
      },
    ];
  };

  protected onOpen(node: SfTreeNode<SampleTemplateEntry>): void {
    if (isFavoriteNode(node.id)) {
      this.state.openFavoriteNode(node.data as unknown as SampleFavorite | undefined);
    } else {
      this.state.openTemplate(node.id);
    }
  }

  protected readonly loader = computed<SfTreeLoader<SampleTemplateEntry>>(() => {
    const dev = this.state.devMode();
    const favorites = this.state.favorites();
    const label = this.state.t('favorites.node');
    return (parent) => {
      if (parent?.id === FAVORITES_NODE) {
        return favoriteNodes<SampleTemplateEntry>(favorites);
      }
      if (parent && isFavoriteNode(parent.id)) {
        return favoriteChildren<SampleTemplateEntry>(parent.id, favorites);
      }
      const nodes = templateChildren(parent?.id ?? null).map(
        (entry): SfTreeNode<SampleTemplateEntry> => ({
          id: entry.id,
          label: entry.name,
          icon: TEMPLATE_ICONS[entry.kind],
          secondary: dev && entry.kind !== 'folder' ? entry.uid : null,
          hasChildren: entry.kind === 'folder',
          droppable: entry.kind === 'folder',
          data: entry,
        }),
      );
      return parent === null && favorites.length > 0 ? [favoritesNode<SampleTemplateEntry>(label), ...nodes] : nodes;
    };
  });

  protected readonly selection = computed(() => {
    if (this.state.favoritesOpen()) {
      return [FAVORITES_NODE];
    }
    const id = this.state.templateId();
    return id === null ? [] : [id];
  });

  protected readonly newItems = computed<SfMenuItem[]>(() => {
    const item = (id: string, icon: string): SfMenuItem => ({
      id,
      icon,
      label: this.state.t(`templates.new.${id}`),
      action: () => this.state.notice(),
    });
    return [item('page', TEMPLATE_ICONS.page), item('section', TEMPLATE_ICONS.section), item('dataset', TEMPLATE_ICONS.dataset), {
      ...item('folder', TEMPLATE_ICONS.folder),
      separatorBefore: true,
    }];
  });

  constructor() {
    let rendered = false;
    afterNextRender(() => {
      rendered = true;
      void this.reveal();
    });
    effect(() => {
      this.state.templateId();
      if (rendered) {
        untracked(() => void this.reveal());
      }
    });
  }

  protected onDelete(request: SfTreeDeleteRequest<SampleTemplateEntry>): void {
    request.completed(() => this.state.notice('folder.restored'));
  }

  private async reveal(): Promise<void> {
    for (const entry of templatePath(this.state.templateId()).filter((e) => e.kind === 'folder')) {
      await this.tree().expand(entry.id);
    }
  }
}
