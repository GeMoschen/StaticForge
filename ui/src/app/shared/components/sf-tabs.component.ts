import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SfMenuComponent, SfMenuItem } from './menu/sf-menu.component';

/** One tab: `errors` shows a count badge, `dirty` an unsaved dot, `note` a muted word such as "disabled". */
export interface SfTab {
  id: string;
  label: string;
  errors?: number;
  dirty?: boolean;
  note?: string;
  /** Router mode: where the tab links to. */
  link?: string | unknown[];
  /** Router mode: active only on an exact URL match (default: also on child routes). */
  exact?: boolean;
}

let nextId = 0;

/**
 * The one tab strip (M34, M35.6).
 *
 * - `mode="tabs"` (default): `role="tablist"` with a roving `tabindex` — Tab enters the selected tab, the arrow keys,
 *   Home and End move between tabs and select them. The host renders the panel; {@link panelId} names it for
 *   `aria-controls`, and {@link tabId} labels it (`aria-labelledby`).
 * - `mode="nav"`: page-level navigation — a `<nav>` of router links, the active one with `aria-current="page"`.
 *
 * Tabs that don't fit go into a "More" menu; the selected (or active) tab always stays visible. Projected content
 * (an "add" control, for example) sits after the strip, outside the tab list.
 */
@Component({
  selector: 'sf-tabs',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, RouterLinkActive, SfMenuComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-tabs.component.html',
  styleUrl: './sf-tabs.component.scss',
})
export class SfTabsComponent {
  readonly tabs = input.required<readonly SfTab[]>();
  /** The selected tab (tabs mode). In nav mode the router decides; this is optional there. */
  readonly selected = input<string | null>(null);
  /** The tab list's (or navigation's) accessible name. */
  readonly label = input.required<string>();
  readonly mode = input<'tabs' | 'nav'>('tabs');
  /** The prefix of the tab and panel ids, when the host renders its panels with ids of its own. */
  readonly idPrefix = input<string | null>(null);

  readonly selectTab = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly transloco = inject(TranslocoService);
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private readonly ownPrefix = `sf-tabs-${nextId++}`;

  /** Nav mode: the id of the tab whose link is active. */
  private readonly activeLink = signal<string | null>(null);
  /** Indexes of the tabs that don't fit and live in the "More" menu. */
  protected readonly overflow = signal<ReadonlySet<number>>(new Set());
  private readonly widths = new Map<string, number>();
  private pendingFocus: string | null = null;

  protected readonly current = computed(() => (this.mode() === 'nav' ? this.activeLink() : this.selected()));
  protected readonly moreItems = computed<SfMenuItem[]>(() => {
    const hidden = this.overflow();
    return this.tabs()
      .filter((_, index) => hidden.has(index))
      .map((tab) => ({ id: tab.id, label: this.menuLabel(tab), link: this.mode() === 'nav' ? tab.link : undefined }));
  });

  constructor() {
    // Re-fit after every render (tabs, labels or the selection changed) and whenever the strip is resized.
    afterRender({ write: () => this.layout() });
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.layout());
      afterNextRender({ write: () => this.list() && observer.observe(this.list()!.nativeElement) });
      inject(DestroyRef).onDestroy(() => observer.disconnect());
    }
  }

  tabId(id: string): string {
    return tabIdOf(this.idPrefix() ?? this.ownPrefix, id);
  }

  panelId(id: string): string {
    return panelIdOf(this.idPrefix() ?? this.ownPrefix, id);
  }

  protected onActiveChange(id: string, active: boolean): void {
    if (active) {
      this.activeLink.set(id);
    } else if (this.activeLink() === id) {
      this.activeLink.set(null);
    }
  }

  protected onMoreSelected(item: SfMenuItem): void {
    if (this.mode() === 'tabs') {
      this.pendingFocus = item.id;
      this.selectTab.emit(item.id);
    }
  }

  protected onKeydown(event: KeyboardEvent, id: string): void {
    const ids = this.tabs().map((tab) => tab.id);
    const index = ids.indexOf(id);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % ids.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + ids.length) % ids.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = ids.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.selectTab.emit(ids[next]);
    // A tab from the "More" menu becomes visible once the host has selected it: focus it after that render.
    if (!this.focusTab(ids[next])) {
      this.pendingFocus = ids[next];
    }
  }

  /** Measures the tabs and moves the ones that don't fit into the "More" menu. */
  private layout(): void {
    if (this.pendingFocus && this.focusTab(this.pendingFocus)) {
      this.pendingFocus = null;
    }
    const list = this.list()?.nativeElement;
    if (!list) {
      return; // not rendered yet
    }
    const elements = Array.from(list.querySelectorAll<HTMLElement>('[data-sf-tab]'));
    const tabs = this.tabs();
    for (const element of elements) {
      if (element.offsetWidth > 0) {
        this.widths.set(element.dataset['sfTab']!, element.offsetWidth);
      }
    }
    const more = this.host.nativeElement.querySelector<HTMLElement>('.sf-tabs__more');
    const fit = fitTabs(
      tabs.map((tab) => this.widths.get(tab.id) ?? 0),
      list.clientWidth,
      more?.offsetWidth || MORE_WIDTH_ESTIMATE,
      tabs.findIndex((tab) => tab.id === this.current()),
    );
    if (!sameSet(fit, this.overflow())) {
      this.overflow.set(fit);
    }
  }

  private focusTab(id: string): boolean {
    const element = this.host.nativeElement.querySelector<HTMLElement>(`[data-sf-tab="${CSS.escape(id)}"]`);
    if (!element || element.classList.contains('sf-tabs__tab--overflow')) {
      return false;
    }
    element.focus();
    return true;
  }

  private menuLabel(tab: SfTab): string {
    const parts = [tab.label];
    if (tab.note) {
      parts.push(tab.note);
    }
    if (tab.errors) {
      parts.push(`${tab.errors} ${this.transloco.translate('shared.tabs.errors', { count: tab.errors })}`);
    }
    if (tab.dirty) {
      parts.push(this.transloco.translate('shared.tabs.unsaved'));
    }
    return parts.join(' · ');
  }
}

/** The width the "More" button takes before it has been rendered once, in px. */
const MORE_WIDTH_ESTIMATE = 40;

/**
 * Which tabs go into the "More" menu: none when all fit; otherwise the leading tabs that fit next to the "More"
 * button, plus the selected tab (which takes the place of the last ones that would have fit). Unmeasured tabs (width 0,
 * no layout) count as fitting.
 */
export function fitTabs(widths: readonly number[], available: number, moreWidth: number, selected: number): Set<number> {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= available || available <= 0) {
    return new Set();
  }
  const room = available - moreWidth;
  const visible: number[] = [];
  let used = 0;
  for (let index = 0; index < widths.length && used + widths[index] <= room; index++) {
    visible.push(index);
    used += widths[index];
  }
  if (selected >= 0 && !visible.includes(selected)) {
    while (visible.length && used + widths[selected] > room) {
      used -= widths[visible.pop()!];
    }
    visible.push(selected);
  }
  const shown = new Set(visible);
  return new Set(widths.map((_, index) => index).filter((index) => !shown.has(index)));
}

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

/** The id of tab `id` under `prefix`. */
export function tabIdOf(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`;
}

/** The id of the panel of tab `id` under `prefix`. */
export function panelIdOf(prefix: string, id: string): string {
  return `${prefix}-panel-${id}`;
}
