import { Injectable, signal } from '@angular/core';
import type { SfMenuItem } from '../components/menu/sf-menu-item';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Why the item is unavailable (announced and shown as a tooltip); makes it disabled. */
  disabledReason?: string;
  /** A separator entry: rendered as a line above the next item (its other fields are ignored). */
  separator?: boolean;
  /** A shortcut hint in `sf-kbd` syntax, e.g. `"F2"` or `"Mod+C"`. */
  shortcut?: string;
  /** Consecutive items with the same group are rendered as a labelled group. */
  group?: string;
  /** A submenu. */
  children?: ContextMenuItem[];
  action?: () => void;
}

/** Where a context menu opens: at a pointer position, or below an element (opened from the keyboard). */
export type ContextMenuAnchor =
  | { readonly kind: 'point'; readonly x: number; readonly y: number }
  | { readonly kind: 'element'; readonly element: HTMLElement };

export interface ContextMenuState {
  readonly anchor: ContextMenuAnchor;
  readonly items: SfMenuItem[];
  /** What had focus when the menu opened: focus returns there when it closes. */
  readonly opener: HTMLElement | null;
}

/** What a context menu is opened from: a `contextmenu`/mouse event, a key press, or an element to anchor to. */
export type ContextMenuTarget = MouseEvent | KeyboardEvent | HTMLElement;

/**
 * Root-provided floating context-menu state (M35.7: keyboard anchors, submenus, groups, shortcut hints). Callers do
 * `menu.open(event, items)` from a `(contextmenu)` handler, or pass an element (or a `KeyboardEvent`) to open the menu
 * below it; the single `sf-context-menu` mounted in `app.component.html` renders whatever is open.
 */
@Injectable({ providedIn: 'root' })
export class ContextMenuService {
  readonly state = signal<ContextMenuState | null>(null);

  open(target: ContextMenuTarget, items: ContextMenuItem[]): void {
    let anchor: ContextMenuAnchor | null;
    let ownerDocument: Document;
    if (target instanceof Event) {
      target.preventDefault();
      target.stopPropagation();
      anchor = anchorOf(target);
      ownerDocument = target.target instanceof Node ? (target.target.ownerDocument ?? document) : document;
    } else {
      anchor = { kind: 'element', element: target };
      ownerDocument = target.ownerDocument;
    }
    const menuItems = toMenuItems(items, 'ctx');
    if (!anchor || menuItems.length === 0) {
      return;
    }
    const focused = ownerDocument.activeElement;
    this.state.set({
      anchor,
      items: menuItems,
      opener: focused instanceof HTMLElement && focused !== ownerDocument.body ? focused : null,
    });
  }

  close(): void {
    this.state.set(null);
  }
}

/**
 * A pointer-initiated event opens the menu at the pointer; a keyboard one (`Shift+F10`, the ContextMenu key) below
 * the element it was fired on, since its coordinates don't point at anything the user looks at.
 */
function anchorOf(event: MouseEvent | KeyboardEvent): ContextMenuAnchor | null {
  if (event instanceof MouseEvent && !isKeyboardContextMenu(event)) {
    return { kind: 'point', x: event.clientX, y: event.clientY };
  }
  const element = event.target instanceof HTMLElement ? event.target : event.currentTarget;
  return element instanceof HTMLElement ? { kind: 'element', element } : null;
}

/**
 * Whether a `contextmenu` (mouse) event came from the keyboard. Browsers fire it on the focused element:
 * - Chromium (117+) dispatches a `PointerEvent` whose `pointerType` is `''` for the keyboard, a device name otherwise;
 * - Firefox marks it with `mozInputSource === 6` (KEYBOARD);
 * - the rest (Safari, older engines) dispatch a plain `MouseEvent` at the viewport origin, `(0, 0)` — a spot no real
 *   right click reaches, since the page starts below the browser chrome. That is the fallback rule.
 * A `pointerType` of `mouse`/`pen`/`touch` always means a pointer.
 */
export function isKeyboardContextMenu(event: MouseEvent): boolean {
  const pointerType = (event as Partial<PointerEvent>).pointerType;
  if (typeof pointerType === 'string') {
    return pointerType === '';
  }
  if ((event as MouseEvent & { mozInputSource?: number }).mozInputSource === 6) {
    return true;
  }
  return event.clientX === 0 && event.clientY === 0;
}

/** Maps context-menu entries to menu items: separator entries become `separatorBefore` on the next item. */
function toMenuItems(items: readonly ContextMenuItem[], idPrefix: string): SfMenuItem[] {
  const result: SfMenuItem[] = [];
  let separatorBefore = false;
  items.forEach((entry, index) => {
    if (entry.separator) {
      separatorBefore = true;
      return;
    }
    const id = `${idPrefix}-${index}`;
    result.push({
      id,
      label: entry.label,
      icon: entry.icon,
      danger: entry.danger,
      disabled: entry.disabled,
      disabledReason: entry.disabledReason,
      shortcut: entry.shortcut,
      group: entry.group,
      separatorBefore,
      children: entry.children?.length ? toMenuItems(entry.children, id) : undefined,
      action: entry.action,
    });
    separatorBefore = false;
  });
  return result;
}
