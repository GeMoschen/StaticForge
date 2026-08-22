import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import type { components } from '../../core/api/generated/schema.d.ts';
import { HttpClient } from '@angular/common/http';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import {
  etagFor,
  StructuresService,
  type StructureDetail,
  type StructureSummary,
} from './structures.service';

type AssetSummaryView = components['schemas']['AssetSummaryView'];

interface NavNode {
  label?: string;
  active?: boolean;
  trail?: boolean;
  children?: NavNode[];
}

interface FlatNavItem {
  key: string;
  depth: number;
  label: string;
  active: boolean;
  trail: boolean;
}

const KIND_LABELS: Record<string, string> = {
  navigation: 'Navigation',
  breadcrumb: 'Breadcrumb',
  list: 'List',
};

@Component({
  selector: 'sf-structures',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfEmptyStateComponent, SfFieldComponent],
  templateUrl: './structures.component.html',
  styleUrl: './structures.component.scss',
})
export class StructuresComponent {
  readonly projectKey = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly service = inject(StructuresService);
  private readonly toast = inject(ToastService);

  readonly structures = signal<StructureSummary[]>([]);
  readonly loading = signal(false);
  readonly selectedUuid = signal<string | null>(null);

  readonly detail = signal<StructureDetail | null>(null);
  readonly sourceText = signal('');
  readonly sourceSaving = signal(false);

  readonly selectedChannel = signal('');
  readonly channelSource = signal('');
  readonly channelSaving = signal(false);

  readonly pages = signal<AssetSummaryView[]>([]);
  readonly selectedPageUuid = signal('');
  readonly previewTree = signal<NavNode | null>(null);
  readonly previewLoading = signal(false);

  readonly kindFilter = signal('');

  readonly filteredStructures = computed(() => {
    const filter = this.kindFilter();
    const all = this.structures();
    if (!filter) {
      return all;
    }
    return all.filter((s) => this.kindOf(s) === filter);
  });

  readonly channelKeys = computed<string[]>(() => {
    const templates = this.detail()?.channelTemplates as
      | Record<string, unknown>
      | undefined;
    return Object.keys(templates ?? {});
  });

  readonly flatNav = computed<FlatNavItem[]>(() => {
    this.seq = 0;
    const items: FlatNavItem[] = [];
    this.flatten(this.previewTree(), 0, items);
    return items;
  });

  private seq = 0;

  constructor() {
    effect(
      () => {
        const key = this.projectKey();
        if (!key) {
          return;
        }
        this.reloadList(key);
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const key = this.projectKey();
        if (!key) {
          return;
        }
        this.reloadPages(key);
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const key = this.projectKey();
        const uuid = this.selectedUuid();
        if (!key || !uuid) {
          this.detail.set(null);
          this.previewTree.set(null);
          return;
        }
        this.reloadDetail(key, uuid);
      },
      { allowSignalWrites: true },
    );
  }

  trackByUuid(index: number, item: StructureSummary): string {
    return item.uuid ?? `${index}`;
  }

  select(uuid?: string): void {
    this.selectedUuid.set(uuid ?? null);
  }

  newStructure(): void {
    const key = this.projectKey();
    if (!key) {
      return;
    }
    const sourceText = 'navigation {\n  source {\n    depth     3\n  }\n}\n';
    this.service.create(key, { displayName: 'New structure', kind: 'NAVIGATION', sourceText }).subscribe({
      next: (created) => {
        this.toast.show('Structure created', 'success');
        this.reloadList(key);
        this.selectedUuid.set(created.uuid ?? null);
      },
      error: () => this.toast.show('Failed to create structure', 'error'),
    });
  }

  onFilterChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.kindFilter.set(value);
  }

  onSourceInput(event: Event): void {
    this.sourceText.set((event.target as HTMLTextAreaElement).value);
  }

  saveSource(): void {
    const key = this.projectKey();
    const uuid = this.selectedUuid();
    const detail = this.detail();
    if (!key || !uuid || !detail) {
      return;
    }
    this.sourceSaving.set(true);
    this.service
      .update(key, uuid, { sourceText: this.sourceText() }, this.etag(detail))
      .subscribe({
        next: (updated) => {
          this.applyUpdated(updated);
          this.toast.show('Source saved', 'success');
          this.sourceSaving.set(false);
          this.loadPreview(key, uuid);
        },
        error: () => {
          this.toast.show('Failed to save source', 'error');
          this.sourceSaving.set(false);
        },
      });
  }

  selectChannel(channelKey: string): void {
    this.selectedChannel.set(channelKey);
    this.channelSource.set(this.readChannelSource(channelKey));
  }

  onChannelInput(event: Event): void {
    this.channelSource.set((event.target as HTMLTextAreaElement).value);
  }

  saveChannel(): void {
    const key = this.projectKey();
    const uuid = this.selectedUuid();
    const detail = this.detail();
    const channel = this.selectedChannel();
    if (!key || !uuid || !detail || !channel) {
      return;
    }
    this.channelSaving.set(true);
    this.service
      .saveChannel(key, uuid, channel, this.channelSource(), this.etag(detail))
      .subscribe({
        next: () => {
          this.toast.show(`Channel ${channel} saved`, 'success');
          this.channelSaving.set(false);
          this.reloadDetail(key, uuid);
        },
        error: () => {
          this.toast.show(`Failed to save channel ${channel}`, 'error');
          this.channelSaving.set(false);
        },
      });
  }

  onPageChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedPageUuid.set(value);
    const key = this.projectKey();
    const uuid = this.selectedUuid();
    if (key && uuid) {
      this.loadPreview(key, uuid);
    }
  }

  kindLabel(item: StructureSummary): string {
    const kind = this.kindOf(item);
    return KIND_LABELS[kind] ?? item.assetType ?? '—';
  }

  private kindOf(item: StructureSummary): string {
    const raw = item.assetType ?? '';
    return raw.toLowerCase();
  }

  badgeClass(item: StructureSummary): string {
    return `badge badge--${this.kindOf(item)}`;
  }

  private etag(detail: StructureDetail): string | undefined {
    const revision = detail.revision;
    return revision != null ? etagFor(revision) : undefined;
  }

  private readChannelSource(channelKey: string): string {
    const templates = this.detail()?.channelTemplates as
      | Record<string, unknown>
      | undefined;
    const value = templates?.[channelKey];
    if (typeof value === 'string') {
      return value;
    }
    if (value && typeof value === 'object') {
      const source = (value as { source?: unknown }).source;
      return typeof source === 'string' ? source : '';
    }
    return '';
  }

  private reloadList(key: string): void {
    this.loading.set(true);
    this.service.list(key).subscribe({
      next: (res) => {
        const list = res.content ?? [];
        this.structures.set(list);
        this.loading.set(false);
        const current = this.selectedUuid();
        if (!current && list.length > 0) {
          this.selectedUuid.set(list[0].uuid ?? null);
        }
      },
      error: () => {
        this.toast.show('Failed to load structures', 'error');
        this.loading.set(false);
      },
    });
  }

  private reloadPages(key: string): void {
    this.http
      .get<AssetSummaryView[]>(`/api/v1/projects/${key}/pages`, {
        withCredentials: true,
      })
      .subscribe({
        next: (pages) => {
          this.pages.set(pages ?? []);
          if (this.selectedPageUuid() === '' && (pages ?? []).length > 0) {
            this.selectedPageUuid.set(pages[0].uuid ?? '');
          }
        },
        error: () => {
          this.pages.set([]);
        },
      });
  }

  private reloadDetail(key: string, uuid: string): void {
    this.service.get(key, uuid).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.sourceText.set(detail.sourceText ?? '');
        const keys = this.channelKeys();
        const selected = this.selectedChannel();
        if (selected && keys.includes(selected)) {
          this.channelSource.set(this.readChannelSource(selected));
        } else if (keys.length > 0) {
          this.selectedChannel.set(keys[0]);
          this.channelSource.set(this.readChannelSource(keys[0]));
        } else {
          this.selectedChannel.set('');
          this.channelSource.set('');
        }
        this.loadPreview(key, uuid);
      },
      error: () => this.toast.show('Failed to load structure', 'error'),
    });
  }

  private applyUpdated(updated: StructureDetail): void {
    this.detail.set(updated);
    this.structures.update((list) =>
      list.map((s) => (s.uuid === updated.uuid ? this.summaryFrom(updated) : s)),
    );
  }

  private summaryFrom(detail: StructureDetail): StructureSummary {
    return {
      uuid: detail.uuid,
      uid: detail.uid,
      assetType: detail.kind,
      displayName: detail.displayName,
      revision: detail.revision,
    };
  }

  private loadPreview(key: string, uuid: string): void {
    this.previewLoading.set(true);
    this.service
      .preview(key, uuid, this.selectedPageUuid() || undefined)
      .subscribe({
        next: (tree) => {
          this.previewTree.set(tree as NavNode);
          this.previewLoading.set(false);
        },
        error: () => {
          this.previewTree.set(null);
          this.previewLoading.set(false);
        },
      });
  }

  private flatten(
    node: NavNode | null | undefined,
    depth: number,
    out: FlatNavItem[],
  ): void {
    if (!node) {
      return;
    }
    out.push({
      key: `${depth}-${this.seq++}`,
      depth,
      label: node.label ?? '',
      active: !!node.active,
      trail: !!node.trail,
    });
    for (const child of node.children ?? []) {
      this.flatten(child, depth + 1, out);
    }
  }
}
