import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import { Router } from '@angular/router';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { channelCodeFormat } from '../../shared/code-editor/code-format';
import { declaredPaths } from '../../shared/code-editor/completions';
import {
  EMPTY_SECTIONS,
  errorCount,
  sectionsOf,
  type CdlSection,
  type CdlSections,
} from '../../shared/code-editor/cdl-sections';
import type { SfTab } from '../../shared/components/sf-tabs.component';
import {
  inheritanceBreadcrumb,
  inheritedGroups,
  type DescendantProblem,
  type TemplateInUse,
  type TemplateRef,
} from './inheritance.util';
import { declaresPagination, paginationPathError, paginationPathsForSave } from './pagination-path.util';
import type { Diagnostic, TemplateDetail, TemplateKind, TemplateSummary } from './templates.service';
import type { TemplateAssetKind } from './types';
import { channelSourcesOf } from './templates.util';

type ChannelView = components['schemas']['ChannelView'];

/**
 * The state of the templates screen, shared by the tree pane, the metadata header, the CDL and channel panels and the
 * dialogs. Provided by `TemplatesComponent`, so there is one per screen. It only holds signals and derived values; the
 * behaviour lives in `TemplatesLoader`, `TemplatesEditing` and `TemplatesSaveCoordinator`.
 */
@Injectable()
export class TemplatesStore {
  private readonly projectContext = inject(ProjectContextStore);
  private readonly access = inject(ProjectAccessStore);

  /** The screen's `projectKey` input, handed over by `TemplatesComponent` before anything reads it. */
  projectKey: Signal<string> = signal('');

  bind(projectKey: Signal<string>): void {
    this.projectKey = projectKey;
  }

  /** Time travel or an archived project (M26). */
  readonly readOnly = this.access.readOnly;
  readonly readOnlyLabel = this.access.readOnlyLabel;

  readonly templateFolderTree = this.projectContext.templateFolderTree;
  /**
   * "Which of the two template endpoints/kinds is currently relevant" — derived from the open template rather than
   * toggled (M13.3.1 step 5): its own `assetType` wins (you're looking straight at it), else `PAGE_TEMPLATE`.
   */
  readonly activeTemplateKind = computed<TemplateAssetKind>(() => this.selectedTemplateAssetType() ?? 'PAGE_TEMPLATE');

  readonly kind = computed<TemplateKind>(() => (this.activeTemplateKind() === 'SECTION_TEMPLATE' ? 'section' : 'page'));

  readonly templates = signal<TemplateSummary[]>([]);
  readonly loading = signal(false);
  /** The first read of the template list returned (until then the area's tree and tables say nothing). */
  readonly loaded = signal(false);
  /** The last read of the template list failed. */
  readonly listFailed = signal(false);
  /** The open template or dataset: the shell follows the URL (`/templates/:uuid`) and writes it here. */
  readonly selectedUuid = signal<string | null>(null);
  /** The template or dataset whose *Used by* drawer is open (the tree, the table and the header ask for it). */
  readonly usedByUuid = signal<string | null>(null);

  readonly selectedTemplateAssetType = computed<TemplateAssetKind | null>(() => {
    const uuid = this.selectedUuid();
    if (!uuid) {
      return null;
    }
    const found = this.templates().find((t) => t.uuid === uuid);
    const assetType = found?.assetType?.toUpperCase();
    return assetType === 'SECTION_TEMPLATE' || assetType === 'PAGE_TEMPLATE' || assetType === 'DATASET' ? assetType : null;
  });

  /** A dataset is selected: the detail pane is the dataset schema editor, not the template editor. */
  readonly datasetSelected = computed(() => this.selectedTemplateAssetType() === 'DATASET');

  readonly detail = signal<TemplateDetail | null>(null);
  readonly displayName = signal('');
  readonly category = signal('');
  readonly deprecated = signal(false);
  /** The CDL sections as edited (M34); the saved ones are the detail's. */
  readonly sections = signal<CdlSections>(EMPTY_SECTIONS);
  readonly savedSections = computed<CdlSections | null>(() => {
    const detail = this.detail();
    return detail ? sectionsOf(detail) : null;
  });
  /** The CDL tab shown. */
  readonly cdlTab = signal<CdlSection>('content');
  /** A section template has no bodies. */
  readonly cdlTabs = computed<CdlSection[]>(() => (this.isSection() ? ['content', 'rules'] : ['content', 'bodies', 'rules']));
  readonly cdlDiagnostics = signal<Diagnostic[]>([]);

  readonly channels = signal<ChannelView[]>([]);
  /**
   * Every channel's source as edited (M34), keyed by channel: added channels start empty, removed ones are gone.
   * Nothing is written until the one Save, which sends them all with the CDL — one request, one revision.
   */
  readonly channelSources = signal<Record<string, string>>({});
  readonly savedChannelSources = computed<Record<string, string>>(() => channelSourcesOf(this.detail()));
  readonly selectedChannel = signal('');
  readonly channelSource = computed(() => this.channelSources()[this.selectedChannel()] ?? '');
  /** Saved channels this save removes, so the removal can be undone before saving. */
  readonly removedChannels = computed(() =>
    Object.keys(this.savedChannelSources()).filter((key) => !(key in this.channelSources())),
  );

  // ---- Inheritance (M20.4.1) ----
  /** A page template's `abstract` flag as edited: a layout other templates extend, never used by pages. */
  readonly abstractTemplate = signal(false);
  /** A page template's per-channel path patterns of pages 2..N of a paginated page, as edited (M21). */
  readonly paginationPaths = signal<Record<string, string>>({});
  /** Whether the pagination paths apply: the template declares or inherits a pagination editor, or has patterns. */
  readonly showPaginationPaths = computed(
    () =>
      !this.isSection() &&
      (declaresPagination(
        (this.detail()?.effectiveDefinition as { editors?: { type?: string }[] } | null | undefined)?.editors,
        this.sections().content,
      ) ||
        Object.keys(paginationPathsForSave(this.paginationPaths())).length > 0),
  );
  readonly paginationPathErrors = computed<Record<string, string>>(() => {
    const errors: Record<string, string> = {};
    for (const [channel, pattern] of Object.entries(this.paginationPaths())) {
      const error = paginationPathError(pattern);
      if (error) {
        errors[channel] = error;
      }
    }
    return errors;
  });
  /** Each channel's diagnostics: live ones for the channel being edited, a rejected save's for every channel. */
  readonly octlDiagnostics = signal<Record<string, Diagnostic[]>>({});
  readonly activeOctlDiagnostics = computed(() => this.channelDiagnostics(this.selectedChannel()));

  /** One channel's diagnostics; none until it has been checked. */
  channelDiagnostics(channel: string): Diagnostic[] {
    return this.octlDiagnostics()[channel] ?? [];
  }

  /**
   * The server's warnings about each channel's output path (`TemplateDetail.warnings`, field `outputPath:<channel>`):
   * computed on every read and save, so they are what the saved template says, not a live check.
   */
  private readonly outputPathWarnings = computed<Record<string, Diagnostic[]>>(() => {
    const byChannel: Record<string, Diagnostic[]> = {};
    for (const warning of this.detail()?.warnings ?? []) {
      const channel = warning.field?.startsWith('outputPath:') ? warning.field.slice('outputPath:'.length) : null;
      if (channel) {
        (byChannel[channel] ??= []).push(warning);
      }
    }
    return byChannel;
  });

  outputPathWarningsOf(channel: string): Diagnostic[] {
    return this.outputPathWarnings()[channel] ?? [];
  }
  /** Descendants a rejected save would have broken (`422 SF-DOM-0124`). */
  readonly descendantProblems = signal<DescendantProblem[]>([]);
  /** Warnings a successful save produced on descendants; dismissible. */
  readonly descendantWarnings = signal<DescendantProblem[]>([]);
  /** Pages still using the template when making it abstract was refused (`422 SF-DOM-0122`). */
  readonly templateInUse = signal<TemplateInUse | null>(null);
  /** Templates extending the selected one, from its usages. */
  readonly childTemplates = signal<TemplateRef[]>([]);
  /** `base › docs_layout › article`: root first, ending at the selected template. */
  readonly breadcrumb = computed(() => inheritanceBreadcrumb(this.detail()));
  /** Inherited editors and bodies, grouped by the ancestor declaring them (read-only). */
  readonly inheritedGroups = computed(() => inheritedGroups(this.detail()));
  /** The ancestors declaring inherited editors (on the Content tab) and bodies (on the Bodies tab). */
  readonly inheritedEditorGroups = computed(() => this.inheritedGroups().filter((group) => group.editors.length > 0));
  readonly inheritedBodyGroups = computed(() => this.inheritedGroups().filter((group) => group.bodies.length > 0));

  /** How each channel's source is highlighted (M33 follow-up): its "Highlight as", else detected. */
  readonly channelFormats = computed(() => {
    const highlighting = this.projectContext.project()?.codeHighlighting;
    return Object.fromEntries(
      this.channelKeys().map((key) => [
        key,
        channelCodeFormat(this.channels().find((channel) => channel.key === key), highlighting),
      ]),
    );
  });

  /**
   * The editors a channel may use, for completion (M33): the ones the unsaved CDL declares and the inherited ones.
   */
  readonly editorNames = computed<string[]>(() => {
    const names = new Set(declaredPaths(this.sections().content).filter((path) => !path.endsWith('[]')));
    const collect = (editors: { name?: string; items?: unknown[] }[] | undefined) =>
      (editors ?? []).forEach((editor) => {
        if (editor.name) {
          names.add(editor.name);
        }
        collect(editor.items as { name?: string; items?: unknown[] }[] | undefined);
      });
    collect((this.detail()?.effectiveDefinition as { editors?: { name?: string; items?: unknown[] }[] } | null)?.editors);
    return [...names];
  });

  readonly channelKeys = computed<string[]>(() => Object.keys(this.channelSources()));

  /** One tab per channel, with its error count and unsaved dot (added or edited). */
  readonly channelTabs = computed<SfTab[]>(() => {
    const saved = this.savedChannelSources();
    const diagnostics = this.octlDiagnostics();
    return Object.entries(this.channelSources()).map(([key, source]) => ({
      id: key,
      label: key,
      errors: errorCount(diagnostics[key] ?? []),
      dirty: saved[key] !== source,
    }));
  });

  readonly availableChannels = computed<ChannelView[]>(() => {
    const existing = new Set(this.channelKeys());
    return this.channels().filter((c) => !existing.has(c.key ?? ''));
  });

  isSection(): boolean {
    return this.kind() === 'section';
  }

  private readonly router = inject(Router);

  /**
   * Opens another template of the chain (breadcrumb, "Extended by", a broken descendant). The open item lives in the URL
   * (`/templates/:uuid`), so the route's unsaved-changes guard asks before the screen changes (M35.13).
   */
  openTemplate(uuid: string | null | undefined): void {
    if (uuid) {
      void this.router.navigate(['/p', this.projectKey(), 'templates', uuid]);
    }
  }

  dismissDescendantWarnings(): void {
    this.descendantWarnings.set([]);
  }
}
