import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormGroup } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin, Subscription } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../core/api/api.client';
import { AuthStore } from '../../core/auth/auth.store';
import { roleRank } from '../../core/auth/auth.guard';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfRelativeTimePipe } from '../../shared/pipes/sf-relative-time.pipe';
import { FormBuilderService } from '../forms/form-builder.service';
import type { ContentDefinition } from '../forms/form.model';
import type { EditingLocale } from '../forms/l10n.util';
import { SfContentFormComponent } from '../forms/sf-content-form.component';
import { ConflictDrawerComponent } from '../pages/conflict-drawer.component';
import { diffFields, mergePayload } from '../pages/conflict-util';
import type { FieldResolveEvent, ResolveMode } from '../pages/types';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { ContentService, type DatasetDetailView, type RecordDetailView } from './content.service';
import { RecordAutosaveService, type RecordPayload } from './record-autosave.service';

type AssetHistoryEntry = components['schemas']['AssetHistoryEntry'];
type UsageDto = components['schemas']['UsageDto'];

const EMPTY_DEF: ContentDefinition = { editors: [], bodies: [] };

/** A content validation finding (`ContentIssue` on the wire). */
interface ContentIssue {
  path?: string;
  code?: string;
  message?: string;
  kind?: string;
}

/**
 * One dataset record (M19.4.2): the dataset schema rendered through the dynamic form engine, with the
 * page editor's autosave (debounce, `If-Match`, conflict drawer). Completeness findings the server
 * returns with a save (an empty required field) and structural ones it rejects a save with are shown
 * next to the form. The record's history lets you time-travel to any of its versions; its usages list
 * the pages and templates that read it. Everything is read-only while time travelling.
 */
@Component({
  selector: 'sf-record-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    SfButtonComponent,
    SfIconComponent,
    SfRelativeTimePipe,
    SfContentFormComponent,
    ConflictDrawerComponent,
  ],
  providers: [RecordAutosaveService],
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
  private readonly auth = inject(AuthStore);
  private readonly timeTravel = inject(TimeTravelStore);
  protected readonly autosave = inject(RecordAutosaveService);

  protected readonly timeTravelling = this.timeTravel.isTimeTravel;
  protected readonly loading = signal(false);
  protected readonly record = signal<RecordDetailView | null>(null);
  protected readonly dataset = signal<DatasetDetailView | null>(null);
  protected readonly definition = signal<ContentDefinition>(EMPTY_DEF);
  protected readonly form = signal<FormGroup | null>(null);

  /**
   * The content object as stored — every language, not just the one being edited. The form binds
   * one language; the fallback hint needs the others (M24.4.1).
   */
  protected readonly storedContent = signal<Record<string, unknown>>({});
  protected readonly displayName = signal('');
  protected readonly issues = signal<ContentIssue[]>([]);
  protected readonly history = signal<AssetHistoryEntry[]>([]);
  protected readonly usages = signal<UsageDto[]>([]);
  protected readonly panel = signal<'issues' | 'history' | 'usages'>('issues');

  private formSubscription: Subscription | null = null;

  private readonly canEditRole = computed(() => roleRank(this.auth.roleFor(this.projectKey())) >= roleRank('EDITOR'));
  protected readonly readOnly = computed(() => this.timeTravelling() || !this.canEditRole());
  /** With a title editor the record's name follows that field; otherwise it is edited here. */
  protected readonly nameFromTitle = computed(() => !!this.dataset()?.titleEditor);

  protected readonly statusLabel = computed(() => {
    if (this.timeTravelling()) {
      return 'Viewing revision ' + (this.timeTravel.activeRevision() ?? '—');
    }
    switch (this.autosave.saveState()) {
      case 'dirty':
        return 'Unsaved';
      case 'saving':
        return 'Saving…';
      case 'saved':
        return 'Saved ' + (this.autosave.lastSavedAt() ?? '');
      case 'error':
        return 'Save failed';
      default:
        return '';
    }
  });

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
      this.formSubscription = rebound.form.valueChanges.subscribe(() => this.autosave.markDirty());
    }
    this.form.set(rebound.form);
  }

  ngOnDestroy(): void {
    this.autosave.flush();
    this.formSubscription?.unsubscribe();
  }

  protected onNameInput(event: Event): void {
    this.displayName.set((event.target as HTMLInputElement).value);
    this.autosave.markDirty();
  }

  protected saveNow(): void {
    this.autosave.flush();
  }

  protected showPanel(panel: 'issues' | 'history' | 'usages'): void {
    this.panel.set(panel);
  }

  protected viewRevision(revision: number | undefined): void {
    if (revision != null) {
      this.timeTravel.enter(revision);
    }
  }

  protected leaveTimeTravel(): void {
    this.timeTravel.exit();
  }

  protected deleteRecord(): void {
    const record = this.record();
    if (!record?.uuid || this.readOnly()) {
      return;
    }
    const name = record.displayName ?? record.uid ?? 'this record';
    const referenced = this.usages().length > 0;
    const question = referenced
      ? `"${name}" is used by ${this.usages().length} page(s) or template(s). Delete it anyway?`
      : `Delete "${name}"? You can restore it from its history.`;
    if (!window.confirm(question)) {
      return;
    }
    this.api.deleteAsset(this.projectKey(), record.uuid, referenced).subscribe({
      next: () => {
        this.toasts.show('Record deleted', 'success');
        this.load(this.projectKey(), record.uuid!, null);
      },
      error: () => this.toasts.show('Could not delete the record — try again in a moment.', 'error'),
    });
  }

  protected restoreRecord(): void {
    const record = this.record();
    const lastLive = this.history().find((entry) => !entry.deleted);
    if (!record?.uuid || lastLive?.revision == null || this.timeTravelling()) {
      return;
    }
    this.api.restoreAsset(this.projectKey(), record.uuid, { fromRevision: lastLive.revision }).subscribe({
      next: () => {
        this.toasts.show('Record restored', 'success');
        this.load(this.projectKey(), record.uuid!, null);
      },
      error: () => this.toasts.show('Could not restore the record — try again in a moment.', 'error'),
    });
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
    return this.nameFromTitle() ? { content } : { content, displayName: this.displayName().trim() || undefined };
  }

  private load(projectKey: string, uuid: string, revision: number | null): void {
    if (!projectKey || !uuid) {
      return;
    }
    this.loading.set(true);
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
            this.apply(record, null);
          },
        });
      },
      error: (err) => {
        this.loading.set(false);
        this.record.set(null);
        const notThen = err instanceof HttpErrorResponse && err.status === 404 && revision != null;
        this.toasts.show(
          notThen ? 'This record did not exist at that revision.' : 'Could not load the record — try again in a moment.',
          'error',
        );
      },
    });
  }

  private apply(record: RecordDetailView, dataset: DatasetDetailView | null): void {
    this.record.set(record);
    this.dataset.set(dataset);
    this.displayName.set(record.displayName ?? '');
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
      this.formSubscription = form.valueChanges.subscribe(() => this.autosave.markDirty());
    }
    this.form.set(form);
  }

  private onSaved(view: RecordDetailView): void {
    this.issues.set((view.issues ?? []) as ContentIssue[]);
    if (view.issues && view.issues.length > 0) {
      this.panel.set('issues');
    }
    this.record.update((current) => (current ? { ...current, ...view } : view));
    if (this.nameFromTitle()) {
      this.displayName.set(view.displayName ?? '');
    }
  }

  private onSaveError(err: unknown): void {
    if (!(err instanceof HttpErrorResponse)) {
      this.toasts.show('Could not save the record — try again in a moment.', 'error');
      return;
    }
    const body = (err.error ?? {}) as { issues?: ContentIssue[]; detail?: string };
    if (err.status === 422 && Array.isArray(body.issues)) {
      this.issues.set(body.issues);
      this.panel.set('issues');
      this.toasts.show('Some values are invalid — see the messages next to the form.', 'error');
      return;
    }
    if (err.status === 403) {
      this.toasts.show('You need the editor role to change records.', 'error');
      return;
    }
    this.toasts.show(body.detail ?? 'Could not save the record — try again in a moment.', 'error');
  }

  private onRefetched(view: RecordDetailView, mode: ResolveMode): void {
    if (mode === 'theirs') {
      this.record.set(view);
      this.displayName.set(view.displayName ?? '');
      this.buildForm(this.definition(), view.content);
      return;
    }
    // "Keep mine": adopt the new revision, keep the local values, save them over it.
    this.record.update((current) => (current ? { ...current, revision: view.revision } : view));
    this.autosave.markDirty();
    this.autosave.flush();
  }
}
