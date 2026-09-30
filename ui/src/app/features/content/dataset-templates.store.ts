import { DestroyRef, Injectable, computed, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, EMPTY, map, of, Subject, switchMap } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { channelCodeFormat } from '../../shared/code-editor/code-format';
import { EMPTY_SECTIONS, sectionsEqual, type CdlSections } from '../../shared/code-editor/cdl-sections';
import { declaredPaths } from '../../shared/code-editor/completions';
import type { SfTab } from '../../shared/components/sf-tabs.component';
import { ChannelsService } from '../channels/channels.service';
import type { ContentDefinition, EditorDefinition } from '../forms/form.model';
import { sortDiagnostics } from '../templates/inheritance.util';
import { TemplatesService } from '../templates/templates.service';
import type { DatasetDetailView, Diagnostic } from './content.service';
import {
  readRecordTemplateSources,
  recordTemplateChannels,
  recordTemplateFields,
  recordTemplatesDiffer,
  type RecordTemplateChannel,
} from './record-template.util';

type ChannelView = components['schemas']['ChannelView'];

/** How long record template typing pauses before it is checked (the Templates store's pace). */
const OCTL_VALIDATE_DEBOUNCE_MS = 300;

/** One live check of a record template: the source as typed, against the schema (CDL) as edited. */
interface RecordTemplateValidation {
  key: string;
  datasetUuid: string;
  channel: string;
  source: string;
  sections: CdlSections;
}

/**
 * The state the dataset editor's schema side and its record template tabs share (M35.2): the dataset as
 * loaded, the CDL as edited, and the per-channel record templates with their live checks. Provided by
 * the dataset editor, so each open dataset has its own.
 */
@Injectable()
export class DatasetTemplatesStore {
  private readonly templates = inject(TemplatesService);
  private readonly channelsService = inject(ChannelsService);
  private readonly projectContext = inject(ProjectContextStore);
  private readonly canEdit = inject(ProjectPermissionsStore).canEditTemplates;

  private projectKey: Signal<string> = signal('');

  readonly detail = signal<DatasetDetailView | null>(null);
  /** The CDL as edited (M34): content and rules; a dataset has no bodies. */
  readonly sections = signal<CdlSections>(EMPTY_SECTIONS);

  /** The project's channels (for the record template tabs). */
  private readonly channels = signal<ChannelView[]>([]);
  /** The record templates as edited, channel → source. */
  readonly recordTemplates = signal<Record<string, string>>({});
  /** Per channel: the live check's findings while typing (fields included), or what the last save reported. */
  readonly recordTemplateDiagnostics = signal<Record<string, Diagnostic[]>>({});
  /** The open record template tab; `null` until the channels are known. */
  readonly selectedChannel = signal<string | null>(null);

  /** The dataset's fields, for record template completion (M33). */
  readonly fieldNames = computed(() => declaredPaths(this.sections().content).filter((path) => !path.endsWith('[]')));

  /** The stored record templates, channel → source. */
  private readonly storedRecordTemplates = computed(() => readRecordTemplateSources(this.detail()?.channelTemplates));

  readonly channelTabs = computed<RecordTemplateChannel[]>(() =>
    recordTemplateChannels(this.channels(), this.storedRecordTemplates()),
  );

  /** The open channel: the selected one while it has a tab, else the first. */
  readonly activeChannel = computed<string | null>(() => {
    const keys = this.channelTabs().map((c) => c.key);
    const selected = this.selectedChannel();
    return selected != null && keys.includes(selected) ? selected : (keys[0] ?? null);
  });

  /** How each channel's record template is highlighted (M33 follow-up): the channel's "Highlight as", else detected. */
  readonly formats = computed(() => {
    const highlighting = this.projectContext.project()?.codeHighlighting;
    return Object.fromEntries(
      this.channelTabs().map((tab) => [
        tab.key,
        channelCodeFormat(this.channels().find((channel) => channel.key === tab.key), highlighting),
      ]),
    );
  });

  /** The channels whose record template differs from the stored one. */
  readonly dirtyChannels = computed(() => {
    const edited = this.recordTemplates();
    const stored = this.storedRecordTemplates();
    return new Set(
      this.channelTabs()
        .map((c) => c.key)
        .filter((key) => recordTemplatesDiffer({ [key]: edited[key] ?? '' }, { [key]: stored[key] ?? '' })),
    );
  });

  /** One tab per channel, with its error count, unsaved dot and "disabled" note. */
  readonly recordTemplateTabs = computed<SfTab[]>(() => {
    const diagnostics = this.recordTemplateDiagnostics();
    const dirty = this.dirtyChannels();
    return this.channelTabs().map((tab) => ({
      id: tab.key,
      label: tab.key,
      note: tab.enabled ? undefined : 'disabled',
      errors: (diagnostics[tab.key] ?? []).filter((d) => d.severity === 'ERROR').length,
      dirty: dirty.has(tab.key),
    }));
  });

  /** The stored schema's editors (for the title field options and click-to-insert). */
  readonly savedEditors = computed<EditorDefinition[] | undefined>(
    () => (this.detail()?.compiledDefinition as unknown as ContentDefinition | undefined)?.editors,
  );

  /** Click-to-insert: the fields of the schema as edited, then the record meta names. */
  readonly fieldHelpers = computed(() => recordTemplateFields(this.sections().content, this.savedEditors()));

  /** Typed sources to check; `null` drops a pending check (a save answers with the full diagnostics). */
  private readonly recordTemplateValidation = new Subject<RecordTemplateValidation | null>();

  constructor() {
    // Live check of the open record template: debounced, a newer keystroke cancels the one in flight. The
    // server compiles it as this dataset's record template against the CDL as edited (`datasetUuid` + the
    // sections), so an undeclared field (SF-TPL-0103) or SF-TPL-0122 shows while typing — the
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
                  contentCdl: request.sections.content,
                  rulesCdl: request.sections.rules,
                })
                .pipe(
                  catchError(() => of(null)),
                  // Carry the request along: the answer belongs to the channel that was typed in.
                  map((response) => ({ request, response })),
                )
            : EMPTY,
        ),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(({ request, response }) => {
        const current =
          (this.recordTemplates()[request.channel] ?? '') === request.source &&
          sectionsEqual(this.sections(), request.sections);
        if (response && current) {
          this.recordTemplateDiagnostics.update((all) => ({
            ...all,
            [request.channel]: sortDiagnostics(response.diagnostics ?? []) as Diagnostic[],
          }));
        }
      });
  }

  /** Points the store at the editor's project key input. */
  bind(projectKey: Signal<string>): void {
    this.projectKey = projectKey;
  }

  /** A channel's record template as edited. */
  sourceOf(channel: string): string {
    return this.recordTemplates()[channel] ?? '';
  }

  /** A channel's record template diagnostics; none until it has been checked. */
  diagnosticsOf(channel: string): Diagnostic[] {
    return this.recordTemplateDiagnostics()[channel] ?? [];
  }

  /** Opens a channel's record template tab. */
  selectTab(channel: string): void {
    const previous = this.activeChannel();
    this.selectedChannel.set(channel);
    // Opening a template re-checks it: the schema may have changed since it was last checked.
    if (channel !== previous && (this.recordTemplates()[channel] ?? '').trim() !== '') {
      this.checkRecordTemplate(channel, this.recordTemplates()[channel]);
    }
  }

  /** An edit of a channel's record template (the open one unless named). */
  onRecordTemplateInput(source: string, channel: string | null = this.activeChannel()): void {
    if (channel == null || !this.canEdit()) {
      return;
    }
    this.recordTemplates.update((all) => ({ ...all, [channel]: source }));
    this.checkRecordTemplate(channel, source);
  }

  /** Drops a check still waiting for its debounce (a save answers with the full diagnostics). */
  dropPendingCheck(): void {
    this.recordTemplateValidation.next(null);
  }

  /** Loads the project's channels; without the list the tabs still show every channel with a stored template. */
  loadChannels(projectKey: string): void {
    if (!projectKey) {
      return;
    }
    this.channelsService.list(projectKey).subscribe({
      next: (list) => this.channels.set(list ?? []),
      error: () => this.channels.set([]),
    });
  }

  /** Adopts a loaded or saved dataset's stored record templates and forgets the old checks. */
  resetTemplates(detail: DatasetDetailView): void {
    this.recordTemplates.set(readRecordTemplateSources(detail.channelTemplates));
    this.recordTemplateDiagnostics.set({});
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
      sections: this.sections(),
    });
  }
}
