import { Location, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { HashMap, TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ToastService } from '../../../../core/ui/toast.service';
import { SfCodePanelComponent } from '../../../../shared/code-editor/sf-code-panel.component';
import { SfCatalogCardDirective, SfCatalogComponent } from '../../../../shared/components/card/sf-catalog.component';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { SfCopyableComponent } from '../../../../shared/components/display/sf-copyable.component';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfTagComponent } from '../../../../shared/components/display/sf-tag.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfNumberInputComponent } from '../../../../shared/components/forms/sf-number-input.component';
import { SfSelectComponent } from '../../../../shared/components/forms/sf-select.component';
import { SfTextareaComponent } from '../../../../shared/components/forms/sf-textarea.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfSectionComponent } from '../../../../shared/components/layout/sf-section.component';
import { SfMenuComponent, SfMenuItem } from '../../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../../shared/components/sf-empty-state.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SfTab, SfTabsComponent } from '../../../../shared/components/sf-tabs.component';
import { SfTreeComponent } from '../../../../shared/components/sf-tree.component';
import { SfSplitterComponent } from '../../../../shared/components/splitter/sf-splitter.component';
import { SfTreeLoader, SfTreeNode } from '../../../../shared/components/tree/tree-model';
import { SampleLang } from '../sample-data';
import { SampleState } from '../sample-state';
import {
  CURRENCY_OPTIONS,
  GLOBAL_FOLDERS,
  GLOBAL_SETS,
  HOURS_FIELDS,
  SAMPLE_SET_IDS,
  SHOP_FIELDS,
  SITE_FIELDS,
  SOCIAL_FIELDS,
  SOCIAL_TYPES,
  SampleHoursRow,
  SampleSetDraft,
  SampleSetId,
  SampleShopValues,
  SampleSiteValues,
  SampleSocialLink,
  SampleSocialType,
  initialSetDraft,
} from './globals-data';

export type SampleGlobalsTab = 'values' | 'schema';

const TREE_WIDTH = 280;
const TREE_WIDTH_NARROW = 240;
const WIDE_QUERY = '(min-width: 1280px)';

/** Sets (or, with `null`, removes) query parameters in place, keeping the others (the screen owns those). */
function replaceQuery(location: Location, values: Readonly<Record<string, string | null>>): void {
  const [path, query = ''] = location.path().split('?');
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(values)) {
    if (value === null) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }
  location.replaceState(path, params.toString());
}

/** A set's part of the draft, for comparing and resetting. */
function partOf(draft: SampleSetDraft, set: SampleSetId): string {
  return JSON.stringify([draft[set], draft.cdl[set]]);
}

/**
 * The sample's Globals area (M35.9 decision 25, M35.22): a filterable tree of global sets (folders "Site" and "Shop")
 * next to the selected set — an `sf-page-header` with the save status and Save (enabled only with changes), the Values
 * tab in the sample's form style (opening hours as a reorderable list, social links as an `sf-catalog`, the footer text
 * localized with its language chip) and, in developer mode, the Schema tab (the set's CDL in `sf-code-panel`) and a
 * `$CMS_VALUE(CMS_GLOBAL…)` usage chip under every field. Switching away from unsaved changes asks first. Nothing
 * leaves the browser.
 *
 * Query parameters (read on load, kept in sync in place): `set=site|shop`, `gtab=values|schema`. Developer mode is the
 * sample's {@link SampleState} `devMode`, or the `dev=1` query parameter without the sample screen.
 */
@Component({
  selector: 'sf-sample-globals-area',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    SfButtonComponent,
    SfCatalogCardDirective,
    SfCatalogComponent,
    SfCodePanelComponent,
    SfCopyableComponent,
    SfEmptyStateComponent,
    SfFieldComponent,
    SfIconComponent,
    SfInputComponent,
    SfMenuComponent,
    SfNumberInputComponent,
    SfPageHeaderComponent,
    SfSectionComponent,
    SfSelectComponent,
    SfSplitterComponent,
    SfStatusComponent,
    SfTabsComponent,
    SfTagComponent,
    SfTextareaComponent,
    SfTreeComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-globals-area.component.html',
  styleUrls: ['../sample-tree-pane.scss', './sample-globals-area.component.scss'],
})
export class SampleGlobalsAreaComponent {
  private readonly sample = inject(SampleState, { optional: true });
  private readonly location = inject(Location);
  private readonly transloco = inject(TranslocoService);
  private readonly toasts = inject(ToastService);
  private readonly confirms = inject(ConfirmService);
  private readonly injector = inject(Injector);
  private readonly translation = toSignal(this.transloco.selectTranslation(), { initialValue: null });
  private readonly tree = viewChild.required<SfTreeComponent<string>>(SfTreeComponent);

  protected readonly treeWidth =
    typeof matchMedia !== 'function' || matchMedia(WIDE_QUERY).matches ? TREE_WIDTH : TREE_WIDTH_NARROW;
  protected readonly site = SITE_FIELDS;
  protected readonly shop = SHOP_FIELDS;
  protected readonly hoursFields = HOURS_FIELDS;
  protected readonly socialFields = SOCIAL_FIELDS;
  protected readonly socialTypes = SOCIAL_TYPES;
  protected readonly currencies = CURRENCY_OPTIONS;

  private readonly devParam: boolean;
  /** Developer mode: the sample's switch, else the `dev` query parameter. */
  protected readonly devMode = computed(() => this.sample?.devMode() ?? this.devParam);
  protected readonly lang = computed<SampleLang>(() => this.sample?.lang() ?? 'en');

  protected readonly setId = signal<SampleSetId | null>(null);
  private readonly requestedTab = signal<SampleGlobalsTab>('values');
  /** Schema is a developer-mode tab: without it the Values tab shows. */
  protected readonly tab = computed<SampleGlobalsTab>(() => (this.devMode() ? this.requestedTab() : 'values'));
  /** The tree's selection; set anew to undo a click that the unsaved-changes guard turned down. */
  protected readonly treeSelection = signal<readonly string[]>([]);

  private readonly saved = signal(initialSetDraft());
  protected readonly draft = signal(initialSetDraft());
  private ids = 0;

  protected readonly set = computed(() => {
    const id = this.setId();
    return id ? GLOBAL_SETS[id] : null;
  });
  protected readonly dirty = computed(() => {
    const id = this.setId();
    return id !== null && partOf(this.draft(), id) !== partOf(this.saved(), id);
  });
  protected readonly siteValues = computed(() => this.draft().site);
  protected readonly shopValues = computed(() => this.draft().shop);
  protected readonly cdl = computed(() => {
    const id = this.setId();
    return id ? this.draft().cdl[id] : '';
  });
  protected readonly footer = computed(() => this.draft().site.footerText[this.lang()]);
  protected readonly langName = computed(() => this.t(`lang.${this.lang()}`));
  protected readonly announcement = signal('');

  protected readonly tabs = computed<SfTab[]>(() => {
    const tabs: SfTab[] = [{ id: 'values', label: this.t('tabs.values'), dirty: this.dirty() }];
    if (this.devMode()) {
      tabs.push({ id: 'schema', label: this.t('tabs.schema') });
    }
    return tabs;
  });

  protected readonly moreActions = computed<SfMenuItem[]>(() => [
    {
      id: 'discard',
      label: this.t('discard'),
      icon: 'undo',
      disabledReason: this.dirty() ? undefined : this.t('nothingToDiscard'),
    },
    { id: 'release', label: this.t('release'), icon: 'publish' },
    { id: 'history', label: this.t('history'), icon: 'history' },
    { id: 'delete', label: this.t('delete'), icon: 'delete', danger: true, separatorBefore: true },
  ]);

  protected readonly newItems = computed<SfMenuItem[]>(() => [
    { id: 'set', label: this.t('newSet'), icon: 'note_add', action: () => this.notice() },
    { id: 'folder', label: this.t('newFolder'), icon: 'create_new_folder', action: () => this.notice() },
  ]);

  /** Folders, then their sets; developer mode adds the uid. */
  protected readonly loader = computed<SfTreeLoader<string>>(() => {
    const dev = this.devMode();
    return (parent): SfTreeNode<string>[] => {
      if (parent === null) {
        return GLOBAL_FOLDERS.map((folder) => ({ id: folder.id, label: folder.name, icon: 'folder', hasChildren: true, droppable: true }));
      }
      const folder = GLOBAL_FOLDERS.find((f) => f.id === parent.id);
      return (folder?.sets ?? []).map((id) => ({
        id,
        label: GLOBAL_SETS[id].name,
        icon: 'tune',
        secondary: dev ? GLOBAL_SETS[id].uid : null,
        data: id,
      }));
    };
  });

  constructor() {
    const params = inject(ActivatedRoute).snapshot.queryParamMap;
    this.devParam = params.get('dev') === '1';
    const set = params.get('set');
    if (SAMPLE_SET_IDS.includes(set as SampleSetId)) {
      this.setId.set(set as SampleSetId);
      this.treeSelection.set([set as SampleSetId]);
    }
    if (params.get('gtab') === 'schema') {
      this.requestedTab.set('schema');
    }

    effect(() => {
      const set = this.setId();
      const tab = this.tab();
      untracked(() => replaceQuery(this.location, { set, gtab: set ? tab : null }));
    });

    // Open every folder: the sets are few.
    afterNextRender(() => {
      for (const folder of GLOBAL_FOLDERS) {
        void this.tree().expand(folder.id);
      }
    });
  }

  // ── Selection (behind the unsaved-changes guard) ───────────────────────────

  protected async onOpen(node: SfTreeNode<string>): Promise<void> {
    const id = node.data as SampleSetId | undefined;
    if (!id || id === this.setId()) {
      return;
    }
    if (this.dirty() && !(await this.confirmDiscard())) {
      // Back to the set that is still open.
      this.treeSelection.set(this.setId() ? [this.setId()!] : []);
      return;
    }
    this.discard();
    this.setId.set(id);
    this.treeSelection.set([id]);
  }

  protected selectTab(tab: string): void {
    this.requestedTab.set(tab === 'schema' ? 'schema' : 'values');
  }

  // ── Save, discard and the ⋮ menu ───────────────────────────────────────────

  protected save(): void {
    const id = this.setId();
    if (!id || !this.dirty()) {
      return;
    }
    const draft = this.draft();
    this.saved.update((saved) => ({ ...saved, [id]: draft[id], cdl: { ...saved.cdl, [id]: draft.cdl[id] } }));
    this.toasts.show(this.t('savedToast', { name: GLOBAL_SETS[id].name }), 'success');
  }

  protected onAction(item: SfMenuItem): void {
    if (item.id === 'discard') {
      this.discard();
    } else {
      this.notice();
    }
  }

  private discard(): void {
    const id = this.setId();
    if (!id) {
      return;
    }
    const saved = this.saved();
    this.draft.update((draft) => ({ ...draft, [id]: saved[id], cdl: { ...draft.cdl, [id]: saved.cdl[id] } }));
  }

  private confirmDiscard(): Promise<boolean> {
    const name = this.set()?.name ?? '';
    return this.confirms.confirm({
      title: this.t('discardTitle'),
      message: this.t('discardMessage', { name }),
      confirmLabel: this.t('discardConfirm'),
      tone: 'danger',
    });
  }

  // ── Values ─────────────────────────────────────────────────────────────────

  protected setSite<K extends keyof SampleSiteValues>(key: K, value: SampleSiteValues[K]): void {
    this.draft.update((draft) => ({ ...draft, site: { ...draft.site, [key]: value } }));
  }

  protected setShop<K extends keyof SampleShopValues>(key: K, value: SampleShopValues[K]): void {
    this.draft.update((draft) => ({ ...draft, shop: { ...draft.shop, [key]: value } }));
  }

  protected setFooter(text: string): void {
    this.setSite('footerText', { ...this.siteValues().footerText, [this.lang()]: text });
  }

  protected setCdl(text: string): void {
    const id = this.setId();
    if (id) {
      this.draft.update((draft) => ({ ...draft, cdl: { ...draft.cdl, [id]: text } }));
    }
  }

  /** How a template reads a field (decision 25: developer mode only). */
  protected usage(field: { readonly name: string; readonly list?: boolean }): string {
    const path = `CMS_GLOBAL.${this.set()?.uid ?? ''}.${field.name}`;
    return field.list ? `$CMS_FOR(item : ${path})$` : `$CMS_VALUE(${path})$`;
  }

  // ── Opening hours (a list: add, remove with Undo, Alt+↑/↓) ─────────────────

  protected rowId(row: SampleHoursRow): string {
    return `sample-hours-${row.id}`;
  }

  protected addRow(): void {
    const row: SampleHoursRow = { id: `h-new-${++this.ids}`, day: '', hours: '' };
    this.setSite('openingHours', [...this.siteValues().openingHours, row]);
    this.focusRow(row, '.hours__day input');
  }

  protected updateRow(index: number, patch: Partial<SampleHoursRow>): void {
    const rows = [...this.siteValues().openingHours];
    rows[index] = { ...rows[index], ...patch };
    this.setSite('openingHours', rows);
  }

  protected removeRow(index: number): void {
    const before = this.siteValues().openingHours;
    this.setSite(
      'openingHours',
      before.filter((_, i) => i !== index),
    );
    this.toasts.undo(this.t('list.removed'), () => this.setSite('openingHours', before));
  }

  protected moveRow(index: number, delta: -1 | 1, refocus = '.hours__move-' + (delta < 0 ? 'up' : 'down')): void {
    const rows = [...this.siteValues().openingHours];
    const to = index + delta;
    if (to < 0 || to >= rows.length) {
      return;
    }
    const [row] = rows.splice(index, 1);
    rows.splice(to, 0, row);
    this.setSite('openingHours', rows);
    this.announcement.set(this.t('list.moved', { position: to + 1, count: rows.length }));
    this.focusRow(row, refocus);
  }

  /** Alt+↑/↓ anywhere in a row moves it; focus stays on the element that had it. */
  protected onRowKeydown(event: KeyboardEvent, index: number): void {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) {
      return;
    }
    event.preventDefault();
    const target = event.target as HTMLElement;
    const selector = target.closest('.hours__day') ? '.hours__day input' : target.closest('.hours__hours') ? '.hours__hours input' : null;
    this.moveRow(index, event.key === 'ArrowUp' ? -1 : 1, selector ?? '.hours__handle');
  }

  private focusRow(row: SampleHoursRow, selector: string): void {
    afterNextRender(() => document.getElementById(this.rowId(row))?.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }

  // ── Social links (a catalog of cards) ──────────────────────────────────────

  protected readonly socialSummary = (link: SampleSocialLink) => link.handle || null;

  protected addLink(event: { type: string; index: number }): void {
    const link: SampleSocialLink = { id: `s-new-${++this.ids}`, type: event.type as SampleSocialType, handle: '', url: '' };
    const links = [...this.siteValues().socialLinks];
    links.splice(event.index, 0, link);
    this.setSite('socialLinks', links);
  }

  protected moveLink(event: { from: number; to: number }): void {
    const links = [...this.siteValues().socialLinks];
    const [link] = links.splice(event.from, 1);
    links.splice(event.to, 0, link);
    this.setSite('socialLinks', links);
  }

  protected removeLink(event: { item: SampleSocialLink; index: number }): void {
    const before = this.siteValues().socialLinks;
    this.setSite(
      'socialLinks',
      before.filter((link) => link.id !== event.item.id),
    );
    const type = SOCIAL_TYPES.find((t) => t.id === event.item.type)?.label ?? event.item.type;
    this.toasts.undo(this.t('cardRemoved', { name: event.item.handle || type }), () => this.setSite('socialLinks', before));
  }

  protected duplicateLink(event: { item: SampleSocialLink; index: number }): void {
    const links = [...this.siteValues().socialLinks];
    links.splice(event.index + 1, 0, { ...event.item, id: `s-new-${++this.ids}` });
    this.setSite('socialLinks', links);
  }

  protected updateLink(id: string, patch: Partial<SampleSocialLink>): void {
    this.setSite(
      'socialLinks',
      this.siteValues().socialLinks.map((link) => (link.id === id ? { ...link, ...patch } : link)),
    );
  }

  // ── Misc ───────────────────────────────────────────────────────────────────

  private notice(): void {
    this.toasts.show(this.t('notice'), 'info');
  }

  /** A `styleguide.sample.globals.*` text; inside a `computed` it tracks the language file. */
  protected t(key: string, params?: HashMap): string {
    this.translation();
    return this.transloco.translate(`styleguide.sample.globals.${key}`, params);
  }
}
