import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ProjectMembersStore } from '../../core/project/project-members.store';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { statusLabel } from '../release/release-status.util';
import { CHANGE_STATUSES, CHANGE_TYPES, SORTS, typeInfo } from './changes-query.util';
import { ChangesStore } from './changes.store';

type FolderView = components['schemas']['FolderView'];

interface FolderOption {
  uuid: string;
  label: string;
}

/** The filter bar of the Changes view: search, selects, toggles and the removable chips of what is set. */
@Component({
  selector: 'sf-changes-filters',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfIconComponent],
  templateUrl: './changes-filters.component.html',
  styleUrl: './changes-filters.component.scss',
})
export class ChangesFiltersComponent {
  protected readonly store = inject(ChangesStore);
  private readonly context = inject(ProjectContextStore);
  protected readonly members = inject(ProjectMembersStore);

  protected readonly typeOptions = CHANGE_TYPES;
  protected readonly statusOptions = CHANGE_STATUSES;
  protected readonly sortOptions = SORTS;
  protected statusLabel = statusLabel;

  /** The editorial folders of every store, "Pages › About › Team", for the folder filter. */
  protected readonly folderOptions = computed<FolderOption[]>(() => {
    const out: FolderOption[] = [];
    const walk = (nodes: FolderView[], trail: string[]) => {
      for (const node of nodes) {
        if (!node.uuid || node.type === 'RECORD_SET') {
          continue;
        }
        const label = [...trail, node.displayName || node.uid || ''];
        out.push({ uuid: node.uuid, label: label.join(' › ') });
        walk(node.children ?? [], label);
      }
    };
    walk(this.context.pageFolderTree(), []);
    walk(this.context.mediaFolderTree(), []);
    walk(this.context.contentFolderTree(), []);
    walk(this.context.globalsFolderTree(), []);
    walk(this.context.navigationFolderTree(), []);
    return out;
  });

  /** The chosen filter values as removable chips. */
  protected readonly chips = computed(() => {
    const state = this.store.state();
    const chips: { key: string; label: string; remove: () => void }[] = [];
    for (const type of state.type) {
      chips.push({ key: `type:${type}`, label: typeInfo(type).label, remove: () => this.store.toggleIn('type', type) });
    }
    for (const status of state.status) {
      chips.push({ key: `status:${status}`, label: statusLabel(status), remove: () => this.store.toggleIn('status', status) });
    }
    for (const locale of state.locale) {
      chips.push({
        key: `locale:${locale}`,
        label: locale ? this.store.locales.labelOf(locale) : 'All languages',
        remove: () => this.store.toggleIn('locale', locale),
      });
    }
    if (state.changedBy != null) {
      chips.push({
        key: 'changedBy',
        label: `Changed by ${this.members.nameOf(state.changedBy)}`,
        remove: () => this.store.update({ changedBy: null }),
      });
    }
    if (state.folder) {
      const folder = this.folderOptions().find((f) => f.uuid === state.folder);
      chips.push({ key: 'folder', label: `In ${folder?.label ?? 'folder'}`, remove: () => this.store.update({ folder: null }) });
    }
    if (state.q) {
      chips.push({ key: 'q', label: `“${state.q}”`, remove: () => this.store.update({ q: '' }) });
    }
    return chips;
  });

  protected isIn(list: string[], value: string): boolean {
    return list.includes(value);
  }
}
