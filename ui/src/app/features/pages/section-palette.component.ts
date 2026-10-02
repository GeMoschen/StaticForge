import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SfDialogComponent } from '../../shared/components/dialog/sf-dialog.component';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SectionPaletteService } from './section-palette.service';

type TemplateSummary = components['schemas']['TemplateSummary'];

/** The "All" category; any other is the name of the folder the templates sit in. */
const ALL = 'all';

/** A section template as a tile: its name, its UID and the category it is filed under. */
interface Tile {
  readonly uuid: string;
  readonly name: string;
  readonly uid: string;
  readonly category: string;
}

/**
 * The Section palette (M35.18): a large `sf-dialog` opened by *Add section* and by the **+** between two sections. It names
 * where the section goes ("Insert after: Hero" / "Insert at the end of Main"), has a **filter** field that has the focus
 * (typing narrows the tiles by name, UID and category), **categories** on the left (the folders the templates sit in, with
 * their counts — only when there is more than one) and the templates as **icon tiles**.
 *
 * Keyboard (the filter field is a combobox over the grid): ← → ↑ ↓ move the active tile, Ctrl+Home / Ctrl+End jump, Enter
 * inserts it, Esc closes; typing keeps filtering. No match is an empty state with *Clear filter*.
 */
@Component({
  selector: 'sf-section-palette',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfBadgeComponent, SfButtonComponent, SfDialogComponent, SfEmptyStateComponent, SfIconComponent, TranslocoPipe],
  styleUrl: './section-palette.component.scss',
  template: `
    @if (palette.target(); as target) {
      <sf-dialog size="lg" [title]="'pages.palette.title' | transloco" (closed)="palette.close()">
        <div class="palette">
          <p class="palette__where">
            <sf-icon name="subdirectory_arrow_right" />
            {{ where() }}
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
              aria-controls="page-editor-palette-grid"
              [attr.aria-activedescendant]="activeUuid() ? 'page-editor-tile-' + activeUuid() : null"
              [attr.aria-label]="'pages.palette.filter' | transloco"
              [placeholder]="'pages.palette.filter' | transloco"
              [value]="query()"
              (input)="query.set($any($event.target).value)"
              (keydown)="onKeydown($event)"
            />
          </div>

          <div class="palette__body" [class.palette__body--single]="categories().length <= 2">
            @if (categories().length > 2) {
              <nav class="palette__categories" [attr.aria-label]="'pages.palette.categories' | transloco">
                @for (category of categories(); track category.id) {
                  <button
                    type="button"
                    class="palette__category"
                    [class.is-on]="category.id === current()"
                    [attr.aria-current]="category.id === current() ? 'true' : null"
                    (click)="current.set(category.id)"
                  >
                    {{ category.id === allId ? ('pages.palette.all' | transloco) : category.label }}
                    <span class="palette__category-count">{{ category.count }}</span>
                  </button>
                }
              </nav>
            }

            @if (tiles().length === 0) {
              <sf-empty-state
                class="palette__empty"
                icon="search_off"
                [level]="3"
                [title]="(all().length === 0 ? 'pages.palette.empty.none' : 'pages.palette.empty.title') | transloco: { query: query() }"
                [description]="all().length === 0 ? '' : ('pages.palette.empty.description' | transloco)"
                [primaryLabel]="all().length === 0 ? null : ('pages.palette.empty.clear' | transloco)"
                (primary)="clear()"
              />
            } @else {
              <ul class="palette__grid" id="page-editor-palette-grid" role="listbox" [attr.aria-label]="'pages.palette.templates' | transloco">
                @for (tile of tiles(); track tile.uuid) {
                  <li
                    role="option"
                    class="tile"
                    [id]="'page-editor-tile-' + tile.uuid"
                    [class.is-active]="activeUuid() === tile.uuid"
                    [attr.aria-selected]="activeUuid() === tile.uuid"
                    (mousemove)="activeId.set(tile.uuid)"
                    (mousedown)="$event.preventDefault()"
                    (click)="choose(tile)"
                  >
                    <span class="tile__thumb" aria-hidden="true"><sf-icon name="widgets" /></span>
                    <span class="tile__text">
                      <span class="tile__name">{{ tile.name }}</span>
                      <span class="tile__description">{{ tile.uid }}</span>
                    </span>
                    @if (categories().length > 2) {
                      <sf-badge class="tile__category" tone="neutral" [label]="tile.category" />
                    }
                  </li>
                }
              </ul>
            }
          </div>
        </div>

        <ng-container sfDialogFooter>
          <span class="palette__hint">{{ 'pages.palette.hint' | transloco }}</span>
          <sf-button variant="ghost" (click)="palette.close()">{{ 'pages.palette.cancel' | transloco }}</sf-button>
        </ng-container>
      </sf-dialog>
    }
  `,
})
export class SectionPaletteComponent {
  protected readonly palette = inject(SectionPaletteService);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);

  protected readonly allId = ALL;
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('input');
  protected readonly query = signal('');
  protected readonly current = signal<string>(ALL);
  protected readonly activeId = signal<string | null>(null);

  /** Where the section goes, in words. */
  protected readonly where = computed(() => {
    const target = this.palette.target();
    if (!target) {
      return '';
    }
    const body = target.body.label ?? target.body.name;
    if (target.after) {
      return this.transloco.translate('pages.palette.after', { name: target.after });
    }
    return this.transloco.translate(target.position === 0 ? 'pages.palette.atStart' : 'pages.palette.atEnd', { body });
  });

  /** The templates the body allows, as tiles. */
  protected readonly all = computed<Tile[]>(() => {
    const target = this.palette.target();
    if (!target) {
      return [];
    }
    return this.palette
      .allowedTemplates(target.body)
      .filter((template): template is TemplateSummary & { uuid: string } => !!template.uuid)
      .map((template) => ({
        uuid: template.uuid,
        name: template.displayName ?? template.uid ?? template.uuid,
        uid: template.uid ?? '',
        category: categoryOf(template.folderPath) ?? this.transloco.translate('pages.palette.other'),
      }));
  });

  protected readonly categories = computed(() => {
    const counts = new Map<string, number>();
    for (const tile of this.all()) {
      counts.set(tile.category, (counts.get(tile.category) ?? 0) + 1);
    }
    return [
      { id: ALL, label: '', count: this.all().length },
      ...[...counts.entries()].map(([label, count]) => ({ id: label, label, count })),
    ];
  });

  protected readonly tiles = computed(() => {
    const needle = this.query().trim().toLowerCase();
    return this.all().filter((tile) => {
      if (this.current() !== ALL && tile.category !== this.current()) {
        return false;
      }
      return needle === '' || `${tile.name} ${tile.uid} ${tile.category}`.toLowerCase().includes(needle);
    });
  });

  /** The active tile: the one the arrows or the pointer chose, else the first. */
  protected readonly active = computed(() => this.tiles().find((tile) => tile.uuid === this.activeId()) ?? this.tiles()[0] ?? null);

  protected readonly activeUuid = computed(() => this.active()?.uuid ?? null);

  constructor() {
    // Every time the dialog opens: an empty filter, the focus in it.
    effect(() => {
      if (this.palette.target()) {
        untracked(() => {
          this.query.set('');
          this.current.set(ALL);
          this.activeId.set(null);
        });
        afterNextRender(() => this.field()?.nativeElement.focus(), { injector: this.injector });
      }
    });
    // A new list starts at its first tile.
    effect(() => {
      this.tiles();
      untracked(() => this.activeId.set(null));
    });
  }

  protected choose(tile: Tile): void {
    const target = this.palette.target();
    if (target) {
      this.palette.add(target.body, tile.uuid);
    }
  }

  protected clear(): void {
    this.query.set('');
    this.current.set(ALL);
    this.field()?.nativeElement.focus();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const tiles = this.tiles();
    const index = Math.max(0, tiles.findIndex((tile) => tile.uuid === this.active()?.uuid));
    const move = (to: number) => {
      event.preventDefault();
      const target = tiles[Math.min(tiles.length - 1, Math.max(0, to))];
      if (target) {
        this.activeId.set(target.uuid);
        queueMicrotask(() => document.getElementById(`page-editor-tile-${target.uuid}`)?.scrollIntoView?.({ block: 'nearest' }));
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
    const grid = document.getElementById('page-editor-palette-grid');
    return grid ? Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length) : 1;
  }
}

/** The category a template is filed under: the name of its folder, "hero_blocks" read as "Hero blocks"; none at the root. */
function categoryOf(folderPath: string | null | undefined): string | null {
  const segment = (folderPath ?? '').split('/').filter((part) => part !== '').pop();
  if (!segment) {
    return null;
  }
  const words = segment.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
