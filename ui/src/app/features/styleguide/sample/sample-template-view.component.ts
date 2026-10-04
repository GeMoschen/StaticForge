import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ShortcutService } from '../../../core/ui/shortcut.service';
import { ToastService } from '../../../core/ui/toast.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import type { CodeDiagnostic } from '../../../shared/code-editor/code-editor.types';
import { SfCodePanelComponent } from '../../../shared/code-editor/sf-code-panel.component';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfCopyableComponent } from '../../../shared/components/display/sf-copyable.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../shared/components/forms/sf-segmented.component';
import { SfSwitchComponent } from '../../../shared/components/forms/sf-switch.component';
import { SfPageHeaderComponent } from '../../../shared/components/layout/sf-page-header.component';
import { SfBannerComponent } from '../../../shared/components/layout/sf-banner.component';
import { SfSkeletonComponent } from '../../../shared/components/layout/sf-skeleton.component';
import { SfMenuComponent, SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../shared/components/sf-empty-state.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfTab, SfTabsComponent, panelIdOf, tabIdOf } from '../../../shared/components/sf-tabs.component';
import { SfSplitterComponent } from '../../../shared/components/splitter/sf-splitter.component';
import { sfUniqueId } from '../../../shared/components/forms/sf-field-context';
import { SamplePagesReview } from './pages/sample-pages-review';
import { SampleBreadcrumbComponent } from './sample-breadcrumb.component';
import { TEMPLATE_USAGES, templateEntry } from './sample-content-data';
import { SampleCodePalette, SampleCrumb, SampleState } from './sample-state';
import { TEMPLATE_ICONS } from './sample-templates-tree.component';
import {
  CDL_SECTIONS,
  SampleCdlSection,
  SampleTemplateChannel,
  SampleTemplateDef,
  SampleTemplateSettings,
  diagnosticsOf,
  templateDefById,
} from './sample-template-data';

/** Two editors side by side from here; below it they stack as tabs (CDL | Channels). */
const WIDE_QUERY = '(min-width: 1280px)';
const CDL_TABS = 'sample-tpl-cdl';
const CHANNEL_TABS = 'sample-tpl-channel';
const STACK_TABS = 'sample-tpl-stack';

/** Source text per key; a key without text is missing. */
type Sources = Readonly<Partial<Record<string, string>>>;

function sourcesOf(def: SampleTemplateDef | null): Sources {
  if (!def) {
    return {};
  }
  const entries: [string, string][] = [];
  for (const section of CDL_SECTIONS) {
    const text = def.cdl[section];
    if (text !== undefined || (section === 'bodies' && def.kind === 'page')) {
      entries.push([`cdl:${section}`, text ?? '']);
    }
  }
  def.channels.forEach((channel) => entries.push([`channel:${channel.id}`, channel.source]));
  return Object.fromEntries(entries);
}

function sameSettings(a: SampleTemplateSettings | null, b: SampleTemplateSettings | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The definition fields beside the code that the app edits too: display name, category and the abstract / deprecated flag. */
interface SampleTemplateExtras {
  readonly displayName: string;
  readonly category: string;
  /** Page templates: a layout other templates extend; pages can't use it. */
  readonly abstract: boolean;
  /** Section templates: still works, but is no longer offered in the section palette. */
  readonly deprecated: boolean;
}

/** Channels a template can still get (the project's channels it has no template for yet). */
const ADDABLE_CHANNELS: readonly string[] = ['json', 'atom'];

/**
 * The template view (M35.21 mocked, decisions 15–18): page header (name, kind, inheritance chain as breadcrumb, save
 * status, Save — enabled when dirty, also `Ctrl+S` — and ⋮), the highlighting palette switch, a collapsible Settings
 * section (output and pagination paths, channels), and the code in an `sf-splitter`: CDL (Content | Bodies | Rules)
 * and the channel templates in OCTL, each in an `sf-code-panel` with its diagnostics. Below 1280 px the two sides stack
 * as tabs (CDL | Channels). Templates other than the two of the sample show a placeholder. Nothing is saved.
 */
@Component({
  selector: 'sf-sample-template-view',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    SampleBreadcrumbComponent,
    SfBadgeComponent,
    SfBannerComponent,
    SfButtonComponent,
    SfCodePanelComponent,
    SfCopyableComponent,
    SfEmptyStateComponent,
    SfFieldComponent,
    SfIconComponent,
    SfInputComponent,
    SfMenuComponent,
    SfPageHeaderComponent,
    SfSegmentedComponent,
    SfSkeletonComponent,
    SfSplitterComponent,
    SfSwitchComponent,
    SfTabsComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-template-view.component.html',
  styleUrl: './sample-template-view.component.scss',
})
export class SampleTemplateViewComponent {
  protected readonly state = inject(SampleState);
  protected readonly review = inject(SamplePagesReview);
  private readonly toasts = inject(ToastService);
  private readonly confirms = inject(ConfirmService);
  /** Ctrl/Cmd+S saves the open template (the registry keeps the browser's own "save page" away). */
  private readonly saveShortcut = inject(ShortcutService).use([
    {
      id: 'save',
      keys: 'Mod+S',
      scope: 'screen',
      group: 'general',
      description: 'frame.shortcuts.items.save',
      allowInInput: true,
      handler: () => (this.def() ? (void this.save(), true) : false),
    },
  ]);

  protected readonly cdlTabsId = CDL_TABS;
  protected readonly channelTabsId = CHANNEL_TABS;
  protected readonly stackTabsId = STACK_TABS;
  protected readonly settingsId = sfUniqueId('sample-tpl-settings');

  protected readonly entry = computed(() => templateEntry(this.state.templateId()));
  protected readonly def = computed(() => templateDefById(this.state.templateId()));
  protected readonly name = computed(() => this.entry()?.name ?? this.state.t('rail.templates'));
  protected readonly icon = computed(() => TEMPLATE_ICONS[this.entry()?.kind ?? 'folder']);
  protected readonly kindLabel = computed(() => this.state.t(`templates.kind.${this.entry()?.kind ?? 'folder'}`));

  // ── Working copy (nothing is saved) ────────────────────────────────────────
  private readonly saved = signal<Sources>(sourcesOf(this.def()));
  protected readonly sources = signal<Sources>(sourcesOf(this.def()));
  private readonly savedSettings = signal<SampleTemplateSettings | null>(this.def()?.settings ?? null);
  protected readonly settings = signal<SampleTemplateSettings | null>(this.def()?.settings ?? null);
  protected readonly dirty = computed(
    () =>
      JSON.stringify(this.sources()) !== JSON.stringify(this.saved()) ||
      !sameSettings(this.settings(), this.savedSettings()) ||
      JSON.stringify(this.extras()) !== JSON.stringify(this.savedExtras()) ||
      this.removed().join() !== this.savedRemoved().join(),
  );
  protected readonly settingsOpen = signal(false);
  private readonly savedExtras = signal<SampleTemplateExtras>(this.extrasOf());
  protected readonly extras = signal<SampleTemplateExtras>(this.extrasOf());
  /** Channels taken off until the next save ("Removed when you save: rss — Undo"). */
  private readonly savedRemoved = signal<readonly string[]>([]);
  protected readonly removed = signal<readonly string[]>([]);
  /** The last save was refused (`tstate=saveerror`): the message stays until the next save. */
  protected readonly failure = signal(this.review.template() === 'saveerror');
  private discardAnswered = false;

  /** Read-only: an archived project or a past revision. Nothing can be edited or saved. */
  protected readonly readOnly = computed(() => this.review.readOnly());
  protected readonly loading = computed(() => this.review.template() === 'loading');
  protected readonly failed = computed(() => this.review.template() === 'error');
  /** What uses this template: the pages that pick it, and the templates that extend it. */
  protected readonly usages = computed(() => TEMPLATE_USAGES[this.def()?.id ?? ''] ?? []);
  protected readonly pageUsers = computed(() => this.usages().filter((usage) => usage.type === 'page'));
  protected readonly descendants = computed(() => this.usages().filter((usage) => usage.type === 'template' && usage.path === 'extends'));
  /** The page names for the "in use" message (the first three, then "…"). */
  protected readonly pageNames = computed(() => {
    const names = this.pageUsers().map((usage) => usage.name);
    return names.slice(0, 3).join(', ') + (names.length > 3 ? ', …' : '');
  });
  /** Abstract can't be switched on while pages use the template (the app says so and names the pages). */
  protected readonly abstractBlocked = computed(() => this.extras().abstract && this.pageUsers().length > 0);

  // ── Layout ─────────────────────────────────────────────────────────────────
  protected readonly wide = signal(typeof matchMedia !== 'function' || matchMedia(WIDE_QUERY).matches);
  protected readonly stack = signal<'cdl' | 'channels'>('cdl');

  protected readonly sections = computed<SampleCdlSection[]>(() =>
    CDL_SECTIONS.filter((section) => `cdl:${section}` in this.sources()),
  );
  protected readonly channels = computed(() => (this.def()?.channels ?? []).filter((channel) => !this.removed().includes(channel.id)));
  protected readonly section = computed<SampleCdlSection>(() => {
    const selected = this.state.templateSection();
    return this.sections().includes(selected) ? selected : 'content';
  });
  protected readonly channel = computed(() => {
    const selected = this.state.templateChannel();
    return this.channels().find((c) => c.id === selected) ?? this.channels().at(0) ?? null;
  });

  /** Diagnostics per source key, at their current positions. */
  protected readonly diagnostics = computed<Readonly<Partial<Record<string, CodeDiagnostic[]>>>>(() => {
    const def = this.def();
    const sources = this.sources();
    if (!def) {
      return {};
    }
    const all: Record<string, CodeDiagnostic[]> = {};
    for (const section of CDL_SECTIONS) {
      all[`cdl:${section}`] = diagnosticsOf(sources[`cdl:${section}`] ?? '', def.cdlProblems?.[section]);
    }
    for (const channel of def.channels) {
      all[`channel:${channel.id}`] = diagnosticsOf(sources[`channel:${channel.id}`] ?? '', channel.problems);
    }
    return all;
  });

  protected readonly cdlTabs = computed<SfTab[]>(() =>
    this.sections().map((section) => this.tab(section, this.state.t(`template.sections.${section}`), `cdl:${section}`)),
  );
  protected readonly channelTabs = computed<SfTab[]>(() =>
    this.channels().map((channel) => this.tab(channel.id, channel.id, `channel:${channel.id}`)),
  );
  protected readonly stackTabs = computed<SfTab[]>(() => {
    const errors = (prefix: string) =>
      Object.entries(this.diagnostics())
        .filter(([key]) => key.startsWith(prefix))
        .reduce((sum, [, list = []]) => sum + list.filter((d) => d.severity === 'ERROR').length, 0);
    return [
      { id: 'cdl', label: this.state.t('template.cdl'), errors: errors('cdl:') },
      { id: 'channels', label: this.state.t('template.channels'), errors: errors('channel:') },
    ];
  });

  /** The inheritance chain: ancestors, then this template. */
  protected readonly inheritance = computed<SampleCrumb[]>(() => {
    const def = this.def();
    if (!def || def.inherits.length === 0) {
      return [];
    }
    return [
      ...def.inherits.map((id) => ({ label: templateEntry(id)?.name ?? id, target: id })),
      { label: this.name() },
    ];
  });

  protected readonly paletteOptions = computed<SfSegmentedOption<SampleCodePalette>[]>(() => [
    { value: 'current', label: this.state.t('template.paletteCurrent') },
    { value: 'refined', label: this.state.t('template.paletteRefined') },
  ]);

  protected readonly moreActions = computed<SfMenuItem[]>(() => {
    const locked = this.readOnly();
    return [
      { id: 'duplicate', label: this.state.t('editor.duplicate'), icon: 'content_copy', disabled: locked },
      { id: 'rename', label: this.state.t('templateActions.renameDialog'), icon: 'edit', shortcut: 'F2', disabled: locked },
      { id: 'move', label: this.state.t('editor.move'), icon: 'drive_file_move', disabled: locked },
      { id: 'usedBy', label: this.state.t('content.usedBy'), icon: 'link' },
      { id: 'delete', label: this.state.t('editor.delete'), icon: 'delete', danger: true, separatorBefore: true, disabled: locked },
    ];
  });

  /** *Add channel*: the channels the project has that this template has no source for yet. */
  protected readonly addChannelItems = computed<SfMenuItem[]>(() =>
    ADDABLE_CHANNELS.map((id) => ({
      id,
      label: id,
      icon: 'add',
      action: () => this.state.notice('template.channelAdded', { channel: id, name: this.name() }),
    })),
  );

  constructor() {
    // Another template opened: its own sources and settings, nothing unsaved.
    effect(
      () => {
        const def = this.def();
        untracked(() => {
          const sources = sourcesOf(def);
          this.saved.set(sources);
          this.sources.set(sources);
          this.savedSettings.set(def?.settings ?? null);
          this.settings.set(def?.settings ?? null);
          this.savedExtras.set(this.extrasOf());
          this.extras.set(this.extrasOf());
          this.savedRemoved.set([]);
          this.removed.set([]);
        });
      },
      { allowSignalWrites: true },
    );
    if (typeof matchMedia === 'function') {
      const query = matchMedia(WIDE_QUERY);
      const listener = (event: MediaQueryListEvent) => this.wide.set(event.matches);
      query.addEventListener?.('change', listener);
      inject(DestroyRef).onDestroy(() => query.removeEventListener?.('change', listener));
    }
  }

  /** The language a channel's panel names: OCTL around the channel's own format. */
  protected octlLabel(format: string): string {
    return `OCTL · ${format}`;
  }

  protected tabId(prefix: string, id: string): string {
    return tabIdOf(prefix, id);
  }

  protected panelId(prefix: string, id: string): string {
    return panelIdOf(prefix, id);
  }

  protected edit(key: string, value: string): void {
    this.sources.update((all) => ({ ...all, [key]: value }));
  }

  protected setSetting(patch: Partial<SampleTemplateSettings>): void {
    this.settings.update((current) => (current ? { ...current, ...patch } : current));
  }

  protected setChannel(channel: string, on: boolean): void {
    this.settings.update((current) => (current ? { ...current, channels: { ...current.channels, [channel]: on } } : current));
  }

  protected selectSection(id: string): void {
    this.state.templateSection.set(id as SampleCdlSection);
  }

  protected selectChannel(id: string): void {
    this.state.templateChannel.set(id as SampleTemplateChannel);
  }

  protected selectStack(id: string): void {
    this.stack.set(id === 'channels' ? 'channels' : 'cdl');
  }

  protected setPalette(palette: SampleCodePalette | null): void {
    if (palette) {
      this.state.palette.set(palette);
    }
  }

  /**
   * Save (and `Ctrl+S`): the working copy becomes the saved state — in memory only. In the `tstate=discard` review state the
   * first save asks, because the change would drop translations: *Keep the translations* or *Discard and save*.
   */
  protected async save(): Promise<void> {
    if (!this.dirty() || this.readOnly()) {
      return;
    }
    if (this.review.template() === 'discard' && !this.discardAnswered) {
      const confirmed = await this.confirms.confirm({
        title: this.state.t('template.discard.title'),
        message: this.state.t('template.discard.message'),
        confirmLabel: this.state.t('template.discard.confirm'),
        cancelLabel: this.state.t('template.discard.keep'),
        tone: 'danger',
      });
      if (!confirmed) {
        return;
      }
      this.discardAnswered = true;
    }
    this.saved.set(this.sources());
    this.savedSettings.set(this.settings());
    this.savedExtras.set(this.extras());
    this.savedRemoved.set(this.removed());
    this.failure.set(false);
    this.toasts.show(this.state.t('template.savedToast', { name: this.name() }), 'success');
  }

  /** The ⋮ menu: the same dialogs as the tree and the folder table. */
  protected secondary(item: SfMenuItem): void {
    const entry = this.entry();
    if (!entry) {
      return;
    }
    switch (item.id) {
      case 'duplicate':
        this.state.duplicateTemplate(entry);
        break;
      case 'rename':
        void this.state.renameTemplate(entry);
        break;
      case 'move':
        void this.state.moveTemplates([entry]);
        break;
      case 'usedBy':
        this.state.templateUsedBy.set(entry.id);
        break;
      default:
        void this.state.deleteTemplates([entry]);
    }
  }

  protected setExtras(patch: Partial<SampleTemplateExtras>): void {
    this.extras.update((current) => ({ ...current, ...patch }));
  }

  protected removeChannel(id: string): void {
    this.removed.update((all) => [...all, id]);
  }

  protected restoreChannel(id: string): void {
    this.removed.update((all) => all.filter((channel) => channel !== id));
  }

  /** Display name, category and flags of the open template as saved. */
  private extrasOf(): SampleTemplateExtras {
    const entry = templateEntry(this.state.templateId());
    return { displayName: entry?.name ?? '', category: entry?.kind === 'section' ? 'Cards' : 'Layouts', abstract: false, deprecated: false };
  }

  private tab(id: string, label: string, key: string): SfTab {
    const list = this.diagnostics()[key] ?? [];
    return {
      id,
      label,
      errors: list.filter((d) => d.severity === 'ERROR').length || undefined,
      dirty: this.sources()[key] !== this.saved()[key],
    };
  }
}
