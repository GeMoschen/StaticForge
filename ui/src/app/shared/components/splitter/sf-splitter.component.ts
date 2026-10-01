import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  booleanAttribute,
  computed,
  inject,
  input,
  numberAttribute,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { PreferencesService } from '../../../core/preferences/preferences.service';
import { SfButtonComponent } from '../sf-button.component';
import { sfUniqueId } from '../forms/sf-field-context';
import { SfSeparatorDirective } from './sf-separator.directive';

/**
 * Two resizable panes (M35.8): `[sfSplitterStart]` and `[sfSplitterEnd]` content with a separator between them.
 *
 * - `orientation`: `horizontal` puts the panes side by side (a vertical bar, ←/→), `vertical` stacks them (↑/↓).
 * - One pane is sized in px (`sized`: `start` by default), the other takes the rest. `min` / `max` bound it; without
 *   `max` it stops `minOther` px before the far edge.
 * - Keyboard and pointer through {@link SfSeparatorDirective}: arrows (`Shift` for large steps), `Home`/`End`, double
 *   click resets to `defaultSize`, `Enter` collapses or restores a `collapsible` pane; a collapsed pane leaves a
 *   restore button.
 * - With a `paneId`, size and collapsed state persist per user in `PreferencesService` (`paneSizes`).
 */
@Component({
  selector: 'sf-splitter',
  standalone: true,
  imports: [SfButtonComponent, SfSeparatorDirective, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sf-splitter.component.scss',
  template: `
    <div class="sf-splitter__pane sf-splitter__pane--start" [id]="startId" [class.is-sized]="sized() === 'start'" [style]="paneStyle('start')" [hidden]="collapsed() && sized() === 'start'">
      <ng-content select="[sfSplitterStart]" />
    </div>
    <div
      class="sf-splitter__handle"
      [sfSeparator]="separatorOrientation()"
      [sfSeparatorSize]="collapsed() ? min() : size()"
      [sfSeparatorMin]="min()"
      [sfSeparatorMax]="effectiveMax()"
      [sfSeparatorDefault]="defaultSize()"
      [sfSeparatorInvert]="sized() === 'end'"
      [attr.aria-label]="label() ?? ('shared.splitter.resize' | transloco)"
      [attr.aria-controls]="sized() === 'start' ? startId : endId"
      (sfSeparatorSizeChange)="resize($event)"
      (sfSeparatorCollapse)="toggleCollapsed()"
    ></div>
    @if (collapsed()) {
      <sf-button
        class="sf-splitter__restore"
        variant="secondary"
        size="sm"
        [icon]="restoreIcon()"
        [label]="'shared.splitter.restore' | transloco"
        (click)="toggleCollapsed()"
      />
    }
    <div class="sf-splitter__pane sf-splitter__pane--end" [id]="endId" [class.is-sized]="sized() === 'end'" [style]="paneStyle('end')" [hidden]="collapsed() && sized() === 'end'">
      <ng-content select="[sfSplitterEnd]" />
    </div>
  `,
  host: {
    '[class.sf-splitter--horizontal]': "orientation() === 'horizontal'",
    '[class.sf-splitter--vertical]': "orientation() === 'vertical'",
    '[class.sf-splitter--collapsed]': 'collapsed()',
  },
})
export class SfSplitterComponent {
  readonly orientation = input<'horizontal' | 'vertical'>('horizontal');
  /** Persists the size per user under this id; nothing is stored without it. */
  readonly paneId = input<string | null>(null);
  readonly sized = input<'start' | 'end'>('start');
  readonly defaultSize = input(320, { transform: numberAttribute });
  readonly min = input(160, { transform: numberAttribute });
  readonly max = input<number | null>(null);
  /** The smallest the other pane may get when `max` isn't set, px. */
  readonly minOther = input(160, { transform: numberAttribute });
  readonly collapsible = input(false, { transform: booleanAttribute });
  /** The separator's accessible name; `shared.splitter.resize` by default. */
  readonly label = input<string | null>(null);

  protected readonly startId = sfUniqueId('sf-splitter-start');
  protected readonly endId = sfUniqueId('sf-splitter-end');

  private readonly preferences = inject(PreferencesService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** The size the user set in this session; until then the stored one (which may arrive after load). */
  private readonly localSize = signal<number | null>(null);
  private readonly localCollapsed = signal<boolean | null>(null);
  private readonly containerSize = signal(0);

  readonly size = computed(() => {
    const id = this.paneId();
    const value = this.localSize() ?? (id ? this.preferences.paneSize(id) : undefined) ?? this.defaultSize();
    return clamp(value, this.min(), this.effectiveMax());
  });
  readonly collapsed = computed(() => {
    if (!this.collapsible()) {
      return false;
    }
    const id = this.paneId();
    return this.localCollapsed() ?? (id ? this.preferences.paneSize(`${id}.collapsed`) === 1 : false);
  });
  protected readonly effectiveMax = computed(() => {
    const explicit = this.max();
    if (explicit !== null) {
      return Math.max(this.min(), explicit);
    }
    const container = this.containerSize();
    return container > 0 ? Math.max(this.min(), container - this.minOther()) : Number.MAX_SAFE_INTEGER;
  });
  protected readonly separatorOrientation = computed(() => (this.orientation() === 'horizontal' ? 'vertical' : 'horizontal'));
  protected readonly restoreIcon = computed(() => {
    const towardsStart = this.sized() === 'start';
    return this.orientation() === 'horizontal'
      ? towardsStart ? 'chevron_right' : 'chevron_left'
      : towardsStart ? 'expand_more' : 'expand_less';
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      this.measure();
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => this.measure());
        observer.observe(this.host);
        destroyRef.onDestroy(() => observer.disconnect());
      }
    });
  }

  resize(size: number): void {
    this.localSize.set(size);
    if (this.collapsed()) {
      this.setCollapsed(false);
    }
    const id = this.paneId();
    if (id) {
      this.preferences.setPaneSize(id, Math.round(size));
    }
  }

  toggleCollapsed(): void {
    if (this.collapsible()) {
      this.setCollapsed(!this.collapsed());
    }
  }

  protected paneStyle(pane: 'start' | 'end'): Record<string, string> {
    if (pane !== this.sized()) {
      return {};
    }
    return { 'flex-basis': `${this.size()}px` };
  }

  private setCollapsed(collapsed: boolean): void {
    this.localCollapsed.set(collapsed);
    const id = this.paneId();
    if (id) {
      this.preferences.setPaneSize(`${id}.collapsed`, collapsed ? 1 : 0);
    }
  }

  private measure(): void {
    const rect = this.host.getBoundingClientRect();
    this.containerSize.set(this.orientation() === 'horizontal' ? rect.width : rect.height);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
