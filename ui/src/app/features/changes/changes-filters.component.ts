import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ProjectMembersStore } from '../../core/project/project-members.store';
import { SfTagComponent } from '../../shared/components/display/sf-tag.component';
import { SfSearchInputComponent } from '../../shared/components/forms/sf-search-input.component';
import { SfMenuComponent } from '../../shared/components/menu/sf-menu.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { CHANGE_STATUSES, CHANGE_TYPES, SORTS, SORT_KEYS } from './changes-query.util';
import { ChangesStore } from './changes.store';

type FolderView = components['schemas']['FolderView'];

interface FilterOption {
  readonly value: string;
  readonly label: string;
  readonly icon?: string;
}

type FilterId = 'type' | 'status' | 'lang' | 'by' | 'folder';

/** How many picked values a trigger names before it says "3 selected". */
const NAMED_PICKS = 2;

/**
 * The filter bar of the Changes view (M35.23, gate decisions 26, 41 and 43): search, type (each type with its icon),
 * status, language, changed by, folder and — at the end — the sort, in one row of normal-size controls. Removable chips
 * of what is set sit below it, only while a filter is active. Type, status and language take several picks (the URL
 * holds them as repeated parameters); changed by and folder take one.
 */
@Component({
  selector: 'sf-changes-filters',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfMenuComponent, SfSearchInputComponent, SfTagComponent],
  templateUrl: './changes-filters.component.html',
  styleUrl: './changes-filters.component.scss',
})
export class ChangesFiltersComponent {
  protected readonly store = inject(ChangesStore);
  private readonly context = inject(ProjectContextStore);
  private readonly members = inject(ProjectMembersStore);
  private readonly transloco = inject(TranslocoService);

  /** The editorial folders of every store, "Pages › About › Team", for the folder filter. */
  private readonly folderOptions = computed<FilterOption[]>(() => {
    const out: FilterOption[] = [];
    const walk = (nodes: FolderView[], trail: string[]) => {
      for (const node of nodes) {
        if (!node.uuid || node.type === 'RECORD_SET') {
          continue;
        }
        const label = [...trail, node.displayName || node.uid || ''];
        out.push({ value: node.uuid, label: label.join(' › ') });
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

  private readonly options = computed<Record<FilterId, readonly FilterOption[]>>(() => ({
    type: CHANGE_TYPES.map((t) => ({ value: t.value, label: this.transloco.translate(`enum.assetType.${t.value}`), icon: t.icon })),
    status: CHANGE_STATUSES.map((value) => ({ value, label: this.transloco.translate(`enum.releaseStatus.${value}`) })),
    lang: this.store.localeOptions(),
    by: this.members.members().map((m) => ({ value: String(m.userId), label: m.displayName || m.username || String(m.userId) })),
    folder: this.folderOptions(),
  }));

  /** What each filter has picked, as option values. */
  private readonly picked = computed<Record<FilterId, readonly string[]>>(() => {
    const s = this.store.state();
    return {
      type: s.type,
      status: s.status,
      lang: s.locale,
      by: s.changedBy == null ? [] : [String(s.changedBy)],
      folder: s.folder ? [s.folder] : [],
    };
  });

  protected readonly menus = computed(() => {
    const picked = this.picked();
    const ids: FilterId[] = this.store.localeOptions().length > 0 ? ['type', 'status', 'lang', 'by', 'folder'] : ['type', 'status', 'by', 'folder'];
    return ids.map((id) => {
      const options = this.options()[id];
      const chosen = picked[id];
      const name = this.t(`filters.${id}`);
      const labels = chosen.map((value) => this.labelOf(id, value));
      const items: SfMenuItem[] = [
        { id: '', label: this.t(`filters.any.${id}`), icon: chosen.length === 0 ? 'check' : undefined, action: () => this.clear(id) },
        ...options.map((option, i) => ({
          id: option.value,
          label: option.label,
          icon: option.icon ?? (chosen.includes(option.value) ? 'check' : undefined),
          description: chosen.includes(option.value) ? this.t('filters.selected') : undefined,
          separatorBefore: i === 0,
          action: () => this.pick(id, option.value),
        })),
      ];
      const value = labels.length > NAMED_PICKS ? this.t('filters.count', { count: labels.length }) : labels.join(', ');
      return { id, name, text: labels.length ? this.t('filters.picked', { filter: name, value }) : name, items };
    });
  });

  protected readonly sortItems = computed<SfMenuItem[]>(() =>
    SORTS.map((sort) => ({
      id: sort,
      label: this.t(`sort.${SORT_KEYS[sort]}`),
      icon: this.store.state().sort === sort ? 'check' : undefined,
      action: () => this.store.update({ sort }),
    })),
  );
  protected readonly sortText = computed(() => this.t('sort.pill', { sort: this.t(`sort.${SORT_KEYS[this.store.state().sort]}`) }));

  /** The chosen filter values as removable chips (one per value). */
  protected readonly chips = computed(() => {
    const picked = this.picked();
    const ids: FilterId[] = ['type', 'status', 'lang', 'by', 'folder'];
    const chips = ids.flatMap((id) =>
      picked[id].map((value) => ({
        key: `${id}:${value}`,
        label: this.t('filters.picked', { filter: this.t(`filters.${id}`), value: this.labelOf(id, value) }),
        remove: () => this.drop(id, value),
      })),
    );
    const q = this.store.state().q.trim();
    if (q) {
      chips.push({ key: 'q', label: this.t('filters.search', { text: q }), remove: () => this.store.update({ q: '' }) });
    }
    return chips;
  });

  private labelOf(id: FilterId, value: string): string {
    if (id === 'lang' && value === '') {
      return this.t('page.allLanguages');
    }
    return this.options()[id].find((o) => o.value === value)?.label ?? (id === 'lang' ? this.store.locales.labelOf(value) : id === 'by' ? this.members.nameOf(Number(value)) : value);
  }

  private pick(id: FilterId, value: string): void {
    switch (id) {
      case 'type':
        this.store.toggleIn('type', value);
        break;
      case 'status':
        this.store.toggleIn('status', value);
        break;
      case 'lang':
        this.store.toggleIn('locale', value);
        break;
      case 'by':
        this.store.update({ changedBy: Number(value) });
        break;
      case 'folder':
        this.store.update({ folder: value });
        break;
    }
  }

  private drop(id: FilterId, value: string): void {
    if (id === 'by') {
      this.store.update({ changedBy: null });
    } else if (id === 'folder') {
      this.store.update({ folder: null });
    } else {
      this.pick(id, value);
    }
  }

  private clear(id: FilterId): void {
    this.store.update({
      type: id === 'type' ? [] : this.store.state().type,
      status: id === 'status' ? [] : this.store.state().status,
      locale: id === 'lang' ? [] : this.store.state().locale,
      changedBy: id === 'by' ? null : this.store.state().changedBy,
      folder: id === 'folder' ? null : this.store.state().folder,
    });
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`changes.${key}`, params);
  }
}
