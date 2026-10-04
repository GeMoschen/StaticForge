import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  Injector,
  input,
  output,
  signal,
  untracked,
  viewChildren,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { tap } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import { saveStateOf, type EditorError } from '../../core/editor/editor-state';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService } from '../../core/ui/undo.service';
import {
  diagnosticsIn,
  errorCount,
  firstSectionWithErrors,
  sectionsEqual,
  sectionsOf,
  type CdlSection,
  type CdlSections,
} from '../../shared/code-editor/cdl-sections';
import { SfCodePanelComponent } from '../../shared/code-editor/sf-code-panel.component';
import type { SaveResult } from '../../shared/components/dialog/unsaved-changes.service';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfCopyableComponent } from '../../shared/components/display/sf-copyable.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfSaveStatusComponent } from '../../shared/components/layout/sf-save-status.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfRenameAssetDialogComponent } from '../../shared/components/sf-rename-asset-dialog.component';
import { panelIdOf, SfTabsComponent, tabIdOf, type SfTab } from '../../shared/components/sf-tabs.component';
import { ContentService, etagFor, type DatasetDetailView, type Diagnostic } from '../content/content.service';
import { DatasetTemplatesStore } from '../content/dataset-templates.store';
import {
  firstPositioned,
  recordTemplateErrorsOf,
  recordTemplateMetaHelpers,
  recordTemplatesForSave,
  type RecordTemplateHelper,
} from '../content/record-template.util';
import type { EditorDefinition } from '../forms/form.model';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { datasetFields } from './dataset-fields.util';
import { DatasetOverviewComponent } from './dataset-overview.component';
import { sortDiagnostics } from './inheritance.util';
import { TemplatesItemActions } from './templates-item-actions.service';
import { TemplatesStoreRefresh } from './templates-store-refresh.service';
import { EMPTY_TEMPLATES_INDEX, type TemplateEntry } from './templates-tree.util';
import { TemplatesStore } from './templates.store';

type BrokenRecordSet = components['schemas']['BrokenRecordSet'];
type UsageDto = components['schemas']['UsageDto'];

/** What the templates screen needs to offer Undo for a deleted dataset. */
export interface DeletedDataset {
  uuid: string;
  name: string;
}

/** A dataset's CDL tabs: records have no bodies. */
const DATASET_SECTIONS: readonly CdlSection[] = ['content', 'rules'];
const CDL_TAB_FILES: Readonly<Record<'content' | 'rules', { tab: 'schema' | 'rules'; file: string }>> = {
  content: { tab: 'schema', file: 'content' },
  rules: { tab: 'rules', file: 'rules' },
};
/** A record template tab's id is its channel key behind this prefix, so a channel can never collide with a fixed tab. */
const CHANNEL_PREFIX = 'channel:';

let nextId = 0;

/**
 * A dataset in the Templates area (M35.21 C, gate decision 167), on the sample's tabs: a page header (name, the
 * *Dataset* badge, save status, *Save dataset*, ⋮ with Rename… / Duplicate / Used by / Delete) and
 * - **Overview**: the fields in a table, the description and title field, and *Used by*;
 * - **Schema** and **Rules**: the two CDL sections in code panels (live validation, Format, diagnostics with jump to line);
 * - one tab per channel: the OCTL **record template** one record renders with wherever a record set is rendered
 *   (`$CMS_VALUE(recordset:…)$`), with the click-to-insert field and record names.
 *
 * <p>Schema and record templates save together, as one revision, so a renamed field and the template reading it change
 * at once. A rejected template keeps the edited source and shows its diagnostics in its tab; a save that leaves set
 * queries invalid lists those sets. Deleting is disabled while records exist — the server refuses it too. The open
 * dataset is an editor for the frame (M35.13): Ctrl+S, the leave guard and the tab-close prompt. Datasets are a
 * developer's artifact: everyone else, and everyone in time travel, sees them read-only.
 */
@Component({
  selector: 'sf-dataset-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DatasetOverviewComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfCodePanelComponent,
    SfCopyableComponent,
    SfPageHeaderComponent,
    SfRenameAssetDialogComponent,
    SfSaveStatusComponent,
    SfTabsComponent,
    TranslocoPipe,
  ],
  providers: [DatasetTemplatesStore],
  templateUrl: './dataset-editor.component.html',
  styleUrl: './dataset-editor.component.scss',
})
export class DatasetEditorComponent {
  readonly projectKey = input.required<string>();
  readonly uuid = input.required<string>();

  /** Saved, renamed, duplicated or deleted: the templates tree should reload. */
  readonly changed = output<void>();
  readonly deleted = output<DeletedDataset>();

  private readonly content = inject(ContentService);
  private readonly toasts = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly actions = inject(TemplatesItemActions);
  private readonly transloco = inject(TranslocoService);
  private readonly timeTravel = inject(TimeTravelStore);
  private readonly injector = inject(Injector);
  private readonly area = inject(TemplatesStore);
  private readonly refresh = inject(TemplatesStoreRefresh, { optional: true });

  protected readonly store = inject(DatasetTemplatesStore);
  private readonly cdlPanels = viewChildren<SfCodePanelComponent>('cdlPanel');
  private readonly channelPanels = viewChildren<SfCodePanelComponent>('channelPanel');

  protected readonly canEdit = inject(ProjectPermissionsStore).canEditTemplates;
  protected readonly detail = this.store.detail;
  /** The CDL as edited (M34): content and rules; a dataset has no bodies. */
  protected readonly sections = this.store.sections;
  protected readonly savedSections = computed<CdlSections | null>(() => {
    const detail = this.detail();
    return detail ? sectionsOf(detail) : null;
  });
  protected readonly cdlSections = DATASET_SECTIONS as readonly ('content' | 'rules')[];
  protected readonly cdlFiles = CDL_TAB_FILES;
  protected readonly description = signal('');
  protected readonly titleEditor = signal('');
  /** Every CDL diagnostic (live check or a rejected save); each names its section in `field`. */
  protected readonly diagnostics = signal<Diagnostic[]>([]);
  protected readonly saving = signal(false);
  protected readonly validating = signal(false);
  protected readonly lastSaved = signal<string | null>(null);
  protected readonly saveError = signal<EditorError | null>(null);
  /** Sets whose stored query the last save left invalid (`brokenRecordSets`); dismissible. */
  protected readonly brokenRecordSets = signal<BrokenRecordSet[]>([]);
  /** What uses the dataset: `null` while it is being read. */
  protected readonly usages = signal<readonly UsageDto[] | null>(null);
  protected readonly usagesFailed = signal(false);
  protected readonly renaming = signal(false);
  protected readonly renameBusy = signal(false);

  protected readonly tabsId = `dataset-tabs-${nextId++}`;
  /** The open tab: `overview`, `schema`, `rules` or a channel (`channel:<key>`). */
  private readonly selectedTab = signal('overview');
  protected readonly metaHelpers: readonly RecordTemplateHelper[] = recordTemplateMetaHelpers();

  /** The dataset's fields, for record template completion (M33). */
  protected readonly fieldNames = this.store.fieldNames;
  private validateTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly hasErrors = computed(() => this.diagnostics().some((d) => d.severity === 'ERROR'));

  /** Whether the schema side differs from the stored dataset. */
  protected readonly schemaDirty = computed(() => {
    const d = this.detail();
    return (
      !!d &&
      (this.description() !== (d.description ?? '') ||
        !sectionsEqual(this.sections(), sectionsOf(d)) ||
        this.titleEditor() !== (d.titleEditor ?? ''))
    );
  });

  /** Anything to save: schema fields or any record template. */
  protected readonly dirty = computed(() => this.schemaDirty() || this.store.dirtyChannels().size > 0);
  protected readonly saveState = computed(() => saveStateOf({ dirty: this.dirty, saving: this.saving, error: this.saveError }));

  /** The title editor options: the stored schema's text editors (groups flattened). */
  protected readonly textEditors = computed<EditorDefinition[]>(() => {
    const out: EditorDefinition[] = [];
    const walk = (editors: EditorDefinition[] | undefined) => {
      for (const editor of editors ?? []) {
        if (editor.type === 'GROUP') {
          walk(editor.items);
        } else if (editor.type === 'TEXT') {
          out.push(editor);
        }
      }
    };
    walk(this.store.savedEditors());
    return out;
  });

  protected readonly loopSnippet = computed(() => {
    const uid = this.detail()?.uid ?? 'dataset';
    const first = this.textEditors()[0]?.name ?? 'field';
    return `$CMS_FOR(item : dataset:${uid}, sort="${first}")$ $CMS_VALUE(item.${first})$ $CMS_END_FOR$`;
  });

  /** The fields table: the stored schema (what the server compiled), with the rules of the stored Rules source. */
  protected readonly fields = computed(() => datasetFields(this.store.savedEditors(), this.detail()?.rulesCdl ?? ''));

  /** The channels that show a record template editor: every channel for a developer, else those holding a template. */
  protected readonly shownChannels = computed(() =>
    this.store.channelTabs().filter((tab) => this.canEdit() || this.store.sourceOf(tab.key).trim()),
  );

  protected readonly tabs = computed<SfTab[]>(() => {
    const all = this.diagnostics();
    const sections = this.sections();
    const saved = this.savedSections();
    const label = (key: string) => this.transloco.translate(`templates.dataset.tabs.${key}`);
    const cdl = (section: 'content' | 'rules'): SfTab => ({
      id: CDL_TAB_FILES[section].tab,
      label: label(CDL_TAB_FILES[section].tab),
      errors: errorCount(diagnosticsIn(all, section)),
      dirty: saved !== null && sections[section] !== saved[section],
    });
    return [
      { id: 'overview', label: label('overview') },
      cdl('content'),
      cdl('rules'),
      ...this.store.recordTemplateTabs().map((tab) => ({
        ...tab,
        id: CHANNEL_PREFIX + tab.id,
        note: tab.note ? this.transloco.translate('templates.dataset.channelDisabled') : undefined,
      })),
    ];
  });

  protected readonly tab = computed(() => {
    const selected = this.selectedTab();
    return this.tabs().some((t) => t.id === selected) ? selected : 'overview';
  });

  protected readonly moreActions = computed<SfMenuItem[]>(() => {
    const d = this.detail();
    const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(`templates.dataset.menu.${key}`, params);
    const edit = this.canEdit();
    const records = d?.recordCount ?? 0;
    return [
      { id: 'rename', label: t('rename'), icon: 'edit', shortcut: 'F2', disabled: !edit },
      { id: 'duplicate', label: t('duplicate'), icon: 'content_copy', disabled: !edit },
      { id: 'usedBy', label: t('usedBy'), icon: 'link' },
      {
        id: 'delete',
        label: t('delete'),
        icon: 'delete',
        danger: true,
        separatorBefore: true,
        disabled: !edit,
        disabledReason: edit && records > 0 ? t('deleteHasRecords', { count: records }) : undefined,
      },
    ];
  });

  constructor() {
    this.store.bind(this.projectKey);

    // The open dataset is an editor for the frame (M35.13): Ctrl+S, the leave guard and the tab-close prompt.
    const unregister = inject(ActiveEditorService).register({
      name: computed(() => this.detail()?.displayName || this.detail()?.uid || ''),
      dirty: this.dirty,
      saving: this.saving,
      lastSaved: this.lastSaved,
      error: this.saveError,
      autosave: false,
      save: () => this.saveAsync(),
      discard: async () => this.discard(),
    });
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(unregister);
    destroyRef.onDestroy(() => {
      if (this.validateTimer) {
        clearTimeout(this.validateTimer);
      }
    });

    effect(() => {
      const key = this.projectKey();
      const uuid = this.uuid();
      const revision = this.timeTravel.activeRevision();
      untracked(() => {
        this.store.selectedChannel.set(null);
        this.selectedTab.set('overview');
        this.brokenRecordSets.set([]);
        this.saveError.set(null);
        this.load(key, uuid, revision);
        this.loadUsages(key, uuid);
      });
    });

    effect(() => {
      const key = this.projectKey();
      untracked(() => this.store.loadChannels(key));
    });
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────

  protected selectTab(id: string): void {
    const previous = this.tab();
    this.selectedTab.set(id);
    if (id.startsWith(CHANNEL_PREFIX)) {
      this.store.selectTab(id.slice(CHANNEL_PREFIX.length), previous !== id);
    }
  }

  protected tabId(id: string): string {
    return tabIdOf(this.tabsId, id);
  }

  protected panelId(id: string): string {
    return panelIdOf(this.tabsId, id);
  }

  protected channelTab(key: string): string {
    return CHANNEL_PREFIX + key;
  }

  // ── Editing ────────────────────────────────────────────────────────────────

  protected onDescription(value: string): void {
    this.description.set(value);
  }

  protected onTitleEditor(value: string): void {
    this.titleEditor.set(value);
  }

  /** Live validation while typing, debounced; the same restrictions the save enforces. */
  protected onSectionInput(section: CdlSection, value: string): void {
    this.sections.update((sections) => ({ ...sections, [section]: value }));
    if (this.validateTimer) {
      clearTimeout(this.validateTimer);
    }
    this.validateTimer = setTimeout(() => this.validate(), 400);
  }

  protected diagnosticsOf(section: CdlSection): Diagnostic[] {
    return diagnosticsIn(this.diagnostics(), section);
  }

  protected sectionLabel(section: 'content' | 'rules'): string {
    return this.transloco.translate(`enum.cdlSection.${section}`);
  }

  protected validate(): void {
    this.validating.set(true);
    this.content.validateCdl(this.projectKey(), this.sections()).subscribe({
      next: (res) => {
        this.validating.set(false);
        this.diagnostics.set(sortDiagnostics(res.diagnostics ?? []) as Diagnostic[]);
      },
      error: () => this.validating.set(false),
    });
  }

  /** Inserts a field or record name into the open record template. */
  protected insertHelper(helper: RecordTemplateHelper): void {
    this.openChannelPanel()?.insert(helper.snippet, helper.caret);
  }

  protected dismissBrokenRecordSets(): void {
    this.brokenRecordSets.set([]);
  }

  /** The open channel's record template panel: one exists per shown channel, in tab order. */
  private openChannelPanel(): SfCodePanelComponent | undefined {
    const index = this.shownChannels().findIndex((tab) => tab.key === this.store.activeChannel());
    return index < 0 ? undefined : this.channelPanels()[index];
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  /** Saves schema and record templates together: one request, one revision. */
  save(): void {
    void this.saveAsync();
  }

  private saveAsync(): Promise<SaveResult> {
    const current = this.detail();
    if (!current?.uuid || !this.canEdit() || !this.dirty() || this.saving()) {
      return Promise.resolve({ ok: true });
    }
    this.saving.set(true);
    this.brokenRecordSets.set([]);
    this.store.dropPendingCheck();
    return new Promise<SaveResult>((resolve) => {
      this.content
        .updateDataset(
          this.projectKey(),
          current.uuid!,
          {
            displayName: current.displayName,
            contentCdl: this.sections().content,
            rulesCdl: this.sections().rules,
            titleEditor: this.titleEditor() || undefined,
            description: this.description(),
            channelTemplates: recordTemplatesForSave(this.store.recordTemplates()),
          },
          etagFor(current.revision ?? 0),
        )
        .subscribe({
          next: (saved) => {
            this.saving.set(false);
            this.apply(saved);
            this.lastSaved.set(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            this.store.recordTemplateDiagnostics.set(saved.recordTemplateDiagnostics ?? {});
            this.brokenRecordSets.set(saved.brokenRecordSets ?? []);
            const broken = saved.brokenRecordSets?.length ?? 0;
            this.toasts.show(
              broken > 0
                ? this.transloco.translate(broken === 1 ? 'templates.dataset.toast.savedBrokenOne' : 'templates.dataset.toast.savedBrokenMany', { count: broken })
                : this.transloco.translate('templates.dataset.toast.saved'),
              broken > 0 ? 'info' : 'success',
            );
            this.changed.emit();
            resolve({ ok: true });
          },
          error: (err: unknown) => {
            this.saving.set(false);
            resolve({ ok: false, message: this.showSaveError(err, current.uuid!) });
          },
        });
    });
  }

  /** Gives the unsaved edits up and reads the stored dataset again. */
  private discard(): void {
    this.saveError.set(null);
    this.load(this.projectKey(), this.uuid(), this.timeTravel.activeRevision());
  }

  /**
   * A rejected save keeps every edit. Record template errors (`422` with `channel`) open the first failing
   * channel and put the caret on the error; schema errors show on their CDL tab, which opens. Returns what was said.
   */
  private showSaveError(err: unknown, uuid: string): string {
    const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(`templates.dataset.toast.${key}`, params);
    const say = (message: string, error: EditorError | null = null): string => {
      this.saveError.set(error);
      this.toasts.show(message, 'error');
      return message;
    };
    if (!(err instanceof HttpErrorResponse)) {
      return say(t('saveFailed'));
    }
    const templateErrors = recordTemplateErrorsOf(err);
    if (templateErrors) {
      this.diagnostics.set([]);
      this.store.recordTemplateDiagnostics.update((all) => ({ ...all, ...templateErrors.byChannel }));
      this.selectTab(CHANNEL_PREFIX + templateErrors.channel);
      const channelDiagnostics = templateErrors.byChannel[templateErrors.channel] ?? [];
      this.revealFirstDiagnostic(channelDiagnostics);
      const message = t('templateErrors', { channel: templateErrors.channel });
      return say(message, { message, count: channelDiagnostics.filter((d) => d.severity === 'ERROR').length || undefined });
    }
    const body = (err.error ?? {}) as { diagnostics?: Diagnostic[]; detail?: string };
    if (Array.isArray(body.diagnostics) && body.diagnostics.length > 0) {
      this.diagnostics.set(sortDiagnostics(body.diagnostics) as Diagnostic[]);
      const section = firstSectionWithErrors(body.diagnostics, DATASET_SECTIONS) ?? 'content';
      this.selectedTab.set(CDL_TAB_FILES[section as 'content' | 'rules'].tab);
      const message = t('schemaErrors', { tab: this.transloco.translate(`templates.dataset.tabs.${CDL_TAB_FILES[section as 'content' | 'rules'].tab}`) });
      return say(message, { message, count: body.diagnostics.filter((d) => d.severity === 'ERROR').length || undefined });
    }
    if (err.status === 409) {
      this.load(this.projectKey(), uuid, null);
      return say(t('conflict'));
    }
    return say(body.detail || t('saveFailed'));
  }

  /** After the tab switch renders, moves the caret to the first positioned diagnostic. */
  private revealFirstDiagnostic(diagnostics: readonly Diagnostic[]): void {
    const target = firstPositioned(diagnostics);
    if (!target?.line) {
      return;
    }
    afterNextRender(() => this.openChannelPanel()?.goTo(target.line!, target.column ?? 1), { injector: this.injector });
  }

  // ── The ⋮ menu ─────────────────────────────────────────────────────────────

  protected secondary(item: SfMenuItem): void {
    switch (item.id) {
      case 'rename':
        if (this.canEdit()) {
          this.renaming.set(true);
        }
        break;
      case 'duplicate':
        void this.duplicate();
        break;
      case 'usedBy':
        if (this.detail()?.uuid) {
          this.area.usedByUuid.set(this.detail()!.uuid!);
        }
        break;
      case 'delete':
        void this.remove();
        break;
    }
  }

  /** What the item actions work on: this dataset as a Templates entry. */
  private entry(): TemplateEntry | null {
    const d = this.detail();
    if (!d?.uuid) {
      return null;
    }
    return {
      kind: 'dataset',
      uuid: d.uuid,
      name: d.displayName || d.uid || '',
      uid: d.uid ?? '',
      path: d.folderPath ?? '',
      protectedFolder: false,
      assetKind: 'DATASET',
      channels: [],
      usedByCount: null,
      changedAt: null,
      revision: d.revision ?? null,
      abstract: false,
    };
  }

  private async duplicate(): Promise<void> {
    const entry = this.entry();
    if (!entry || !this.canEdit()) {
      return;
    }
    await this.actions.duplicate(this.projectKey(), entry, this.detail()?.folderUuid, () => this.refresh?.notify());
  }

  private async remove(): Promise<void> {
    const current = this.detail();
    const entry = this.entry();
    if (!current?.uuid || !entry || !this.canEdit() || (current.recordCount ?? 0) > 0) {
      return;
    }
    const confirmed = await this.actions.confirmDelete(this.projectKey(), [entry], EMPTY_TEMPLATES_INDEX, this.injector);
    if (!confirmed) {
      return;
    }
    const uuid = current.uuid;
    const name = entry.name;
    this.content.deleteDataset(this.projectKey(), uuid).subscribe({
      next: () => {
        // The templates screen offers the Undo: this editor closes with the dataset.
        this.deleted.emit({ uuid, name });
      },
      error: (err: unknown) => {
        const body = err instanceof HttpErrorResponse ? ((err.error ?? {}) as { recordCount?: number }) : {};
        this.toasts.show(
          body.recordCount
            ? this.transloco.translate('templates.dataset.toast.deleteHasRecords', { count: body.recordCount })
            : this.transloco.translate('templates.dataset.toast.deleteFailed'),
          'error',
        );
      },
    });
  }

  // ── Rename ─────────────────────────────────────────────────────────────────

  protected renameDisplayName(name: string): void {
    const entry = this.entry();
    if (!entry) {
      return;
    }
    const key = this.projectKey();
    this.renameBusy.set(true);
    this.actions.rename(key, entry, name, entry.revision ?? undefined).subscribe({
      next: (renamed) => {
        this.renameBusy.set(false);
        this.renaming.set(false);
        this.patchName(name, renamed.revision);
        // Undo renames back; the etag is the revision the rename produced.
        this.undo.offer(this.transloco.translate('templates.toast.renamed', { from: entry.name, to: name }), () =>
          this.actions.rename(key, entry, entry.name, renamed.revision).pipe(tap((back) => this.patchName(entry.name, back.revision))),
        );
      },
      error: (err: unknown) => {
        this.renameBusy.set(false);
        this.toasts.show(
          this.transloco.translate(err instanceof HttpErrorResponse && err.status === 409 ? 'templates.toast.renameConflict' : 'templates.toast.renameFailed', { name: entry.name }),
          'error',
        );
      },
    });
  }

  /** The new name and revision, without touching the edits. */
  private patchName(name: string, revision: number | undefined): void {
    this.detail.update((d) => (d ? { ...d, displayName: name, revision: revision ?? d.revision } : d));
    this.changed.emit();
    this.refresh?.notify();
  }

  protected onUidChanged(): void {
    this.load(this.projectKey(), this.uuid(), this.timeTravel.activeRevision());
    this.changed.emit();
    this.refresh?.notify();
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  private load(projectKey: string, uuid: string, revision: number | null): void {
    if (!projectKey || !uuid) {
      return;
    }
    this.content.getDataset(projectKey, uuid, revision).subscribe({
      next: (detail) => this.apply(detail),
      error: () => this.toasts.show(this.transloco.translate('templates.dataset.toast.loadFailed'), 'error'),
    });
  }

  private loadUsages(projectKey: string, uuid: string): void {
    if (!projectKey || !uuid) {
      return;
    }
    this.usages.set(null);
    this.usagesFailed.set(false);
    this.actions.usages(projectKey, uuid).subscribe({
      next: (list) => this.usages.set(list ?? []),
      error: () => this.usagesFailed.set(true),
    });
  }

  private apply(detail: DatasetDetailView): void {
    this.detail.set(detail);
    this.description.set(detail.description ?? '');
    this.sections.set(sectionsOf(detail));
    this.titleEditor.set(detail.titleEditor ?? '');
    this.store.resetTemplates(detail);
    this.diagnostics.set([]);
    this.saveError.set(null);
  }
}
