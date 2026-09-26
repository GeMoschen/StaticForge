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
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, debounceTime, EMPTY, map, of, Subject, switchMap } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfOctlEditorComponent } from '../../shared/components/sf-octl-editor.component';
import { SfUidRenameComponent } from '../../shared/components/sf-uid-rename.component';
import { ChannelsService } from '../channels/channels.service';
import type { ContentDefinition, EditorDefinition } from '../forms/form.model';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { sortDiagnostics } from '../templates/inheritance.util';
import { TemplatesService } from '../templates/templates.service';
import { ContentService, etagFor, type DatasetDetailView, type Diagnostic } from './content.service';
import {
  firstPositioned,
  readRecordTemplateSources,
  recordTemplateChannels,
  recordTemplateErrorsOf,
  recordTemplateFields,
  recordTemplateMetaHelpers,
  recordTemplatesDiffer,
  recordTemplatesForSave,
  type RecordTemplateChannel,
  type RecordTemplateHelper,
} from './record-template.util';

type ChannelView = components['schemas']['ChannelView'];
type BrokenRecordSet = components['schemas']['BrokenRecordSet'];

/** How long record template typing pauses before it is checked (the Templates store's pace). */
const OCTL_VALIDATE_DEBOUNCE_MS = 300;

/** One live check of a record template: the source as typed, against the schema (CDL) as edited. */
interface RecordTemplateValidation {
  key: string;
  datasetUuid: string;
  channel: string;
  source: string;
  contentDefinition: string;
}

/**
 * A dataset in the Templates store (M19.4.1, M25.5.2): the CDL declaring every record's fields, with live
 * validation (`kind=DATASET`, so a `body` is flagged exactly as the save would reject it), the optional title
 * editor naming records, a description, the dataset's record count with a link to its records — and one
 * **record template** tab per channel: the OCTL one record renders with wherever a record set is rendered
 * (`$CMS_VALUE(recordset:…)$`, a reference editor pointing at a set).
 *
 * <p>Schema and record templates save together, as one revision, so a renamed field and the template reading it
 * change at once. A rejected template keeps the edited source and shows its diagnostics in its tab; a save that
 * leaves set queries invalid lists those sets. Deleting is disabled while records exist — the server refuses it
 * too. Datasets are a developer's artifact: everyone else, and everyone in time travel, sees them read-only.
 */
@Component({
  selector: 'sf-dataset-schema-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SfButtonComponent, SfFieldComponent, SfOctlEditorComponent, SfUidRenameComponent],
  templateUrl: './dataset-schema-editor.component.html',
  styleUrl: './dataset-schema-editor.component.scss',
})
export class DatasetSchemaEditorComponent {
  readonly projectKey = input.required<string>();
  readonly uuid = input.required<string>();

  /** Saved, renamed or deleted: the templates tree should reload. */
  readonly changed = output<void>();
  readonly deleted = output<void>();

  private readonly content = inject(ContentService);
  private readonly templates = inject(TemplatesService);
  private readonly channelsService = inject(ChannelsService);
  private readonly toasts = inject(ToastService);
  private readonly timeTravel = inject(TimeTravelStore);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  private readonly octlEditor = viewChild(SfOctlEditorComponent);

  protected readonly detail = signal<DatasetDetailView | null>(null);
  protected readonly displayName = signal('');
  protected readonly description = signal('');
  protected readonly contentDefinition = signal('');
  protected readonly titleEditor = signal('');
  protected readonly diagnostics = signal<Diagnostic[]>([]);
  protected readonly saving = signal(false);
  protected readonly validating = signal(false);
  private validateTimer: ReturnType<typeof setTimeout> | null = null;

  /** The project's channels (for the record template tabs). */
  private readonly channels = signal<ChannelView[]>([]);
  /** The record templates as edited, channel → source. */
  protected readonly recordTemplates = signal<Record<string, string>>({});
  /** Per channel: the live check's findings while typing (fields included), or what the last save reported. */
  protected readonly recordTemplateDiagnostics = signal<Record<string, Diagnostic[]>>({});
  /** Sets whose stored query the last save left invalid (`brokenRecordSets`); dismissible. */
  protected readonly brokenRecordSets = signal<BrokenRecordSet[]>([]);
  /** The open tab: `null` is the schema, otherwise a channel key. */
  protected readonly activeChannel = signal<string | null>(null);

  /** Typed sources to check; `null` drops a pending check (a save answers with the full diagnostics). */
  private readonly recordTemplateValidation = new Subject<RecordTemplateValidation | null>();

  protected readonly hasErrors = computed(() => this.diagnostics().some((d) => d.severity === 'ERROR'));

  protected readonly canEdit = inject(ProjectPermissionsStore).canEditTemplates;

  /** The stored record templates, channel → source. */
  private readonly storedRecordTemplates = computed(() => readRecordTemplateSources(this.detail()?.channelTemplates));

  protected readonly channelTabs = computed<RecordTemplateChannel[]>(() =>
    recordTemplateChannels(this.channels(), this.storedRecordTemplates()),
  );

  /** The open channel tab, or `null` on the schema tab. */
  protected readonly activeChannelTab = computed(() => {
    const key = this.activeChannel();
    return key == null ? null : (this.channelTabs().find((c) => c.key === key) ?? null);
  });

  protected readonly activeSource = computed(() => {
    const key = this.activeChannel();
    return key == null ? '' : (this.recordTemplates()[key] ?? '');
  });

  protected readonly activeDiagnostics = computed(() => {
    const key = this.activeChannel();
    return key == null ? [] : (this.recordTemplateDiagnostics()[key] ?? []);
  });

  /** Whether the schema tab's fields differ from the stored dataset. */
  protected readonly schemaDirty = computed(() => {
    const d = this.detail();
    return (
      !!d &&
      (this.displayName() !== (d.displayName ?? '') ||
        this.description() !== (d.description ?? '') ||
        this.contentDefinition() !== (d.contentDefinition ?? '') ||
        this.titleEditor() !== (d.titleEditor ?? ''))
    );
  });

  /** The channels whose record template differs from the stored one. */
  protected readonly dirtyChannels = computed(() => {
    const edited = this.recordTemplates();
    const stored = this.storedRecordTemplates();
    return new Set(
      this.channelTabs()
        .map((c) => c.key)
        .filter((key) => recordTemplatesDiffer({ [key]: edited[key] ?? '' }, { [key]: stored[key] ?? '' })),
    );
  });

  /** Anything to save: schema fields or any record template. */
  protected readonly dirty = computed(() => this.schemaDirty() || this.dirtyChannels().size > 0);

  /** Error counts per channel, for the tab badges. */
  protected readonly errorCounts = computed(() => {
    const out: Record<string, number> = {};
    for (const [channel, list] of Object.entries(this.recordTemplateDiagnostics())) {
      out[channel] = list.filter((d) => d.severity === 'ERROR').length;
    }
    return out;
  });

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
    walk(this.savedEditors());
    return out;
  });

  /** Click-to-insert: the fields of the schema as edited, then the record meta names. */
  protected readonly fieldHelpers = computed(() => recordTemplateFields(this.contentDefinition(), this.savedEditors()));
  protected readonly metaHelpers: readonly RecordTemplateHelper[] = recordTemplateMetaHelpers();

  protected readonly loopSnippet = computed(() => {
    const uid = this.detail()?.uid ?? 'dataset';
    const first = this.textEditors()[0]?.name ?? 'field';
    return `$CMS_FOR(item : dataset:${uid}, sort="${first}")$ $CMS_VALUE(item.${first})$ $CMS_END_FOR$`;
  });

  constructor() {
    // Live check of the open record template: debounced, a newer keystroke cancels the one in flight. The
    // server compiles it as this dataset's record template against the CDL as edited (`datasetUuid` +
    // `contentDefinition`), so an undeclared field (SF-TPL-0103) or SF-TPL-0122 shows while typing — the
    // diagnostics a save would report.
    this.recordTemplateValidation
      .pipe(
        debounceTime(OCTL_VALIDATE_DEBOUNCE_MS),
        switchMap((request) =>
          request
            ? this.templates
                .validateOctl(request.key, {
                  source: request.source,
                  channelKey: request.channel,
                  datasetUuid: request.datasetUuid,
                  contentDefinition: request.contentDefinition,
                })
                .pipe(
                  catchError(() => of(null)),
                  // Carry the request along: the answer belongs to the channel that was typed in.
                  map((response) => ({ request, response })),
                )
            : EMPTY,
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ request, response }) => {
        const current =
          (this.recordTemplates()[request.channel] ?? '') === request.source &&
          this.contentDefinition() === request.contentDefinition;
        if (response && current) {
          this.recordTemplateDiagnostics.update((all) => ({
            ...all,
            [request.channel]: sortDiagnostics(response.diagnostics ?? []) as Diagnostic[],
          }));
        }
      });

    effect(() => {
      const key = this.projectKey();
      const uuid = this.uuid();
      const revision = this.timeTravel.activeRevision();
      untracked(() => {
        this.activeChannel.set(null);
        this.brokenRecordSets.set([]);
        this.load(key, uuid, revision);
      });
    });

    effect(() => {
      const key = this.projectKey();
      untracked(() => this.loadChannels(key));
    });
  }

  protected onNameInput(event: Event): void {
    this.displayName.set((event.target as HTMLInputElement).value);
  }

  protected onDescriptionInput(event: Event): void {
    this.description.set((event.target as HTMLTextAreaElement).value);
  }

  protected onTitleEditorChange(event: Event): void {
    this.titleEditor.set((event.target as HTMLSelectElement).value);
  }

  /** Live validation while typing, debounced; the same restrictions the save enforces. */
  protected onCdlInput(event: Event): void {
    this.contentDefinition.set((event.target as HTMLTextAreaElement).value);
    if (this.validateTimer) {
      clearTimeout(this.validateTimer);
    }
    this.validateTimer = setTimeout(() => this.validate(), 400);
  }

  protected validate(): void {
    this.validating.set(true);
    this.content.validateCdl(this.projectKey(), this.contentDefinition()).subscribe({
      next: (res) => {
        this.validating.set(false);
        this.diagnostics.set(res.diagnostics ?? []);
      },
      error: () => this.validating.set(false),
    });
  }

  /** Opens the schema tab (`null`) or a channel's record template tab. */
  selectTab(channel: string | null): void {
    const previous = this.activeChannel();
    this.activeChannel.set(channel);
    // Opening a template re-checks it: the schema may have changed on the CDL tab since it was last checked.
    if (channel != null && channel !== previous && (this.recordTemplates()[channel] ?? '').trim() !== '') {
      this.checkRecordTemplate(channel, this.recordTemplates()[channel]);
    }
  }

  /** An edit of the open record template. */
  onRecordTemplateInput(source: string): void {
    const channel = this.activeChannel();
    if (channel == null || !this.canEdit()) {
      return;
    }
    this.recordTemplates.update((all) => ({ ...all, [channel]: source }));
    this.checkRecordTemplate(channel, source);
  }

  /** Queues a live check of one channel's record template against the schema as edited (developers only). */
  private checkRecordTemplate(channel: string, source: string): void {
    const datasetUuid = this.detail()?.uuid;
    if (!datasetUuid || !this.canEdit()) {
      return;
    }
    this.recordTemplateValidation.next({
      key: this.projectKey(),
      datasetUuid,
      channel,
      source,
      contentDefinition: this.contentDefinition(),
    });
  }

  protected insertHelper(helper: RecordTemplateHelper): void {
    this.octlEditor()?.insert(helper.snippet, helper.caret);
  }

  protected dismissBrokenRecordSets(): void {
    this.brokenRecordSets.set([]);
  }

  /** Saves schema and record templates together: one request, one revision. */
  save(): void {
    const current = this.detail();
    if (!current?.uuid || !this.canEdit() || !this.dirty() || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.brokenRecordSets.set([]);
    this.recordTemplateValidation.next(null);
    this.content
      .updateDataset(
        this.projectKey(),
        current.uuid,
        {
          displayName: this.displayName(),
          contentDefinition: this.contentDefinition(),
          titleEditor: this.titleEditor() || undefined,
          description: this.description(),
          channelTemplates: recordTemplatesForSave(this.recordTemplates()),
        },
        etagFor(current.revision ?? 0),
      )
      .subscribe({
        next: (saved) => {
          this.saving.set(false);
          this.apply(saved);
          this.recordTemplateDiagnostics.set(saved.recordTemplateDiagnostics ?? {});
          this.brokenRecordSets.set(saved.brokenRecordSets ?? []);
          const broken = saved.brokenRecordSets?.length ?? 0;
          this.toasts.show(
            broken > 0
              ? `Dataset saved — ${broken} record ${broken === 1 ? 'set needs' : 'sets need'} a query fix.`
              : 'Dataset saved',
            broken > 0 ? 'info' : 'success',
          );
          this.changed.emit();
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.showSaveError(err, current.uuid!);
        },
      });
  }

  protected remove(): void {
    const current = this.detail();
    if (!current?.uuid || !this.canEdit() || (current.recordCount ?? 0) > 0) {
      return;
    }
    if (!window.confirm(`Delete the dataset "${current.displayName ?? current.uid}"?`)) {
      return;
    }
    this.content.deleteDataset(this.projectKey(), current.uuid).subscribe({
      next: () => {
        this.toasts.show('Dataset deleted', 'success');
        this.deleted.emit();
      },
      error: (err: unknown) => {
        const body = err instanceof HttpErrorResponse ? ((err.error ?? {}) as { recordCount?: number }) : {};
        this.toasts.show(
          body.recordCount
            ? `The dataset still has ${body.recordCount} records — delete them first.`
            : 'Could not delete the dataset — a template may still loop it.',
          'error',
        );
      },
    });
  }

  protected onUidChanged(): void {
    this.load(this.projectKey(), this.uuid(), this.timeTravel.activeRevision());
    this.changed.emit();
  }

  /**
   * A rejected save keeps every edit. Record template errors (`422` with `channel`) open the first failing
   * channel and put the caret on the error; schema errors show under the CDL.
   */
  private showSaveError(err: unknown, uuid: string): void {
    if (!(err instanceof HttpErrorResponse)) {
      this.toasts.show('Could not save the dataset — try again in a moment.', 'error');
      return;
    }
    const templateErrors = recordTemplateErrorsOf(err);
    if (templateErrors) {
      this.diagnostics.set([]);
      this.recordTemplateDiagnostics.update((all) => ({ ...all, ...templateErrors.byChannel }));
      this.activeChannel.set(templateErrors.channel);
      this.revealFirstDiagnostic(templateErrors.byChannel[templateErrors.channel] ?? []);
      this.toasts.show(`The ${templateErrors.channel} record template has errors — nothing was saved.`, 'error');
      return;
    }
    const body = (err.error ?? {}) as { diagnostics?: Diagnostic[]; detail?: string };
    if (Array.isArray(body.diagnostics) && body.diagnostics.length > 0) {
      this.diagnostics.set(body.diagnostics);
      this.activeChannel.set(null);
      this.toasts.show('The schema has errors — see the diagnostics below.', 'error');
      return;
    }
    if (err.status === 409) {
      this.toasts.show('Someone else saved this dataset — reloading the current version.', 'error');
      this.load(this.projectKey(), uuid, null);
      return;
    }
    this.toasts.show(body.detail || 'Could not save the dataset — try again in a moment.', 'error');
  }

  /** After the tab switch renders, moves the caret to the first positioned diagnostic. */
  private revealFirstDiagnostic(diagnostics: readonly Diagnostic[]): void {
    const target = firstPositioned(diagnostics);
    if (!target?.line) {
      return;
    }
    afterNextRender(() => this.octlEditor()?.goTo(target), { injector: this.injector });
  }

  private load(projectKey: string, uuid: string, revision: number | null): void {
    if (!projectKey || !uuid) {
      return;
    }
    this.content.getDataset(projectKey, uuid, revision).subscribe({
      next: (detail) => this.apply(detail),
      error: () => this.toasts.show('Could not load the dataset — try again in a moment.', 'error'),
    });
  }

  private loadChannels(projectKey: string): void {
    if (!projectKey) {
      return;
    }
    // Without the channel list the tabs still show every channel that has a stored template.
    this.channelsService.list(projectKey).subscribe({
      next: (list) => this.channels.set(list ?? []),
      error: () => this.channels.set([]),
    });
  }

  private apply(detail: DatasetDetailView): void {
    this.detail.set(detail);
    this.displayName.set(detail.displayName ?? '');
    this.description.set(detail.description ?? '');
    this.contentDefinition.set(detail.contentDefinition ?? '');
    this.titleEditor.set(detail.titleEditor ?? '');
    this.recordTemplates.set(readRecordTemplateSources(detail.channelTemplates));
    this.diagnostics.set([]);
    this.recordTemplateDiagnostics.set({});
  }

  private savedEditors(): EditorDefinition[] | undefined {
    return (this.detail()?.compiledDefinition as unknown as ContentDefinition | undefined)?.editors;
  }
}
