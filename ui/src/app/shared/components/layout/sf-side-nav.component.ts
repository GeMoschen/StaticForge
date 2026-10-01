import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  numberAttribute,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map, of } from 'rxjs';
import { SfBadgeComponent, SfBadgeTone } from '../display/sf-badge.component';
import { SfSelectComponent, SfSelectOption } from '../forms/sf-select.component';
import { SfIconComponent } from '../sf-icon.component';

/** One entry of an `sf-side-nav`. */
export interface SfSideNavItem {
  /** Unique within the nav; what `current` names and `select` emits. */
  readonly id: string;
  /** Translated. */
  readonly label: string;
  readonly icon?: string;
  /** A router link: the item is an `<a routerLink>` and is current while its route is active. */
  readonly link?: string | readonly unknown[];
  /** Router mode: active only on an exact URL match (default: also on child routes). */
  readonly exact?: boolean;
  /** A count or short text after the label (e.g. the number of findings). */
  readonly badge?: number | string | null;
  readonly badgeTone?: SfBadgeTone;
  /** Translated. Consecutive items with the same group are listed under that heading. */
  readonly group?: string;
}

/** `auto`: a list, a select below `collapseBelow`; `list` / `select`: always that. */
export type SfSideNavMode = 'auto' | 'list' | 'select';

interface SfSideNavSection {
  readonly heading: string | null;
  readonly headingId: string | null;
  readonly items: readonly SfSideNavItem[];
}

let nextId = 0;

/**
 * A secondary side menu for an area's sections (M35.9 decisions 28–29): Publishing (Runs, Targets, Policy, …) and the
 * Settings side menu. Not page tabs: a `<nav aria-label>` of links, which the area's content follows.
 *
 * - **Items** are router links (`link`; `aria-current="page"` via `routerLinkActive`) or, without a link, buttons for
 *   hosts that keep the section elsewhere (a query parameter): the host passes `current` and listens to `select`.
 *   Both kinds may mix; `current`, when set, wins over the router for the select's value.
 * - **Groups:** consecutive items with the same `group` get a small heading (a labelled list, not a document heading,
 *   so the page's heading hierarchy stays the host's).
 * - **Badges:** `badge` (a count or a short word) with an optional `badgeTone`.
 * - **Keyboard:** a plain nav list — Tab goes through the items, Enter/Space activate; no roving tabindex. Focus is
 *   the global `:focus-visible` ring.
 * - **Narrow:** below `collapseBelow` px (default 1024) of the *parent's* width the list collapses into a labelled
 *   `sf-select` with the same entries (counts in brackets), so the content gets the full width. The host should stack
 *   the nav above its content at that width too (the nav's host gets `sf-side-nav--narrow`; `narrow()` is public).
 *   `mode` forces one form (`list` | `select`).
 *
 * Tokens only; the width is the host's (it fills it).
 */
@Component({
  selector: 'sf-side-nav',
  standalone: true,
  exportAs: 'sfSideNav',
  imports: [NgTemplateOutlet, RouterLink, RouterLinkActive, SfBadgeComponent, SfIconComponent, SfSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-side-nav.component.html',
  styleUrl: './sf-side-nav.component.scss',
  host: {
    class: 'sf-side-nav',
    '[class.sf-side-nav--narrow]': 'narrow()',
  },
})
export class SfSideNavComponent {
  readonly items = input.required<readonly SfSideNavItem[]>();
  /** The nav's accessible name (also the select's, when collapsed). */
  readonly label = input.required<string>();
  /** The current item of non-router items (buttons). */
  readonly current = input<string | null>(null);
  readonly mode = input<SfSideNavMode>('auto');
  /** The parent width (px) below which `auto` collapses into a select. */
  readonly collapseBelow = input(1024, { transform: numberAttribute });

  /** A non-router item was chosen (from the list or the collapsed select). */
  readonly select = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly router = inject(Router, { optional: true });
  /** Links resolve relative to this route, as `[routerLink]` does (`null` without a router: from the root). */
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly prefix = `sf-side-nav-${nextId++}`;
  private readonly parentWidth = signal<number | null>(null);
  /** Re-evaluates the router-active item after each navigation. */
  private readonly navigated = toSignal(
    this.router
      ? this.router.events.pipe(
          filter((e) => e instanceof NavigationEnd),
          map((e) => (e as NavigationEnd).id),
        )
      : of(0),
    { initialValue: 0 },
  );

  readonly narrow = computed(() => {
    const mode = this.mode();
    if (mode !== 'auto') {
      return mode === 'select';
    }
    const width = this.parentWidth();
    return width !== null && width > 0 && width < this.collapseBelow();
  });

  protected readonly sections = computed<SfSideNavSection[]>(() => {
    const sections: { heading: string | null; headingId: string | null; items: SfSideNavItem[] }[] = [];
    for (const item of this.items()) {
      const heading = item.group ?? null;
      const last = sections.at(-1);
      if (last && last.heading === heading) {
        last.items.push(item);
      } else {
        sections.push({ heading, headingId: heading ? `${this.prefix}-g${sections.length}` : null, items: [item] });
      }
    }
    return sections;
  });

  /** The id of the current item: `current`, else the first router item whose route is active. */
  protected readonly activeId = computed(() => {
    const current = this.current();
    if (current !== null) {
      return current;
    }
    this.navigated();
    const router = this.router;
    if (!router) {
      return null;
    }
    const found = this.items().find(
      (item) =>
        item.link !== undefined &&
        router.isActive(router.createUrlTree(this.commandsOf(item.link), { relativeTo: this.route }), {
          paths: item.exact ? 'exact' : 'subset',
          queryParams: 'ignored',
          fragment: 'ignored',
          matrixParams: 'ignored',
        }),
    );
    return found?.id ?? null;
  });

  protected readonly options = computed<SfSelectOption<string>[]>(() =>
    this.items().map((item) => ({
      value: item.id,
      label: [item.group, item.label].filter(Boolean).join(' › ') + (item.badge != null && item.badge !== '' ? ` (${item.badge})` : ''),
    })),
  );

  constructor() {
    const destroyRef = inject(DestroyRef);
    const view = inject(DOCUMENT).defaultView;
    afterNextRender(() => {
      const parent = this.host.parentElement;
      if (!parent || !view || typeof ResizeObserver === 'undefined') {
        return;
      }
      const observer = new ResizeObserver(() => this.parentWidth.set(parent.getBoundingClientRect().width));
      observer.observe(parent);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected linkOf(item: SfSideNavItem): string | unknown[] {
    return Array.isArray(item.link) ? [...item.link] : (item.link as string);
  }

  private commandsOf(link: string | readonly unknown[]): unknown[] {
    return Array.isArray(link) ? [...link] : [link];
  }

  protected pick(id: string | null): void {
    const item = this.items().find((i) => i.id === id);
    if (!item) {
      return;
    }
    if (item.link !== undefined && this.router) {
      void this.router.navigate(this.commandsOf(item.link), { relativeTo: this.route });
    } else {
      this.select.emit(item.id);
    }
  }
}
