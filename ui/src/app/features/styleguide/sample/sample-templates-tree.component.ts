import { ChangeDetectionStrategy, Component, afterNextRender, computed, effect, inject, untracked, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfMenuComponent, SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import { SfTreeAction, SfTreeComponent, SfTreeDeleteRequest } from '../../../shared/components/sf-tree.component';
import { SfTreeLoader, SfTreeNode } from '../../../shared/components/tree/tree-model';
import { SampleTemplateEntry, SampleTemplateKind, templateChildren, templatePath } from './sample-content-data';
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
        (open)="state.openTemplate($event.id)"
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

  protected readonly loader = computed<SfTreeLoader<SampleTemplateEntry>>(() => {
    const dev = this.state.devMode();
    return (parent) =>
      templateChildren(parent?.id ?? null).map(
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
  });

  protected readonly selection = computed(() => {
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
