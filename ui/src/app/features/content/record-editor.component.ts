import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { forkJoin, Subscription } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../core/api/api.client';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfBannerComponent } from '../../shared/components/layout/sf-banner.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfSectionComponent } from '../../shared/components/layout/sf-section.component';
import { SfSkeletonComponent } from '../../shared/components/layout/sf-skeleton.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
// Through the barrel: the forms module is an import cycle that only evaluates when entered there.
import { FormBuilderService, SfContentFormComponent, type ContentDefinition, type EditingLocale } from '../forms';
import { RuleBinding, mergeFindings } from '../forms/rules/rule-binding';
import { ConflictDrawerComponent } from '../pages/conflict-drawer.component';
import { diffFields, mergePayload } from '../pages/conflict-util';
import type { FieldResolveEvent, ResolveMode } from '../pages/types';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { storeFolderPath } from './content-tree.util';
import { ContentStoreRefresh } from './content-store-refresh.service';
import { ContentService, type DatasetDetailView, type RecordDetailView } from './content.service';
import { MoveTargetDialogComponent } from './move-target-dialog.component';
import { RecordAutosaveService, type RecordPayload } from './record-autosave.service';
import type { ReleaseMode } from '../release/release-choice.util';
import { RecordActionsService } from './record-actions.service';
import { RecordEditorHeaderComponent } from './record-editor-header.component';
import { RecordSidePanelComponent, checkCounts, type ContentIssue, type RecordSidePanelTab } from './record-side-panel.component';
import { recordTitle } from './record-title.util';
import { useFrameItem } from '../../core/frame/use-frame-item';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import { autosaveEditorState, autosaveStatus } from '../../core/editor/autosave-editor-state';
import type { Crumb } from '../../core/frame/breadcrumb.util';

/** Why the record is not on screen: it does not exist, did not exist at the revision on screen, or could not be read. */
type LoadError = 'notFound' | 'revision' | 'failed';

type AssetHistoryEntry = components['schemas']['AssetHistoryEntry'];
type UsageDto = components['schemas']['UsageDto'];

const EMPTY_DEF: ContentDefinition = { editors: [], bodies: [] };

/**
 * One dataset record (M19.4.2): the dataset schema rendered through the dynamic form engine, with the
 * page editor's autosave (debounce, `If-Match`, conflict drawer). Completeness findings the server
 * returns with a save (an empty required field) and structural ones it rejects a save with are shown
 * next to the form. The record's history lets you time-travel to any of its versions; its usages list
 * the pages and templates that read it. Everything is read-only while time travelling.
 *
 * <p>A record lives in a record set (M25): the breadcrumb reads folder › set › record, and "Move…"
 * offers only the other sets of the record's own dataset — the only places the server accepts.
 */
@Component({
  selector: 'sf-record-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RecordEditorHeaderComponent,
    RecordSidePanelComponent,
    SfBannerComponent,
    SfContentFormComponent,
    SfEmptyStateComponent,
    SfPageHeaderComponent,
    SfSectionComponent,
    SfSkeletonComponent,
    ConflictDrawerComponent,
    MoveTargetDialogComponent,
    TranslocoPipe,
  ],
  providers: [RecordAutosaveService, RecordActionsService],
  templateUrl: './record-editor.component.html',
  styleUrl: './record-editor.component.scss',
})
export class RecordEditorComponent implements OnDestroy {
  readonly projectKey = input.required<string>();
  readonly recordUuid = input.required<string>();

  private readonly content = inject(ContentService);
  /** The language being edited (M24.4.1); `null` in a project without languages. */
  protected readonly editingLocale = inject(EditingLocaleStore).binding;

  private readonly localesForLabels = inject(LocalesStore);

  /** Language tag to label, so the form says "from Deutsch" rather than "from de". */
  protected readonly localeLabels = computed<Record<string, string>>(() =>
    Object.fromEntries(
      this.localesForLabels.locales().map((locale) => [locale.code ?? '', locale.label ?? locale.code ?? '']),
    ),
  );

  private readonly api = inject(ApiClient);
  private readonly forms = inject(FormBuilderService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);
  private readonly timeTravel = inject(TimeTravelStore);
  private readonly refresh = inject(ContentStoreRefresh, { optional: true });
  protected readonly autosave = inject(RecordAutosaveService);
  protected readonly actions = inject(RecordActionsService);

  protected readonly timeTravelling = this.timeTravel.isTimeTravel;
  protected readonly loading = signal(false);
  protected readonly loadError = signal<LoadError | null>(null);
  protected readonly record = signal<RecordDetailView | null>(null);
  protected readonly dataset = signal<DatasetDetailView | null>(null);
  protected readonly definition = signal<ContentDefinition>(EMPTY_DEF);
  protected readonly form = signal<FormGroup | null>(null);

  /**
   * The content object as stored — every language, not just the one being edited. The form binds
   * one language; the fallback hint needs the others (M24.4.1).
   */
  protected readonly storedContent = signal<Record<string, unknown>>({});
  protected readonly issues = signal<ContentIssue[]>([]);
  protected readonly history = signal<AssetHistoryEntry[]>([]);
  protected readonly usages = signal<UsageDto[]>([]);
  /** The open tab of the Checks / Used by drawer; `null` while it is closed. */
  protected readonly panel = signal<RecordSidePanelTab | null>(null);

  /** The record's Content folder, store-relative, for the breadcrumb (`/` at the store root). */
  protected readonly folderPath = computed(() => storeFolderPath(this.record()?.folderPath));

  protected readonly datasetName = computed(() => this.dataset()?.displayName ?? this.record()?.datasetUid ?? '');

  /** The record's name: its display name, never its UUID — a label with the dataset's name stands in for a nameless one. */
  protected readonly title = computed(() => {
    const dataset = this.datasetName();
    const fallback = dataset
      ? this.transloco.translate('content.record.title.untitledIn', { dataset })
      : this.transloco.translate('content.record.title.untitled');
    return recordTitle(this.record(), fallback);
  });

  /** The folder and record set above the record, for the breadcrumb (the area crumb stands for the store root). */
  private readonly trail = computed<Crumb[]>(() => {
    const record = this.record();
    const key = this.projectKey();
    if (!record) {
      return [];
    }
    const crumbs: Crumb[] = [];
    const path = this.folderPath();
    if (record.folderUuid && path !== '/') {
      crumbs.push({
        id: `folder:${record.folderUuid}`,
        label: path.replace(/^\/|\/$/g, ''),
        link: ['/p', key, 'content'],
        queryParams: { folder: record.folderUuid },
      });
    }
    if (record.recordSet?.uuid) {
      crumbs.push({
        id: `set:${record.recordSet.uuid}`,
        label: record.recordSet.displayName ?? record.recordSet.uid ?? '',
        link: ['/p', key, 'content', 'sets', record.recordSet.uuid],
      });
    }
    return crumbs;
  });

  /** What the Checks button counts. */
  protected readonly checks = computed(() => checkCounts(this.shownIssues()));

  private formSubscription: Subscription | null = null;

  /** Live editor rules on the form (M33.8): findings, fills and field states of the `edit` scope. */
  protected readonly rules = new RuleBinding((request) => this.api.evaluateRules(this.projectKey(), request));

  /** What the form shows: the live findings (or the last save's until they arrive) and a rejected save's. */
  protected readonly shownIssues = computed<ContentIssue[]>(() => {
    const live = this.rules.evaluated() ? this.rules.findings() : this.issues();
    return mergeFindings(live, this.autosave.rejected()) as ContentIssue[];
  });

  private readonly canEditContent = inject(ProjectPermissionsStore).canEditContent;
  protected readonly readOnly = computed(() => this.timeTravelling() || !this.canEditContent());
  /** The field that names the record; without one the record keeps its uuid as its name (M25). */
  protected readonly titleEditor = computed(() => this.dataset()?.titleEditor ?? null);

  /** Why the record cannot be edited; the save status is for a record that can. */
  protected readonly readOnlyLabel = computed(() =>
    this.timeTravelling()
      ? this.transloco.translate('content.record.status.revision', { revision: this.timeTravel.activeRevision() ?? '—' })
      : '',
  );
  /** The save status (M35.13): the same words and look in every editor. */
  protected readonly status = computed(() => autosaveStatus(this.autosave));

  /** The conflict's changed top-level fields, for the drawer summary. */
  protected readonly changedKeys = computed(() => {
    const conflict = this.autosave.conflict();
    return conflict?.base != null && conflict?.theirs != null ? diffFields(conflict.base, conflict.theirs).map((f) => f.path) : [];
  });

  /** The snippet that reads this record in a template. */
  protected readonly snippet = computed(() => {
    const uid = this.record()?.uid ?? 'record';
    const first = this.definition().editors?.find((e) => e.type !== 'GROUP')?.name ?? 'field';
    return `$CMS_VALUE(record:${uid}.${first})$`;
  });

  constructor() {
    // The open record is an editor for the frame (M35.13): Ctrl+S saves it, and leaving it with an edit that could not
    // be written asks first.
    const unregister = inject(ActiveEditorService).register(
      autosaveEditorState({
        name: () => (this.record() ? this.title() : ''),
        autosave: this.autosave as never,
        reload: () => this.load(this.projectKey(), this.recordUuid(), null),
      }),
    );
    inject(DestroyRef).onDestroy(unregister);
    // The breadcrumb ends with the open record, and the History drawer shows its versions (M35.12).
    useFrameItem(() => {
      const record = this.record();
      return record ? { label: this.title(), trail: this.trail(), ...(record.uuid ? { asset: { uuid: record.uuid } } : {}) } : null;
    });
    this.actions.bind({
      projectKey: this.projectKey,
      record: this.record,
      readOnly: this.readOnly,
      history: this.history,
      usages: this.usages,
      reload: (uuid) => this.load(this.projectKey(), uuid, null),
      title: this.title,
      afterDelete: (record) => this.leaveAfterDelete(record),
    });
    this.autosave.setPayloadProvider(() => this.payload());
    this.autosave.setRefetchHandler((view, mode) => this.onRefetched(view, mode));
    this.autosave.setSavedHandler((view) => this.onSaved(view));
    this.autosave.setErrorHandler((err) => this.onSaveError(err));

    effect(() => {
      const key = this.projectKey();
      const uuid = this.recordUuid();
      const revision = this.timeTravel.activeRevision();
      untracked(() => this.load(key, uuid, revision));
    });

    // A form's controls hold the language it was built for, so a language switch has to rebuild it
    // — otherwise the editors keep editing the previous language and the next save writes those
    // values into the language now selected (M24.4.1).
    effect(
      () => {
        const binding = this.editingLocale();
        untracked(() => this.rebindForm(binding));
      },
      { allowSignalWrites: true },
    );
  }

  /** Re-binds the form to another language, keeping unsaved edits in the one being left behind. */
  private rebindForm(binding: EditingLocale | null): void {
    const form = this.form();
    if (!form || this.forms.bindingOf(form)?.locale === (binding?.locale ?? null)) {
      return;
    }
    this.formSubscription?.unsubscribe();
    const rebound = this.forms.rebind(this.definition(), form, binding);
    this.storedContent.set(rebound.content);
    if (this.readOnly() || this.record()?.deleted === true) {
      rebound.form.disable();
    } else {
      this.formSubscription = rebound.form.valueChanges.subscribe(() => this.onFormChanged());
    }
    this.form.set(rebound.form);
    this.bindRules(rebound.form);
  }

  ngOnDestroy(): void {
    this.autosave.flush();
    this.formSubscription?.unsubscribe();
    this.rules.dispose();
  }

  protected saveNow(): void {
    this.autosave.flush();
  }

  /** Re-reads the release bar whenever the record was saved (M27.6.1). */
  protected readonly releaseRefresh = computed(
    () => `${this.autosave.revision() ?? ''}|${this.record()?.revision ?? ''}|${this.record()?.deleted ?? ''}`,
  );

  /** A discard wrote the released version back as the draft: reload the record. */
  protected onReleaseChanged(mode: ReleaseMode): void {
    const uuid = this.record()?.uuid;
    this.refresh?.notify();
    if (mode === 'discard' && uuid && !this.timeTravelling()) {
      this.load(this.projectKey(), uuid, null);
    }
  }

  protected leaveTimeTravel(): void {
    this.timeTravel.exit();
  }

  protected toggleChecks(): void {
    this.panel.update((tab) => (tab === 'issues' ? null : 'issues'));
  }

  /** A deleted record has nothing left to edit: back to its set, or the Content area for a record outside any set. */
  private leaveAfterDelete(record: RecordDetailView): void {
    const set = record.recordSet?.uuid;
    void this.router.navigate(set ? ['/p', this.projectKey(), 'content', 'sets', set] : ['/p', this.projectKey(), 'content']);
  }

  /** Reads the record again after a failed read. */
  protected retry(): void {
    this.load(this.projectKey(), this.recordUuid(), this.timeTravel.activeRevision());
  }

  protected openContent(): void {
    void this.router.navigate(['/p', this.projectKey(), 'content']);
  }

  protected onResolve(mode: ResolveMode): void {
    this.autosave.resolveConflict(mode);
  }

  protected onResolveFields(event: FieldResolveEvent): void {
    const conflict = this.autosave.conflict();
    if (!conflict || conflict.base == null || conflict.theirs == null) {
      return;
    }
    const merged = mergePayload(conflict.theirs, this.payload(), event.fields) as Record<string, unknown>;
    this.buildForm(this.definition(), merged['content']);
    this.autosave.resolveFields(conflict.currentRevision);
    this.autosave.flush();
  }

  private payload(): RecordPayload {
    const form = this.form();
    const content = form ? this.forms.valueOf(this.definition(), form) : ((this.record()?.content ?? {}) as Record<string, unknown>);
    return { content };
  }

  private load(projectKey: string, uuid: string, revision: number | null): void {
    if (!projectKey || !uuid) {
      return;
    }
    this.loading.set(true);
    this.loadError.set(null);
    this.issues.set([]);
    this.content.getRecord(projectKey, uuid, revision).subscribe({
      next: (record) => {
        if (!record.datasetUuid) {
          this.loading.set(false);
          this.apply(record, null);
          return;
        }
        forkJoin({
          dataset: this.content.getDataset(projectKey, record.datasetUuid, revision),
          history: this.api.assetHistory(projectKey, uuid),
          usages: this.api.assetUsages(projectKey, uuid),
        }).subscribe({
          next: ({ dataset, history, usages }) => {
            this.loading.set(false);
            this.history.set(history ?? []);
            this.usages.set(usages ?? []);
            this.apply(record, dataset);
          },
          error: () => {
            this.loading.set(false);
            this.record.set(null);
            this.loadError.set('failed');
          },
        });
      },
      error: (err) => {
        this.loading.set(false);
        this.record.set(null);
        const missing = err instanceof HttpErrorResponse && err.status === 404;
        this.loadError.set(missing ? (revision != null ? 'revision' : 'notFound') : 'failed');
      },
    });
  }

  private apply(record: RecordDetailView, dataset: DatasetDetailView | null): void {
    this.record.set(record);
    this.dataset.set(dataset);
    const definition = (dataset?.compiledDefinition as unknown as ContentDefinition | undefined) ?? EMPTY_DEF;
    this.definition.set(definition);
    this.autosave.configure(this.projectKey(), record.uuid ?? '', record.revision ?? null);
    this.buildForm(definition, record.content);
  }

  private buildForm(definition: ContentDefinition, content: unknown): void {
    this.formSubscription?.unsubscribe();
    this.storedContent.set((content ?? {}) as Record<string, unknown>);
    const form = this.forms.build(definition, (content ?? {}) as Record<string, unknown>, this.editingLocale());
    const deleted = this.record()?.deleted === true;
    if (this.readOnly() || deleted) {
      form.disable();
    } else {
      this.formSubscription = form.valueChanges.subscribe(() => this.onFormChanged());
    }
    this.form.set(form);
    this.bindRules(form);
  }

  private onFormChanged(): void {
    this.autosave.markDirty();
    this.rules.changed();
  }

  /** Evaluates the record's rules live while it can be edited (M33.8). */
  private bindRules(form: FormGroup): void {
    const record = this.record();
    const dataset = this.dataset();
    if (this.readOnly() || record?.deleted === true || !record?.uuid || !dataset?.uid) {
      this.rules.unbind();
      return;
    }
    const definition = this.definition();
    const locale = this.editingLocale()?.locale ?? null;
    this.rules.bind({
      form,
      editors: definition.editors ?? [],
      locale,
      content: () => this.forms.valueOf(definition, form),
      request: (content) => ({
        kind: 'RECORD',
        assetUuid: record.uuid,
        datasetUid: dataset.uid,
        content: content as never,
        locale: locale ?? undefined,
      }),
    });
  }

  private onSaved(view: RecordDetailView): void {
    this.issues.set((view.issues ?? []) as ContentIssue[]);
    this.record.update((current) => (current ? { ...current, ...view } : view));
  }

  private onSaveError(err: unknown): void {
    if (!(err instanceof HttpErrorResponse)) {
      this.toasts.show(this.transloco.translate('content.record.toast.saveFailed'), 'error');
      return;
    }
    const body = (err.error ?? {}) as { issues?: ContentIssue[]; detail?: string };
    if (err.status === 422 && Array.isArray(body.issues)) {
      this.issues.set(body.issues);
      this.toasts.show(this.transloco.translate('content.record.toast.invalid'), 'error');
      return;
    }
    if (err.status === 403) {
      this.toasts.show(this.transloco.translate('content.record.toast.forbidden'), 'error');
      return;
    }
    this.toasts.show(body.detail ?? this.transloco.translate('content.record.toast.saveFailed'), 'error');
  }

  private onRefetched(view: RecordDetailView, mode: ResolveMode): void {
    if (mode === 'theirs') {
      this.record.set(view);
      this.buildForm(this.definition(), view.content);
      return;
    }
    // "Keep mine": adopt the new revision, keep the local values, save them over it.
    this.record.update((current) => (current ? { ...current, revision: view.revision } : view));
    this.autosave.markDirty();
    this.autosave.flush();
  }
}
