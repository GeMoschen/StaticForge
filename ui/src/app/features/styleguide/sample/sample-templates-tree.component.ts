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

/** The kinds a template dialog creates, in the order the *New* menus list them. */
const NEW_KINDS = ['page', 'section', 'dataset'] as const;

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
        [confirmDelete]="confirmDelete"
        (open)="onOpen($event)"
        (rename)="state.notice()"
        (create)="state.notice()"
        (delete)="onDelete($event)"
        (moveTo)="onMoveTo($event)"
      />
    </section>
  `,
})
export class SampleTemplatesTreeComponent {
  protected readonly state = inject(SampleState);
  private readonly tree = viewChild.required<SfTreeComponent<SampleTemplateEntry>>(SfTreeComponent);
  protected readonly actions: readonly SfTreeAction[] = ['rename', 'delete', 'move'];
  /** The *Favorites* branch is a view: nothing in it is renamed, deleted or created. */
  protected readonly allowAction = (_action: SfTreeAction, nodes: readonly SfTreeNode<SampleTemplateEntry>[]): boolean =>
    !nodes.some((node) => isFavoriteNode(node.id));

  /**
   * The context menu between the tree's own entries and *Delete* (gate round 13): *New ▸* with the kind named in every entry
   * (in a folder), *Duplicate* (a template or dataset), *Rename…*, *Used by* (not a folder) and *Add to / Remove from
   * favorites* (M35.15). *Move to…* and *Delete* are the tree's own.
   */
  protected readonly menuItems = (nodes: readonly SfTreeNode<SampleTemplateEntry>[]): ContextMenuItem[] => {
    const node = nodes.length === 1 ? nodes[0] : null;
    if (!node || isFavoriteNode(node.id) || !node.data) {
      return [];
    }
    const entry = node.data;
    const favorite = templateFavorite(entry);
    const items: ContextMenuItem[] = [];
    if (entry.kind === 'folder') {
      items.push({
        label: this.state.t('templateActions.new'),
        icon: 'add',
        children: NEW_KINDS.map((kind) => ({
          label: this.state.t(`templates.new.${kind}`),
          icon: TEMPLATE_ICONS[kind],
          action: () => void this.state.newTemplate(entry.id, kind),
        })),
      });
    } else {
      items.push({ label: this.state.t('editor.duplicate'), icon: 'content_copy', action: () => this.state.duplicateTemplate(entry) });
    }
    items.push({ label: this.state.t('templateActions.renameDialog'), icon: 'edit', shortcut: 'F2', action: () => void this.state.renameTemplate(entry) });
    if (entry.kind !== 'folder') {
      items.push({ label: this.state.t('content.usedBy'), icon: 'link', action: () => this.state.templateUsedBy.set(entry.id) });
    }
    items.push({
      label: this.state.t(this.state.isFavoriteKey(favorite.key) ? 'favorites.remove' : 'favorites.add'),
      icon: 'star',
      action: () => this.state.toggleFavoriteOf(favorite),
    });
    return items;
  };

  /** The delete question names what uses the templates (and, for a folder, what is inside) before anything goes. */
  protected readonly confirmDelete = (nodes: readonly SfTreeNode<SampleTemplateEntry>[]): Promise<boolean> =>
    this.state.deleteTemplates(
      nodes.flatMap((node) => (node.data ? [node.data] : [])),
      false,
    );

  protected onMoveTo(nodes: SfTreeNode<SampleTemplateEntry>[]): void {
    void this.state.moveTemplates(nodes.flatMap((node) => (node.data ? [node.data] : [])));
  }

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
    const item = (id: string, icon: string, action: () => void): SfMenuItem => ({
      id,
      icon,
      label: this.state.t(`templates.new.${id}`),
      action,
    });
    // The kind is named in the entry and is never taken from what is selected: the folder is where it goes, nothing more.
    const where = this.state.templateFolderOf();
    return [
      ...NEW_KINDS.map((kind) => item(kind, TEMPLATE_ICONS[kind], () => void this.state.newTemplate(where, kind))),
      { ...item('folder', TEMPLATE_ICONS.folder, () => this.state.notice('folder.newFolderNotice')), separatorBefore: true },
    ];
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
    // The question was asked by `confirmDelete`; the tree's own Undo notice says what Undo does in the prototype.
    request.completed(() => this.state.notice('folder.restored'));
  }

  private async reveal(): Promise<void> {
    for (const entry of templatePath(this.state.templateId()).filter((e) => e.kind === 'folder')) {
      await this.tree().expand(entry.id);
    }
  }
}
