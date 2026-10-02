import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { SampleFieldTagsPipe } from './forms/sample-field-tags.pipe';
import { DomSanitizer } from '@angular/platform-browser';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToastService } from '../../../core/ui/toast.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { SfCopyableComponent } from '../../../shared/components/display/sf-copyable.component';
import { SfTagComponent } from '../../../shared/components/display/sf-tag.component';
import { SfComboboxComponent } from '../../../shared/components/forms/sf-combobox.component';
import { SfDateInputComponent } from '../../../shared/components/forms/sf-date-input.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent } from '../../../shared/components/forms/sf-select.component';
import { SfSwitchComponent } from '../../../shared/components/forms/sf-switch.component';
import { SfTextareaComponent } from '../../../shared/components/forms/sf-textarea.component';
import { SfPageHeaderComponent } from '../../../shared/components/layout/sf-page-header.component';
import { SfSectionComponent } from '../../../shared/components/layout/sf-section.component';
import { UnsavedChangesService } from '../../../shared/components/dialog/unsaved-changes.service';
import { SfSaveState, SfSaveStatusComponent } from '../../../shared/components/layout/sf-save-status.component';
import { SfMenuComponent, SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfSplitterComponent } from '../../../shared/components/splitter/sf-splitter.component';
import { SampleBreadcrumbComponent } from './sample-breadcrumb.component';
import {
  ReleaseActionLanguage,
  ReleaseActionStatus,
  SampleReleaseActionsComponent,
} from './changes/sample-release-actions.component';
import { SampleCatalogFieldComponent } from './sample-catalog-field.component';
import { PICKER_MEDIA, PICKER_PAGES, PickerItem, SAMPLE_HIGHLIGHTS, SAMPLE_INTRO_HTML, SAMPLE_SEO } from './forms/forms-data';
import { SampleGroupFieldComponent } from './forms/sample-group-field.component';
import { SampleListFieldComponent } from './forms/sample-list-field.component';
import { SampleMediaFieldComponent, SampleMediaValue } from './forms/sample-media-field.component';
import { SampleLinkValue, SampleReferenceFieldComponent } from './forms/sample-reference-field.component';
import { SampleRichTextComponent } from './forms/sample-rich-text.component';
import { SampleCard, TEASERS_FIELD, initialTeasers } from './sample-catalog';
import {
  ARTICLE,
  ARTICLE_FIELDS,
  ARTICLE_SHARED,
  BODY_NAME,
  CATEGORY_OPTIONS,
  FIXED_PAGE,
  PRODUCT_OPTIONS,
  LANGUAGE_NAMES,
  SAMPLE_LANGS,
  SECTIONS,
  SampleLang,
  SampleSection,
  SampleStatus,
  TAG_OPTIONS,
  entryById,
} from './sample-data';
import { HERO_SVG, buildPreviewDocument } from './sample-preview';
import { SampleState } from './sample-state';

/** The article's texts that differ per language. */
interface LocalizedValues {
  title: string;
  teaser: string;
  headline: string;
  cta: string;
  text: string;
  quote: string;
}
type LocalizedKey = keyof LocalizedValues;

type Device = 'desktop' | 'tablet' | 'phone';

/** One row of the outline. */
interface OutlineRow {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly level: 1 | 2;
  /** Sections can be reordered with Alt+↑/↓. */
  readonly section?: SampleSection;
}

const SAVE_DELAY_MS = 700;
/** An edit waits this long before it is written (the autosave debounce). */
const DEBOUNCE_MS = 400;
const RELEASE_STATUS: Readonly<Record<SampleStatus, ReleaseActionStatus>> = {
  released: 'released',
  changed: 'changed',
  draft: 'new',
  scheduled: 'scheduled',
};
/** The outline entry (and `focus` query value) of the catalog field. */
export const TEASERS_ROW = 'catalog';
/** Wide enough for outline, form and preview side by side; below it the preview starts hidden. */
const WIDE_QUERY = '(min-width: 1280px)';

/** The fake article's texts; another page gets its own name as the title and borrows the rest. */
function localizedOf(lang: SampleLang, pageId: string): LocalizedValues {
  const { title, teaser, headline, cta, text, quote } = ARTICLE[lang];
  const name = pageId === FIXED_PAGE ? title : (entryById(pageId)?.name ?? title);
  return { title: name, teaser, headline, cta, text, quote };
}

function localizedFor(pageId: string): Record<SampleLang, LocalizedValues> {
  return { de: localizedOf('de', pageId), en: localizedOf('en', pageId) };
}

/**
 * The page editor (M35.18): page header with status per language, favorite, save status and the page actions; a
 * left outline (page fields, the body and its sections, reorderable with Alt+↑/↓); the form in `sf-field`s; and the
 * preview of a fake website page in a collapsible `sf-splitter` pane, updated live from the form. Developer mode adds
 * the template, UID and path. Edits only ever reach the preview.
 */
@Component({
  selector: 'sf-sample-page-editor',
  standalone: true,
  imports: [
    SampleFieldTagsPipe,
    SfSaveStatusComponent,
    NgTemplateOutlet,
    SampleBreadcrumbComponent,
    SampleCatalogFieldComponent,
    SampleGroupFieldComponent,
    SampleListFieldComponent,
    SampleMediaFieldComponent,
    SampleReferenceFieldComponent,
    SampleReleaseActionsComponent,
    SampleRichTextComponent,
    SfButtonComponent,
    SfComboboxComponent,
    SfCopyableComponent,
    SfDateInputComponent,
    SfFieldComponent,
    SfIconComponent,
    SfInputComponent,
    SfMenuComponent,
    SfPageHeaderComponent,
    SfSectionComponent,
    SfSegmentedComponent,
    SfSelectComponent,
    SfSplitterComponent,
    SfSwitchComponent,
    SfTagComponent,
    SfTextareaComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-page-editor.component.html',
  styleUrl: './sample-page-editor.component.scss',
})
export class SamplePageEditorComponent {
  protected readonly state = inject(SampleState);
  private readonly confirms = inject(ConfirmService);
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly toasts = inject(ToastService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly injector = inject(Injector);

  protected readonly fields = ARTICLE_FIELDS;
  protected readonly shared = ARTICLE_SHARED;
  protected readonly categories = CATEGORY_OPTIONS;
  protected readonly tagOptions = TAG_OPTIONS;
  protected readonly products = PRODUCT_OPTIONS;
  protected readonly langs = SAMPLE_LANGS;
  protected readonly bodyName = BODY_NAME;
  protected readonly heroImage = this.sanitizer.bypassSecurityTrustUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(HERO_SVG)}`);

  // ── Form values (nothing is saved) ─────────────────────────────────────────
  private readonly localized = signal(localizedFor(this.state.pageId()));
  protected readonly values = computed(() => this.localized()[this.state.lang()]);
  protected readonly date = signal<string | null>(ARTICLE_SHARED.date);
  protected readonly category = signal<string | null>(ARTICLE_SHARED.category);
  protected readonly tags = signal<string | string[] | null>([...ARTICLE_SHARED.tags]);
  protected readonly inNavigation = signal(ARTICLE_SHARED.inNavigation);
  protected readonly metaDescription = signal(ARTICLE_SHARED.metaDescription);
  protected readonly alt = signal(ARTICLE_SHARED.alt);
  protected readonly ctaLink = signal(ARTICLE_SHARED.ctaLink);
  protected readonly product = signal<string | null>(ARTICLE_SHARED.product);
  protected readonly showPrice = signal(ARTICLE_SHARED.showPrice);
  protected readonly attribution = signal(ARTICLE_SHARED.attribution);
  protected readonly sections = signal<readonly SampleSection[]>(SECTIONS);
  /** The "Product teasers" catalog field (decision 12): cards in order, one teaser with nested badges. */
  protected readonly teasers = signal<readonly SampleCard[]>(initialTeasers());
  protected readonly teasersField = TEASERS_FIELD;

  // The richer content form (M35.17): rich text, a reference, a link, a list, a group, a media field with alt text.
  protected readonly intro = signal(SAMPLE_INTRO_HTML);
  protected readonly related = signal<PickerItem | null>(PICKER_PAGES[4]);
  protected readonly moreLink = signal<SampleLinkValue>({ mode: 'page', page: PICKER_PAGES[3], url: '' });
  protected readonly highlights = signal<readonly string[]>(SAMPLE_HIGHLIGHTS);
  protected readonly seoTitle = signal(SAMPLE_SEO.title);
  protected readonly canonical = signal(SAMPLE_SEO.canonical);
  protected readonly seoOpen = signal(false);
  protected readonly heroMedia = signal<SampleMediaValue | null>({ item: PICKER_MEDIA[1], alt: ARTICLE_SHARED.alt });
  /** The template is localized: a localized field shows the editing language, a shared one "All languages". */
  protected readonly chip = computed(() => LANGUAGE_NAMES[this.state.lang()]);
  protected readonly all = computed(() => 'all');
  protected readonly seoSummary = computed(() => `${this.seoTitle()} · ${this.canonical()}`);
  protected forms(key: string): string {
    return this.state.t(`forms.page.${key}`);
  }
  protected readonly teaserFindings = computed(() =>
    this.values().teaser.length > 140 ? [{ level: 'warning' as const, message: this.state.t('forms.page.teaserLong') }] : [],
  );
  protected readonly metaFindings = computed(() => {
    const error = this.metaError();
    return [
      ...(error ? [{ level: 'error' as const, message: error }] : []),
      { level: 'info' as const, message: this.state.t('forms.page.metaInfo', { count: this.metaDescription().length, max: ARTICLE_SHARED.metaLimit }) },
    ];
  });

  protected readonly metaError = computed(() => {
    const length = this.metaDescription().length;
    return length > ARTICLE_SHARED.metaLimit
      ? this.state.t('editor.metaTooLong', { max: ARTICLE_SHARED.metaLimit, count: length })
      : null;
  });

  // ── Header ─────────────────────────────────────────────────────────────────
  protected readonly favorite = computed(() => this.state.isFavorite(this.state.pageId()));
  protected readonly saving = signal(false);
  /** An edit is waiting for the debounce. */
  private readonly pending = signal(false);
  /** The clock time of the last save ("12:04"). */
  protected readonly savedAt = signal<string | null>(null);
  /** The title is required: a blank one refuses the save ("Not saved — 1 error"). */
  protected readonly titleBlank = computed(() => this.values().title.trim() === '');
  protected readonly saveState = computed<SfSaveState>(() =>
    this.titleBlank() ? 'error' : this.saving() ? 'saving' : this.pending() ? 'dirty' : 'saved',
  );
  protected readonly preview = signal(typeof matchMedia === 'function' ? matchMedia(WIDE_QUERY).matches : true);
  protected readonly device = signal<Device>('desktop');

  protected readonly moreActions = computed<SfMenuItem[]>(() => {
    const item = (id: string, icon: string, extra: Partial<SfMenuItem> = {}): SfMenuItem => ({
      id,
      icon,
      label: this.state.t(`editor.${id}`),
      ...extra,
    });
    return [
      item('saveNow', 'save', { shortcut: 'Mod+S', disabled: this.saveState() === 'saved' || this.saveState() === 'saving' }),
      item('duplicate', 'content_copy', { separatorBefore: true }),
      item('move', 'drive_file_move'),
      item('rename', 'edit', { shortcut: 'F2' }),
      item('copyLink', 'link'),
      item('delete', 'delete', { danger: true, separatorBefore: true }),
    ];
  });

  /** The release actions' per-language status ("Not released" is a new item there). */
  protected readonly releaseStatuses = computed<ReleaseActionLanguage[]>(() => {
    const status = this.state.page().status;
    return SAMPLE_LANGS.map((lang) => ({ lang, status: RELEASE_STATUS[status[lang]] }));
  });

  protected readonly devices = computed<SfSegmentedOption<Device>[]>(() => [
    { value: 'desktop', label: this.state.t('editor.desktop'), icon: 'desktop_windows', iconOnly: true },
    { value: 'tablet', label: this.state.t('editor.tablet'), icon: 'tablet', iconOnly: true },
    { value: 'phone', label: this.state.t('editor.phone'), icon: 'smartphone', iconOnly: true },
  ]);

  // ── Outline ────────────────────────────────────────────────────────────────
  protected readonly selected = signal('fields');
  protected readonly announcement = signal('');
  protected readonly outline = computed<OutlineRow[]>(() => [
    { id: 'fields', label: this.state.t('editor.pageFields'), icon: 'tune', level: 1 },
    { id: 'body', label: BODY_NAME, icon: 'view_agenda', level: 1 },
    ...this.sections().map((section) => ({ id: section.id, label: section.name, icon: section.icon, level: 2 as const, section })),
    { id: TEASERS_ROW, label: TEASERS_FIELD.label, icon: 'view_carousel', level: 1 },
  ]);

  /** Each section's ⋮ menu: move up / down (like Alt+↑/↓), duplicate, delete. */
  protected readonly sectionMenus = computed(() => {
    const list = this.sections();
    return new Map(
      list.map((section, i): [string, SfMenuItem[]] => [
        section.id,
        [
          { id: 'up', label: this.state.t('editor.moveUp'), icon: 'arrow_upward', shortcut: 'Alt+ArrowUp', disabled: i === 0, action: () => this.moveSection(section, -1, false) },
          {
            id: 'down',
            label: this.state.t('editor.moveDown'),
            icon: 'arrow_downward',
            shortcut: 'Alt+ArrowDown',
            disabled: i === list.length - 1,
            action: () => this.moveSection(section, 1, false),
          },
          { id: 'duplicate', label: this.state.t('editor.duplicate'), icon: 'content_copy', action: () => this.state.notice() },
          { id: 'delete', label: this.state.t('editor.delete'), icon: 'delete', danger: true, separatorBefore: true, action: () => this.state.notice() },
        ],
      ]),
    );
  });

  protected readonly previewDoc = computed(() => {
    const lang = this.state.lang();
    const v = this.values();
    const date = this.date();
    const dateLabel = date
      ? new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
      : '';
    const html = buildPreviewDocument({
      lang,
      text: ARTICLE[lang],
      title: v.title,
      teaser: v.teaser,
      headline: v.headline,
      cta: v.cta,
      body: v.text,
      quote: v.quote,
      attribution: this.attribution(),
      alt: this.alt(),
      dateLabel,
      showPrice: this.showPrice(),
      sections: this.sections().map((s) => s.kind),
      teasers: this.teasers(),
    });
    // Our own document, with every value escaped: the preview needs its inline stylesheet, which sanitising strips.
    return this.sanitizer.bypassSecurityTrustHtml(html);
  });

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Another page opened: its own title.
    effect(
      () => {
        const pageId = this.state.pageId();
        untracked(() => this.localized.set(localizedFor(pageId)));
      },
      { allowSignalWrites: true },
    );
    // Autosave look: any edit shows "Saving…", then "Saved" (decision 11) — nothing leaves the browser. Opening a
    // page is not an edit.
    let lastPage: string | null = null;
    effect(
      () => {
        const pageId = this.state.pageId();
        this.localized();
        this.date();
        this.category();
        this.tags();
        this.inNavigation();
        this.metaDescription();
        this.alt();
        this.ctaLink();
        this.product();
        this.showPrice();
        this.attribution();
        this.sections();
        this.teasers();
        if (pageId !== lastPage) {
          lastPage = pageId;
          return;
        }
        untracked(() => this.markSaving());
      },
      { allowSignalWrites: true },
    );
    inject(DestroyRef).onDestroy(() => this.saveTimer && clearTimeout(this.saveTimer));
    const unregister = this.state.registerGuard(() => this.canLeave());
    inject(DestroyRef).onDestroy(unregister);

    // The scripted `focus=catalog` state: the catalog field in view, its outline entry selected.
    afterNextRender(() => {
      const row = this.outline().find((r) => r.id === this.state.focus());
      if (row) {
        this.select(row, 'instant');
        this.state.focus.set(null);
      }
    });
  }

  protected setText(key: LocalizedKey, value: string): void {
    const lang = this.state.lang();
    this.localized.update((all) => ({ ...all, [lang]: { ...all[lang], [key]: value } }));
  }

  protected async secondary(item: SfMenuItem): Promise<void> {
    if (item.id === 'saveNow') {
      this.saveNow();
      return;
    }
    if (item.id !== 'delete') {
      this.state.notice();
      return;
    }
    const name = this.state.page().name;
    const confirmed = await this.confirms.confirm({
      title: this.state.t('editor.deleteTitle', { name }),
      message: this.state.t('editor.deleteMessage'),
      confirmLabel: this.state.t('editor.deleteConfirm'),
      tone: 'danger',
    });
    if (confirmed) {
      this.toasts.undo(this.state.t('folder.deleted', { count: 1, name }), () => this.toasts.show(this.state.t('folder.restored'), 'info'));
    }
  }

  protected toggleFavorite(): void {
    this.state.toggleFavorite(this.state.pageId());
  }

  // ── Outline ────────────────────────────────────────────────────────────────

  protected select(row: OutlineRow, behavior: ScrollBehavior = 'smooth'): void {
    this.selected.set(row.id);
    document.getElementById(this.cardId(row.id))?.scrollIntoView?.({ block: 'start', behavior });
  }

  protected cardId(id: string): string {
    return `sample-card-${id}`;
  }

  protected onOutlineKeydown(event: KeyboardEvent, row: OutlineRow, index: number): void {
    const rows = this.outline();
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.select(row);
      }
      return;
    }
    event.preventDefault();
    const delta = event.key === 'ArrowUp' ? -1 : 1;
    if (event.altKey) {
      if (row.section) {
        this.moveSection(row.section, delta);
      }
      return;
    }
    const next = rows[index + delta];
    if (next) {
      this.select(next);
      this.focusOutline(next.id);
    }
  }

  /** Moves a section one place; from the keyboard the outline row keeps focus. */
  private moveSection(section: SampleSection, delta: -1 | 1, focusOutline = true): void {
    const list = [...this.sections()];
    const from = list.indexOf(section);
    const to = from + delta;
    if (to < 0 || to >= list.length) {
      return;
    }
    list.splice(from, 1);
    list.splice(to, 0, section);
    this.sections.set(list);
    this.announcement.set(this.state.t(delta < 0 ? 'editor.movedUp' : 'editor.movedDown', { name: section.name, position: to + 1 }));
    if (focusOutline) {
      this.focusOutline(section.id);
    }
  }

  private focusOutline(id: string): void {
    // After the list re-rendered in its new order.
    afterNextRender(() => document.getElementById(`sample-outline-${id}`)?.focus(), { injector: this.injector });
  }

  /** An edit: it waits for the debounce (Unsaved changes), then saves (Saving…, Saved) — unless the title is blank. */
  private markSaving(): void {
    this.pending.set(true);
    this.saving.set(false);
    this.schedule(DEBOUNCE_MS);
  }

  /** *Save now* (the overflow menu, Ctrl+S): the debounce is skipped. */
  private saveNow(): void {
    if (this.titleBlank()) {
      this.state.notice('editor.saveRefused');
      return;
    }
    this.schedule(0);
  }

  private schedule(delay: number): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      if (this.titleBlank()) {
        this.saveTimer = null;
        return;
      }
      this.pending.set(false);
      this.saving.set(true);
      this.saveTimer = setTimeout(() => {
        this.saving.set(false);
        this.savedAt.set(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        this.saveTimer = null;
      }, SAVE_DELAY_MS);
    }, delay);
  }

  /** Leaving the page with an edit the autosave could not write asks first (a pending one would simply be flushed). */
  private async canLeave(): Promise<boolean> {
    if (!this.titleBlank()) {
      return true;
    }
    return this.unsaved.confirmLeave({
      name: this.state.page().name,
      save: async () => ({ ok: false, message: this.state.t('editor.saveRefused') }),
      discard: () => this.setText('title', this.state.page().name),
    });
  }
}
