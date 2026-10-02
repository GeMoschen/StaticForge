import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfDialogComponent } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { injectSampleText } from '../changes/sample-area.util';
import { PALETTE_CATEGORIES, PaletteCategory, SECTION_TEMPLATES, SampleSectionTemplate } from './pages-data';

type Category = 'all' | PaletteCategory;

/**
 * The Section palette (M35.18 review round 8): a large `sf-dialog` opened by *Add section* and by the **+** between two
 * sections. It names where the section goes ("Insert after: Hero" / "At the start"), has a **filter** field that has the
 * focus (typing narrows the tiles by name, category and description), **categories** on the left (All and the templates'
 * categories with their counts), and the templates as **icon tiles** — the glyph, the name, the category and a one-line
 * description; a template that has a thumbnail shows it in place of the glyph. A template whose limit is reached (`max`) is a
 * disabled tile that says *Maximum of N reached*.
 *
 * Keyboard (the filter field is a combobox over the grid): ← → ↑ ↓ move the active tile, Home / End jump, Enter inserts it,
 * Esc closes; typing keeps filtering. No match is an empty state with *Clear filter*.
 */
@Component({
  selector: 'sf-sample-section-palette',
  standalone: true,
  imports: [SfBadgeComponent, SfButtonComponent, SfDialogComponent, SfEmptyStateComponent, SfIconComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-section-palette.component.scss',
  template: `
    <sf-dialog size="lg" [title]="t('palette.title')" (closed)="cancelled.emit()">
      <div class="palette">
        <p class="palette__where">
          <sf-icon name="subdirectory_arrow_right" />
          {{ after() ? t('palette.after', { name: after() }) : t('palette.atStart') }}
        </p>

        <div class="palette__search">
          <sf-icon class="palette__search-icon" name="search" />
          <input
            #input
            class="palette__input"
            type="text"
            role="combobox"
            autocomplete="off"
            spellcheck="false"
            aria-haspopup="grid"
            [attr.aria-expanded]="true"
            aria-controls="sample-palette-grid"
            [attr.aria-activedescendant]="active() ? 'sample-tile-' + active()!.id : null"
            [attr.aria-label]="t('palette.filter')"
            [placeholder]="t('palette.filter')"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
            (keydown)="onKeydown($event)"
          />
        </div>

        <div class="palette__body">
          <nav class="palette__categories" [attr.aria-label]="t('palette.categories')">
            @for (category of categories(); track category.id) {
              <button
                type="button"
                class="palette__category"
                [class.is-on]="category.id === current()"
                [attr.aria-current]="category.id === current() ? 'true' : null"
                (click)="current.set(category.id)"
              >
                {{ t('palette.category.' + category.id) }}
                <span class="palette__category-count">{{ category.count }}</span>
              </button>
            }
          </nav>

          @if (tiles().length === 0) {
            <sf-empty-state
              class="palette__empty"
              icon="search_off"
              [level]="3"
              [title]="t('palette.empty.title', { query: query() })"
              [description]="t('palette.empty.description')"
              [primaryLabel]="t('palette.empty.clear')"
              (primary)="clear()"
            />
          } @else {
            <ul class="palette__grid" id="sample-palette-grid" role="listbox" [attr.aria-label]="t('palette.templates')">
              @for (tile of tiles(); track tile.id) {
                <li
                  role="option"
                  class="tile"
                  [id]="'sample-tile-' + tile.id"
                  [class.is-active]="active()?.id === tile.id"
                  [class.is-disabled]="isFull(tile)"
                  [attr.aria-selected]="active()?.id === tile.id"
                  [attr.aria-disabled]="isFull(tile) ? 'true' : null"
                  (mousemove)="activate(tile)"
                  (mousedown)="$event.preventDefault()"
                  (click)="choose(tile)"
                >
                  <span class="tile__thumb" aria-hidden="true">
                    @if (tile.thumbnail) {
                      <img class="tile__image" [src]="tile.thumbnail" alt="" />
                    } @else {
                      <sf-icon [name]="tile.icon" />
                    }
                  </span>
                  <span class="tile__text">
                    <span class="tile__name">{{ t('palette.items.' + tile.id + '.name') }}</span>
                    <span class="tile__description">
                      {{ isFull(tile) ? t('palette.full', { max: tile.max }) : t('palette.items.' + tile.id + '.description') }}
                    </span>
                  </span>
                  <sf-badge class="tile__category" tone="neutral" [label]="t('palette.category.' + tile.category)" />
                </li>
              }
            </ul>
          }
        </div>
      </div>

      <ng-container sfDialogFooter>
        <span class="palette__hint">{{ t('palette.hint') }}</span>
        <sf-button variant="ghost" (click)="cancelled.emit()">{{ t('palette.cancel') }}</sf-button>
      </ng-container>
    </sf-dialog>
  `,
})
export class SampleSectionPaletteComponent {
  protected readonly t = injectSampleText('styleguide.sample.pages');

  /** The name of the section the new one goes after; `null` = at the start of the body. */
  readonly after = input<string | null>(null);
  /** How many sections of each template the page has already (by template id), for the `max` limit. */
  readonly counts = input<Readonly<Record<string, number>>>({});
  readonly insert = output<SampleSectionTemplate>();
  readonly cancelled = output<void>();

  private readonly field = viewChild<ElementRef<HTMLInputElement>>('input');
  protected readonly query = signal('');
  protected readonly current = signal<Category>('all');
  private readonly activeId = signal<string | null>(null);

  protected readonly categories = computed(() => [
    { id: 'all' as Category, count: SECTION_TEMPLATES.length },
    ...PALETTE_CATEGORIES.map((id) => ({ id: id as Category, count: SECTION_TEMPLATES.filter((tpl) => tpl.category === id).length })),
  ]);

  protected readonly tiles = computed(() => {
    const needle = this.query().trim().toLowerCase();
    return SECTION_TEMPLATES.filter((tpl) => {
      if (this.current() !== 'all' && tpl.category !== this.current()) {
        return false;
      }
      if (needle === '') {
        return true;
      }
      const text = [
        this.t(`palette.items.${tpl.id}.name`),
        this.t(`palette.items.${tpl.id}.description`),
        this.t(`palette.category.${tpl.category}`),
      ]
        .join(' ')
        .toLowerCase();
      return text.includes(needle);
    });
  });

  /** The active tile: the one the arrows or the pointer chose, else the first one that can still be inserted. */
  protected readonly active = computed(
    () => this.tiles().find((tile) => tile.id === this.activeId()) ?? this.tiles().find((tile) => !this.isFull(tile)) ?? this.tiles()[0] ?? null,
  );

  constructor() {
    afterNextRender(() => this.field()?.nativeElement.focus());
    // A new list starts at its first tile.
    effect(() => {
      this.tiles();
      untracked(() => this.activeId.set(null));
    });
  }

  protected isFull(tile: SampleSectionTemplate): boolean {
    return tile.max !== null && (this.counts()[tile.id] ?? 0) >= tile.max;
  }

  protected activate(tile: SampleSectionTemplate): void {
    this.activeId.set(tile.id);
  }

  protected choose(tile: SampleSectionTemplate): void {
    if (!this.isFull(tile)) {
      this.insert.emit(tile);
    }
  }

  protected clear(): void {
    this.query.set('');
    this.current.set('all');
    this.field()?.nativeElement.focus();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const tiles = this.tiles();
    const index = Math.max(0, tiles.findIndex((tile) => tile.id === this.active()?.id));
    const move = (to: number) => {
      event.preventDefault();
      const target = tiles[Math.min(tiles.length - 1, Math.max(0, to))];
      if (target) {
        this.activeId.set(target.id);
        queueMicrotask(() => document.getElementById(`sample-tile-${target.id}`)?.scrollIntoView?.({ block: 'nearest' }));
      }
    };
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        move(index + (event.key === 'ArrowDown' ? this.columns() : 1));
        return;
      case 'ArrowLeft':
      case 'ArrowUp':
        move(index - (event.key === 'ArrowUp' ? this.columns() : 1));
        return;
      case 'Home':
        if (event.ctrlKey) {
          move(0);
        }
        return;
      case 'End':
        if (event.ctrlKey) {
          move(tiles.length - 1);
        }
        return;
      case 'Enter': {
        event.preventDefault();
        const tile = this.active();
        if (tile) {
          this.choose(tile);
        }
        return;
      }
    }
  }

  /** How many tiles a row of the grid holds (the arrows up and down move by a row). */
  private columns(): number {
    const grid = document.getElementById('sample-palette-grid');
    if (!grid) {
      return 1;
    }
    return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length);
  }
}
