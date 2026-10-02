import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { highlightRanges } from '../../../../core/ui/fuzzy-match.util';
import { OverlayHandle, OverlayStack } from '../../../../shared/overlay/overlay-stack';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SfKbdComponent } from '../../../../shared/components/display/sf-kbd.component';
import { SampleState } from '../sample-state';
import { PaletteContext, PaletteEntry, PaletteMode, PaletteRow, PaletteSection, buildSections, parseQuery } from './keyboard-data';

interface OptionView {
  readonly id: string;
  readonly row: PaletteRow;
  readonly parts: { text: string; mark: boolean }[];
}

interface SectionView {
  readonly group: PaletteSection['group'];
  readonly headingId: string;
  readonly options: OptionView[];
  readonly more: number;
}

const EDITOR_NAMES = ['editor', 'record', 'template'];

/**
 * The mocked M35.14 command palette: a modal combobox over grouped results — Actions (those that fit what is open),
 * Navigate, Recent, Favorites and Search results — with fuzzy matching, key hints on the right and the prefix modes `>`
 * actions, `#` settings, `@` projects (a chip names the mode; Backspace on an empty box leaves it). Developer-only
 * entries are left out when developer mode is off. Nothing is saved; running an entry changes the sample screen.
 */
@Component({
  selector: 'sf-sample-palette',
  standalone: true,
  imports: [SfIconComponent, SfKbdComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-palette.component.html',
  styleUrl: './sample-palette.component.scss',
})
export class SamplePaletteComponent implements OnDestroy {
  protected readonly state = inject(SampleState);
  private readonly overlays = inject(OverlayStack);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly input = viewChild<ElementRef<HTMLInputElement>>('input');

  protected readonly listboxId = 'sample-palette-listbox';
  protected readonly query = signal(this.state.paletteQuery() ?? '');
  protected readonly activeIndex = signal(0);
  private handle: OverlayHandle | null = null;

  protected readonly parsed = computed(() => parseQuery(this.query()));
  protected readonly mode = computed<PaletteMode>(() => this.parsed().mode);
  /** What the box shows: the whole query, or — once a prefix became the mode chip — the text after it. */
  protected readonly display = computed(() => (this.mode() === 'all' ? this.query() : this.parsed().rest));

  private readonly context = computed<PaletteContext>(() => {
    const view = this.state.view();
    const item = view === 'editor' ? this.state.page().name : view === 'folder' ? (this.state.folder()?.name ?? null) : view === 'record' ? this.state.recordName(this.state.record()) : null;
    const dark = this.state.theme() === 'dark';
    return { view, dev: this.state.devMode(), dark, compact: this.state.density() === 'compact', itemName: EDITOR_NAMES.includes(view) || view === 'folder' ? item : null,
      recents: this.state.recents(),
      favorites: this.state.favorites(),
      pageFavorite: view === 'editor' ? this.state.isFavorite(this.state.pageId()) : null,
    };
  });

  protected readonly sections = computed<SectionView[]>(() => {
    this.state.t('keyboard.title'); // tracks the language file
    let index = 0;
    return buildSections(this.query(), this.context(), (entry) => this.label(entry)).map((section) => ({
      group: section.group,
      headingId: `sample-palette-group-${section.group}`,
      more: section.more,
      options: section.rows.map((row) => ({
        id: `sample-palette-opt-${index++}`,
        row,
        parts: highlightRanges(row.label, row.match?.ranges ?? []),
      })),
    }));
  });

  protected readonly options = computed(() => this.sections().flatMap((section) => section.options));
  protected readonly active = computed<OptionView | null>(() => this.options()[this.activeIndex()] ?? null);

  protected readonly placeholder = computed(() =>
    this.state.t(`keyboard.placeholders.${this.mode()}`),
  );
  protected readonly announcement = computed(() => this.state.t('keyboard.announce', { count: this.options().length }));

  constructor() {
    effect(() => {
      this.query();
      untracked(() => this.activeIndex.set(0));
    });
    afterNextRender(() => {
      // Like `sf-dialog`: leave the screen's subtree, which the modal makes `inert`.
      this.host.ownerDocument.body.appendChild(this.host);
      this.handle = this.overlays.push(this.host, { layer: 'modal', modal: true, onEscape: () => this.close() });
      this.input()?.nativeElement.focus();
    });
  }

  ngOnDestroy(): void {
    this.handle?.remove();
    this.host.remove();
  }

  protected close(): void {
    this.state.paletteQuery.set(null);
  }

  protected label(entry: PaletteEntry): string {
    return entry.text ?? this.state.t(entry.labelKey!);
  }

  protected contextText(entry: PaletteEntry): string | null {
    if (!entry.context) {
      return null;
    }
    return entry.context === 'settings' ? this.state.t('rail.settings') : entry.context === '@' ? this.state.t('keyboard.modes.projects') : entry.context;
  }

  protected onInput(event: Event): void {
    const field = event.target as HTMLInputElement;
    const prefix = this.mode() === 'all' ? '' : this.query().charAt(0);
    this.query.set(prefix + field.value);
    // Typing a prefix turns it into the chip: the box must not keep showing it.
    field.value = this.display();
  }

  /** Backspace on an empty box leaves the mode (the prefix is the first character of the query). */
  protected onKeydown(event: KeyboardEvent): void {
    const count = this.options().length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (count > 0) {
          const step = event.key === 'ArrowDown' ? 1 : -1;
          this.activeIndex.update((i) => (i + step + count) % count);
          this.scrollActive();
        }
        return;
      }
      case 'Enter':
        event.preventDefault();
        if (this.active()) {
          this.run(this.active()!.row.entry);
        }
        return;
      case 'Backspace':
        if (this.parsed().rest === '' && this.mode() !== 'all') {
          event.preventDefault();
          this.query.set('');
        }
        return;
      case 'Tab':
        event.preventDefault();
        return;
    }
  }

  protected hover(option: OptionView): void {
    this.activeIndex.set(this.options().indexOf(option));
  }

  protected run(entry: PaletteEntry): void {
    const run = entry.run;
    if (run.kind === 'switch-mode') {
      this.query.set(run.prefix);
      this.input()?.nativeElement.focus();
      return;
    }
    this.close();
    switch (run.kind) {
      case 'area':
        void this.state.canLeave().then((ok) => ok && this.state.openArea(run.area));
        break;
      case 'page':
        void this.state.canLeave().then((ok) => ok && this.state.openPage(run.id));
        break;
      case 'favorite-open':
        this.state.openFavorite(run.favorite);
        break;
      case 'favorite':
        this.state.toggleFavorite(this.state.pageId());
        break;
      case 'history':
        this.state.history.set(this.state.view() === 'editor' ? 'page' : 'project');
        break;
      case 'toggle':
        if (run.what === 'theme') {
          this.state.theme.set(this.state.theme() === 'dark' ? 'light' : 'dark');
        } else if (run.what === 'density') {
          this.state.density.set(this.state.density() === 'compact' ? 'comfortable' : 'compact');
        } else {
          this.state.devMode.update((dev) => !dev);
        }
        break;
      case 'notice':
        this.state.notice(run.key, run.params);
        break;
    }
  }

  private scrollActive(): void {
    const id = this.active()?.id;
    queueMicrotask(() => id && this.host.querySelector<HTMLElement>(`#${id}`)?.scrollIntoView({ block: 'nearest' }));
  }
}
