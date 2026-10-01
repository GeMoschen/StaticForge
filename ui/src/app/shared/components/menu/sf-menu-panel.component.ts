import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AnchorOptions, AnchorRef, anchorPanel } from '../../overlay/anchored-position';
import { SfTooltipDirective } from '../../directives/sf-tooltip.directive';
import { SF_IS_MAC, SfKbdComponent } from '../display/sf-kbd.component';
import { sfUniqueId } from '../forms/sf-field-context';
import { SfIconComponent } from '../sf-icon.component';
import { SfMenuItem, isMenuItemDisabled, toAriaKeyShortcuts } from './sf-menu-item';

/**
 * Why a panel asks its host to close it: `escape`, `tab` (focus goes back to the opener, then `Tab` moves on) or `back`
 * (`←`: a submenu closes back to its parent item; a top-level menu ignores it).
 */
export type SfMenuCloseReason = 'escape' | 'tab' | 'back';

/** One rendered item with what the template needs about it. */
interface MenuEntry {
  readonly item: SfMenuItem;
  readonly index: number;
  readonly disabled: boolean;
  readonly hasChildren: boolean;
  readonly keyShortcuts: string | null;
}

/** A run of items: a labelled group or plain items, with a separator above it when it isn't the first. */
interface MenuSection {
  readonly group: string | null;
  readonly separator: boolean;
  readonly entries: MenuEntry[];
}

interface OpenSubmenu {
  readonly item: SfMenuItem;
  readonly anchor: HTMLElement;
  readonly focus: 'first' | null;
}

const TYPEAHEAD_RESET_MS = 500;

/**
 * The `role=menu` panel of a menu (M35.7), shared by the menu button (`sf-menu`), the context menu (`sf-context-menu`)
 * and their submenus. The host element is the panel: given an `anchor`, it moves into `<body>` and stays placed next to
 * it (see {@link anchorPanel}) until destroyed, so its styles key on its own classes only.
 *
 * Keyboard (WAI-ARIA menu): `↑`/`↓` move (wrapping), `Home`/`End`, type-ahead on the labels; `Enter`/`Space` choose
 * (`Space` also on link items); `→`, `Enter` or `Space` open an item's submenu with focus on its first item, `←` and
 * `Escape` close it back to that item. Hovering an item focuses it and opens its submenu. Disabled items stay
 * reachable; their reason is announced and shown as a tooltip.
 *
 * The panel never closes itself: it emits `activated` (a leaf item was chosen, from any submenu level) and
 * `closeRequest`, and its host closes it.
 */
@Component({
  selector: 'sf-menu-panel',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, SfIconComponent, SfKbdComponent, SfTooltipDirective, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-menu-panel.component.html',
  styleUrl: './sf-menu-panel.component.scss',
  host: {
    class: 'sf-menu',
    role: 'menu',
    '[attr.id]': 'panelId()',
    '[attr.aria-label]': 'label()',
    '(keydown)': 'onKeydown($event)',
  },
})
export class SfMenuPanelComponent implements AfterViewInit, OnDestroy {
  readonly items = input.required<readonly SfMenuItem[]>();
  /** The menu's accessible name. */
  readonly label = input.required<string>();
  readonly panelId = input<string | null>(null);
  /** What to place the panel next to; without one the panel stays where it is rendered. */
  readonly anchor = input<AnchorRef | null>(null);
  readonly anchorOptions = input<AnchorOptions>({});
  /** The item focused once the panel is rendered. */
  readonly initialFocus = input<'first' | 'last' | null>(null);

  /** A leaf item was chosen (here or in a submenu). */
  readonly activated = output<SfMenuItem>();
  readonly closeRequest = output<SfMenuCloseReason>();

  protected readonly baseId = sfUniqueId('sf-menu-panel');
  protected readonly submenu = signal<OpenSubmenu | null>(null);
  protected readonly openSubmenuId = computed(() => this.submenu()?.item.id ?? null);

  protected readonly sections = computed<MenuSection[]>(() => {
    const sections: { group: string | null; separator: boolean; entries: MenuEntry[] }[] = [];
    this.items().forEach((item, index) => {
      const entry: MenuEntry = {
        item,
        index,
        disabled: isMenuItemDisabled(item),
        hasChildren: !!item.children?.length,
        keyShortcuts: toAriaKeyShortcuts(item.shortcut, this.isMac),
      };
      const group = item.group ?? null;
      const last = sections.at(-1);
      if (last && last.group === group && !item.separatorBefore) {
        last.entries.push(entry);
      } else {
        sections.push({ group, separator: last !== undefined, entries: [entry] });
      }
    });
    return sections;
  });
  /** All entries in DOM order: entry n is the n-th `menuitem`. */
  protected readonly entries = computed(() => this.sections().flatMap((section) => section.entries));
  /** Submenus open beside their item (flipping to the other side when there's no room). */
  protected readonly submenuAnchorOptions: AnchorOptions = { side: 'end', align: 'start', offset: 0 };

  private readonly isMac = inject(SF_IS_MAC);
  private readonly host: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly subPanel = viewChild(SfMenuPanelComponent);
  private stopAnchor: (() => void) | null = null;
  private typeahead = '';
  private typeaheadTimer: ReturnType<typeof setTimeout> | null = null;

  ngAfterViewInit(): void {
    const anchor = this.anchor();
    if (anchor) {
      this.stopAnchor = anchorPanel(anchor, this.host, this.anchorOptions());
    }
    const focus = this.initialFocus();
    if (focus) {
      this.focusItem(focus);
    }
  }

  ngOnDestroy(): void {
    this.stopAnchor?.();
    this.stopAnchor = null;
    if (this.typeaheadTimer) {
      clearTimeout(this.typeaheadTimer);
    }
  }

  /** Focuses the first, the last or the n-th item of this panel. */
  focusItem(target: 'first' | 'last' | number): void {
    const items = this.itemElements();
    const index = target === 'first' ? 0 : target === 'last' ? items.length - 1 : target;
    items[index]?.focus();
  }

  /** Whether `node` is inside this panel or one of its open submenus (which live elsewhere in `<body>`). */
  containsNode(node: Node | null): boolean {
    return !!node && (this.host.contains(node) || !!this.subPanel()?.containsNode(node));
  }

  protected onItemClick(entry: MenuEntry, event: Event): void {
    if (entry.disabled) {
      event.preventDefault();
      return;
    }
    if (entry.hasChildren) {
      event.preventDefault();
      this.openSubmenu(entry.item, event.currentTarget as HTMLElement, 'first');
      return;
    }
    this.activated.emit(entry.item);
  }

  protected onItemHover(entry: MenuEntry, event: MouseEvent): void {
    const element = event.currentTarget as HTMLElement;
    element.focus({ preventScroll: true });
    if (entry.hasChildren && !entry.disabled) {
      this.openSubmenu(entry.item, element, null);
    } else {
      this.closeSubmenu(false);
    }
  }

  protected onSubmenuClose(reason: SfMenuCloseReason): void {
    if (reason === 'tab') {
      this.closeSubmenu(false);
      this.closeRequest.emit('tab');
    } else {
      this.closeSubmenu(true);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    const elements = this.itemElements();
    const index = elements.indexOf(this.document.activeElement as HTMLElement);
    const entry = index >= 0 ? this.entries()[index] : undefined;
    const opensSubmenu = !!entry?.hasChildren && !entry.disabled;
    switch (event.key) {
      case 'ArrowDown':
        this.focusItem((index + 1) % elements.length);
        break;
      case 'ArrowUp':
        this.focusItem((index - 1 + elements.length) % elements.length);
        break;
      case 'Home':
        this.focusItem('first');
        break;
      case 'End':
        this.focusItem('last');
        break;
      case 'ArrowRight':
        if (opensSubmenu) {
          this.openSubmenu(entry.item, elements[index], 'first');
        }
        break;
      case 'ArrowLeft':
        this.closeRequest.emit('back');
        break;
      case 'Escape':
        this.closeRequest.emit('escape');
        break;
      case 'Tab':
        // The panel lives in <body>: the host puts focus back on the opener, then Tab moves on from there.
        this.closeRequest.emit('tab');
        return;
      case 'Enter':
        if (opensSubmenu) {
          this.openSubmenu(entry.item, elements[index], 'first');
          break;
        }
        return; // buttons and links activate on Enter natively
      case ' ':
        if (opensSubmenu) {
          this.openSubmenu(entry.item, elements[index], 'first');
          break;
        }
        // Buttons activate on Space natively; a link item doesn't (the page would scroll instead).
        if (elements[index]?.tagName === 'A') {
          elements[index].click();
          break;
        }
        return;
      default:
        if (event.key.length === 1 && /\S/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
          this.typeAhead(event.key, index);
          break;
        }
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  private openSubmenu(item: SfMenuItem, anchor: HTMLElement, focus: 'first' | null): void {
    const current = this.submenu();
    if (current?.item.id === item.id) {
      if (focus) {
        this.subPanel()?.focusItem(focus);
      }
      return;
    }
    if (current) {
      this.closeSubmenu(false);
    }
    this.submenu.set({ item, anchor, focus });
    // Render the submenu now, so it is placed and focused in this same task.
    this.changeDetector.detectChanges();
  }

  private closeSubmenu(focusItem: boolean): void {
    const current = this.submenu();
    if (!current) {
      return;
    }
    this.submenu.set(null);
    this.changeDetector.detectChanges();
    if (focusItem) {
      current.anchor.focus();
    }
  }

  private typeAhead(char: string, from: number): void {
    this.typeahead += char.toLowerCase();
    if (this.typeaheadTimer) {
      clearTimeout(this.typeaheadTimer);
    }
    this.typeaheadTimer = setTimeout(() => (this.typeahead = ''), TYPEAHEAD_RESET_MS);
    const labels = this.items().map((item) => item.label.toLowerCase());
    // A repeated single letter cycles through the items starting with it; longer input matches from the current item.
    const repeated = this.typeahead.length > 1 && [...this.typeahead].every((c) => c === this.typeahead[0]);
    const prefix = repeated ? this.typeahead[0] : this.typeahead;
    const start = this.typeahead.length === 1 || repeated ? from + 1 : Math.max(from, 0);
    for (let step = 0; step < labels.length; step++) {
      const candidate = (start + step) % labels.length;
      if (labels[candidate].startsWith(prefix)) {
        this.focusItem(candidate);
        return;
      }
    }
  }

  /** This panel's items in order (a submenu rendered inside it, before it moves to `<body>`, doesn't count). */
  private itemElements(): HTMLElement[] {
    return Array.from(this.host.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
      (element) => element.closest('sf-menu-panel') === this.host,
    );
  }
}
