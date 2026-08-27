import { HttpErrorResponse } from '@angular/common/http';
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
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfCreateAssetDialogComponent, type CreateAssetFormValue } from '../../shared/components/sf-create-asset-dialog.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfRenameAssetDialogComponent } from '../../shared/components/sf-rename-asset-dialog.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfUidRenameComponent } from '../../shared/components/sf-uid-rename.component';
import { ContextMenuItem, ContextMenuService } from '../../shared/services/context-menu.service';
import { ChannelsService } from '../channels/channels.service';
import {
  etagFor,
  TemplatesService,
  type Diagnostic,
  type TemplateDetail,
  type TemplateKind,
  type TemplateSummary,
} from './templates.service';

type ChannelView = components['schemas']['ChannelView'];

interface ChannelTemplateValue {
  source?: string;
  compiledHash?: string;
}

const NEW_CONTENT_DEFINITION = '';

@Component({
  selector: 'sf-templates',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfButtonComponent,
    SfCreateAssetDialogComponent,
    SfEmptyStateComponent,
    SfFieldComponent,
    SfRenameAssetDialogComponent,
    SfSpinnerComponent,
    SfUidRenameComponent,
  ],
  templateUrl: './templates.component.html',
  styleUrl: './templates.component.scss',
})
export class TemplatesComponent {
  readonly projectKey = input.required<string>();

  private readonly service = inject(TemplatesService);
  private readonly channelsService = inject(ChannelsService);
  private readonly store = inject(ProjectContextStore);
  private readonly toast = inject(ToastService);
  private readonly menu = inject(ContextMenuService);
  private readonly api = inject(ApiClient);

  /** `ProjectContextStore.pageTemplates`/`sectionTemplates` (used by the "new page" template picker and the page editor's "add section" palette) are only loaded once per project — force a refresh whenever a template is created/renamed/deleted here so those stay in sync without an F5. */
  private refreshTemplateStore(): void {
    const key = this.projectKey();
    if (key) {
      this.store.loadFor(key, true).subscribe();
    }
  }

  readonly kind = signal<TemplateKind>('section');

  readonly templates = signal<TemplateSummary[]>([]);
  readonly loading = signal(false);
  readonly selectedUuid = signal<string | null>(null);

  readonly detail = signal<TemplateDetail | null>(null);
  readonly displayName = signal('');
  readonly category = signal('');
  readonly deprecated = signal(false);
  readonly contentDefinition = signal('');
  readonly saving = signal(false);
  readonly cdlDiagnostics = signal<Diagnostic[]>([]);

  readonly channels = signal<ChannelView[]>([]);
  readonly selectedChannel = signal('');
  readonly channelSource = signal('');
  readonly channelSaving = signal(false);

  readonly confirmDelete = signal(false);

  readonly channelKeys = computed<string[]>(() => {
    const templates = this.channelTemplatesOf(this.detail());
    return Object.keys(templates ?? {});
  });

  readonly availableChannels = computed<ChannelView[]>(() => {
    const existing = new Set(this.channelKeys());
    return this.channels().filter((c) => !existing.has(c.key ?? ''));
  });

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
        this.reloadChannels(key);
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const key = this.projectKey();
        const uuid = this.selectedUuid();
        if (!key || !uuid) {
          this.detail.set(null);
          return;
        }
        this.reloadDetail(key, uuid);
      },
      { allowSignalWrites: true },
    );
  }

  trackByUuid(index: number, item: TemplateSummary): string {
    return item.uuid ?? `${index}`;
  }

  isSection(): boolean {
    return this.kind() === 'section';
  }

  switchKind(kind: TemplateKind): void {
    if (this.kind() === kind) {
      return;
    }
    this.kind.set(kind);
    this.selectedUuid.set(null);
    this.detail.set(null);
    this.templates.set([]);
    this.reloadList(this.projectKey());
  }

  select(uuid?: string): void {
    this.selectedUuid.set(uuid ?? null);
  }

  readonly newTemplateOpen = signal(false);
  readonly creatingTemplate = signal(false);

  readonly createDialogKind = computed<'PAGE_TEMPLATE' | 'SECTION_TEMPLATE'>(() =>
    this.isSection() ? 'SECTION_TEMPLATE' : 'PAGE_TEMPLATE',
  );

  newTemplate(): void {
    this.newTemplateOpen.set(true);
  }

  closeNewTemplate(): void {
    this.newTemplateOpen.set(false);
  }

  submitNewTemplate(value: CreateAssetFormValue): void {
    const key = this.projectKey();
    if (!key) {
      return;
    }
    this.creatingTemplate.set(true);
    this.service
      .create(this.kind(), key, {
        displayName: value.displayName,
        contentDefinition: NEW_CONTENT_DEFINITION,
        channelSources: {},
      })
      .subscribe({
        next: (created) => {
          this.creatingTemplate.set(false);
          this.newTemplateOpen.set(false);
          this.toast.show('Template created', 'success');
          this.reloadList(key);
          this.selectedUuid.set(created.uuid ?? null);
          this.refreshTemplateStore();
        },
        error: () => {
          this.creatingTemplate.set(false);
          this.toast.show('Could not create template — try again in a moment.', 'error');
        },
      });
  }

  onDisplayNameInput(event: Event): void {
    this.displayName.set((event.target as HTMLInputElement).value);
  }

  onCategoryInput(event: Event): void {
    this.category.set((event.target as HTMLInputElement).value);
  }

  onDeprecatedChange(event: Event): void {
    this.deprecated.set((event.target as HTMLInputElement).checked);
  }

  onContentDefinitionInput(event: Event): void {
    this.contentDefinition.set((event.target as HTMLTextAreaElement).value);
  }

  validateCdl(): void {
    const key = this.projectKey();
    if (!key) {
      return;
    }
    this.service.validateCdl(key, this.contentDefinition()).subscribe({
      next: (res) => {
        this.cdlDiagnostics.set(res.diagnostics ?? []);
        this.toast.show(
          (res.diagnostics ?? []).some((d) => d.severity === 'ERROR')
            ? 'CDL has errors'
            : 'CDL is valid',
          (res.diagnostics ?? []).some((d) => d.severity === 'ERROR')
            ? 'error'
            : 'success',
        );
      },
      error: () => this.toast.show('Could not validate CDL — check your connection and try again.', 'error'),
    });
  }

  saveDefinition(): void {
    const key = this.projectKey();
    const uuid = this.selectedUuid();
    const detail = this.detail();
    if (!key || !uuid || !detail) {
      return;
    }
    this.saving.set(true);
    this.service
      .update(
        this.kind(),
        key,
        uuid,
        {
          displayName: this.displayName(),
          contentDefinition: this.contentDefinition(),
          category: this.category(),
          deprecated: this.deprecated(),
          channelSources: this.channelSourcesOf(detail),
          ...(this.isSection() ? {} : { outputPath: this.outputPathOf(detail) }),
        },
        this.etag(detail),
      )
      .subscribe({
        next: (updated) => {
          this.applyUpdated(updated);
          this.toast.show('Template saved', 'success');
          this.saving.set(false);
          this.cdlDiagnostics.set([]);
          this.refreshTemplateStore();
        },
        error: (err) => {
          const diagnostics = this.diagnosticsOf(err);
          if (diagnostics.length > 0) {
            this.cdlDiagnostics.set(diagnostics);
            this.toast.show(
              'Template has compile errors — see diagnostics below. Removing content used by a channel template will break that channel until it is updated too.',
              'error',
            );
          } else {
            this.toast.show('Could not save template — someone may have edited it, try reloading.', 'error');
          }
          this.saving.set(false);
        },
      });
  }

  onUidChanged(): void {
    const key = this.projectKey();
    const uuid = this.selectedUuid();
    if (!key || !uuid) {
      return;
    }
    this.reloadDetail(key, uuid);
    this.reloadList(key);
    this.refreshTemplateStore();
  }

  readonly renameOpen = signal(false);
  readonly renamingName = signal(false);
  private renameTarget: TemplateSummary | null = null;

  onRowContextMenu(event: MouseEvent, item: TemplateSummary): void {
    const items: ContextMenuItem[] = [
      { label: 'Rename', icon: 'edit', action: () => this.openRename(item) },
    ];
    this.menu.open(event, items);
  }

  openRename(item: TemplateSummary): void {
    this.renameTarget = item;
    this.renameOpen.set(true);
  }

  renameTargetUuid(): string {
    return this.renameTarget?.uuid ?? '';
  }

  renameTargetUid(): string {
    return this.renameTarget?.uid ?? '';
  }

  renameTargetDisplayName(): string {
    return this.renameTarget?.displayName ?? this.renameTarget?.uid ?? '';
  }

  closeRename(): void {
    this.renameOpen.set(false);
  }

  submitRenameDisplayName(displayName: string): void {
    const key = this.projectKey();
    const uuid = this.renameTarget?.uuid;
    if (!key || !uuid) {
      return;
    }
    this.renamingName.set(true);
    this.api.renameAsset(key, uuid, { displayName }).subscribe({
      next: () => {
        this.renamingName.set(false);
        this.renameOpen.set(false);
        this.toast.show('Template renamed', 'success');
        this.reloadRenamedTemplate(uuid);
      },
      error: () => {
        this.renamingName.set(false);
        this.toast.show('Could not rename template — try again in a moment.', 'error');
      },
    });
  }

  onRenameUidChanged(): void {
    // sf-uid-rename already toasts "UID changed" itself — just reload.
    const uuid = this.renameTarget?.uuid;
    if (uuid) {
      this.reloadRenamedTemplate(uuid);
    }
  }

  private reloadRenamedTemplate(uuid: string): void {
    const key = this.projectKey();
    if (!key) {
      return;
    }
    this.reloadList(key);
    if (this.selectedUuid() === uuid) {
      this.reloadDetail(key, uuid);
    }
    this.refreshTemplateStore();
  }

  private diagnosticsOf(err: unknown): Diagnostic[] {
    if (!(err instanceof HttpErrorResponse)) {
      return [];
    }
    const body = err.error as { diagnostics?: Diagnostic[] } | null;
    return Array.isArray(body?.diagnostics) ? body.diagnostics : [];
  }

  selectChannel(channelKey: string): void {
    this.selectedChannel.set(channelKey);
    this.channelSource.set(this.readChannelSource(channelKey));
  }

  onChannelInput(event: Event): void {
    this.channelSource.set((event.target as HTMLTextAreaElement).value);
  }

  onAddChannel(event: Event): void {
    const channelKey = (event.target as HTMLSelectElement).value;
    if (channelKey) {
      this.addChannel(channelKey);
    }
  }

  addChannel(channelKey: string): void {
    const key = this.projectKey();
    const uuid = this.selectedUuid();
    const detail = this.detail();
    if (!key || !uuid || !detail || !channelKey) {
      return;
    }
    this.channelSaving.set(true);
    this.service
      .saveChannel(this.kind(), key, uuid, channelKey, '', this.etag(detail))
      .subscribe({
        next: () => {
          this.toast.show(`Channel ${channelKey} added`, 'success');
          this.channelSaving.set(false);
          this.reloadDetail(key, uuid);
          this.selectedChannel.set(channelKey);
        },
        error: () => {
          this.toast.show(`Could not add channel ${channelKey} — it may already exist.`, 'error');
          this.channelSaving.set(false);
        },
      });
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
      .saveChannel(
        this.kind(),
        key,
        uuid,
        channel,
        this.channelSource(),
        this.etag(detail),
      )
      .subscribe({
        next: () => {
          this.toast.show(`Channel ${channel} saved`, 'success');
          this.channelSaving.set(false);
          this.reloadDetail(key, uuid);
        },
        error: () => {
          this.toast.show(`Could not save channel ${channel} — check the OCTL source compiles.`, 'error');
          this.channelSaving.set(false);
        },
      });
  }

  deleteChannel(): void {
    const key = this.projectKey();
    const uuid = this.selectedUuid();
    const detail = this.detail();
    const channel = this.selectedChannel();
    if (!key || !uuid || !detail || !channel) {
      return;
    }
    this.channelSaving.set(true);
    this.service
      .deleteChannel(this.kind(), key, uuid, channel, this.etag(detail))
      .subscribe({
        next: () => {
          this.toast.show(`Channel ${channel} removed`, 'success');
          this.channelSaving.set(false);
          this.selectedChannel.set('');
          this.channelSource.set('');
          this.reloadDetail(key, uuid);
        },
        error: () => {
          this.toast.show(`Could not remove channel ${channel} — try again in a moment.`, 'error');
          this.channelSaving.set(false);
        },
      });
  }

  requestDelete(): void {
    this.confirmDelete.set(true);
  }

  cancelDelete(): void {
    this.confirmDelete.set(false);
  }

  confirmDeleteAction(): void {
    const key = this.projectKey();
    const uuid = this.selectedUuid();
    if (!key || !uuid) {
      return;
    }
    this.service.delete(this.kind(), key, uuid).subscribe({
      next: () => {
        this.toast.show('Template deleted', 'success');
        this.confirmDelete.set(false);
        this.selectedUuid.set(null);
        this.detail.set(null);
        this.reloadList(key);
        this.refreshTemplateStore();
      },
      error: () => {
        this.toast.show('Could not delete template — it may still be in use by a page.', 'error');
        this.confirmDelete.set(false);
      },
    });
  }

  private channelTemplatesOf(detail: TemplateDetail | null): Record<string, ChannelTemplateValue> | null {
    return (detail?.channelTemplates as Record<string, ChannelTemplateValue> | null) ?? null;
  }

  private channelSourcesOf(detail: TemplateDetail): Record<string, string> {
    const templates = this.channelTemplatesOf(detail) ?? {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(templates)) {
      out[key] = value?.source ?? '';
    }
    return out;
  }

  private outputPathOf(detail: TemplateDetail): Record<string, string> {
    const raw = detail.outputPath as Record<string, string> | null | undefined;
    if (!raw) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string') {
        out[key] = value;
      }
    }
    return out;
  }

  private readChannelSource(channelKey: string): string {
    const templates = this.channelTemplatesOf(this.detail()) ?? {};
    return templates[channelKey]?.source ?? '';
  }

  private etag(detail: TemplateDetail): string | undefined {
    const revision = detail.revision;
    return revision != null ? etagFor(revision) : undefined;
  }

  private reloadList(key: string): void {
    this.loading.set(true);
    this.service.list(this.kind(), key).subscribe({
      next: (res) => {
        const list = res.content ?? [];
        this.templates.set(list);
        this.loading.set(false);
        const current = this.selectedUuid();
        if (!current && list.length > 0) {
          this.selectedUuid.set(list[0].uuid ?? null);
        }
      },
      error: () => {
        this.toast.show('Could not load templates — check your connection and try again.', 'error');
        this.loading.set(false);
      },
    });
  }

  private reloadChannels(key: string): void {
    this.channelsService.list(key).subscribe({
      next: (list) => this.channels.set(list ?? []),
      error: () => this.channels.set([]),
    });
  }

  private reloadDetail(key: string, uuid: string): void {
    this.service.get(this.kind(), key, uuid).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.displayName.set(detail.displayName ?? '');
        this.category.set(detail.category ?? '');
        this.deprecated.set(detail.deprecated ?? false);
        this.contentDefinition.set(detail.contentDefinition ?? '');
        this.cdlDiagnostics.set([]);
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
      },
      error: () => this.toast.show('Could not load template — check your connection and try again.', 'error'),
    });
  }

  private applyUpdated(updated: TemplateDetail): void {
    this.detail.set(updated);
    this.templates.update((list) =>
      list.map((t) => (t.uuid === updated.uuid ? this.summaryFrom(updated) : t)),
    );
  }

  private summaryFrom(detail: TemplateDetail): TemplateSummary {
    return {
      uuid: detail.uuid,
      uid: detail.uid,
      assetType: detail.assetType,
      displayName: detail.displayName,
      revision: detail.revision,
    };
  }
}
