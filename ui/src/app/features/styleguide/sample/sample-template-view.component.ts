import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ShortcutService } from '../../../core/ui/shortcut.service';
import { ToastService } from '../../../core/ui/toast.service';
import type { CodeDiagnostic } from '../../../shared/code-editor/code-editor.types';
import { SfCodePanelComponent } from '../../../shared/code-editor/sf-code-panel.component';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfCopyableComponent } from '../../../shared/components/display/sf-copyable.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../shared/components/forms/sf-segmented.component';
import { SfSwitchComponent } from '../../../shared/components/forms/sf-switch.component';
import { SfPageHeaderComponent } from '../../../shared/components/layout/sf-page-header.component';
import { SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../shared/components/sf-empty-state.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfTab, SfTabsComponent, panelIdOf, tabIdOf } from '../../../shared/components/sf-tabs.component';
import { SfSplitterComponent } from '../../../shared/components/splitter/sf-splitter.component';
import { sfUniqueId } from '../../../shared/components/forms/sf-field-context';
import { SampleBreadcrumbComponent } from './sample-breadcrumb.component';
import { templateEntry } from './sample-content-data';
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
    SfButtonComponent,
    SfCodePanelComponent,
    SfCopyableComponent,
    SfEmptyStateComponent,
    SfFieldComponent,
    SfIconComponent,
    SfInputComponent,
    SfPageHeaderComponent,
    SfSegmentedComponent,
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
  private readonly toasts = inject(ToastService);
  /** Ctrl/Cmd+S saves the open template (the registry keeps the browser's own "save page" away). */
  private readonly saveShortcut = inject(ShortcutService).use([
    {
      id: 'save',
      keys: 'Mod+S',
      scope: 'screen',
      group: 'general',
      description: 'frame.shortcuts.items.save',
      allowInInput: true,
      handler: () => (this.def() ? this.save() : false),
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
    () => JSON.stringify(this.sources()) !== JSON.stringify(this.saved()) || !sameSettings(this.settings(), this.savedSettings()),
  );
  protected readonly settingsOpen = signal(false);

  // ── Layout ─────────────────────────────────────────────────────────────────
  protected readonly wide = signal(typeof matchMedia !== 'function' || matchMedia(WIDE_QUERY).matches);
  protected readonly stack = signal<'cdl' | 'channels'>('cdl');

  protected readonly sections = computed<SampleCdlSection[]>(() =>
    CDL_SECTIONS.filter((section) => `cdl:${section}` in this.sources()),
  );
  protected readonly channels = computed(() => this.def()?.channels ?? []);
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

  protected readonly moreActions = computed<SfMenuItem[]>(() => [
    { id: 'duplicate', label: this.state.t('editor.duplicate'), icon: 'content_copy' },
    { id: 'rename', label: this.state.t('editor.rename'), icon: 'edit', shortcut: 'F2' },
    { id: 'move', label: this.state.t('editor.move'), icon: 'drive_file_move' },
    { id: 'usedBy', label: this.state.t('content.usedBy'), icon: 'link' },
    { id: 'delete', label: this.state.t('editor.delete'), icon: 'delete', danger: true, separatorBefore: true },
  ]);

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

  /** Save (and `Ctrl+S`): the working copy becomes the saved state — in memory only. */
  protected save(): void {
    this.saved.set(this.sources());
    this.savedSettings.set(this.settings());
    this.toasts.show(this.state.t('template.savedToast', { name: this.name() }), 'success');
  }

  protected secondary(): void {
    this.state.notice();
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
