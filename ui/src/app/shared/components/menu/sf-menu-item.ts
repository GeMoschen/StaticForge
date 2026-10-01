/** One entry of a menu (`sf-menu`, the context menu and their submenus). */
export interface SfMenuItem {
  id: string;
  label: string;
  icon?: string;
  /** Shown but not choosable (`aria-disabled`); stays reachable with the arrow keys. */
  disabled?: boolean;
  /**
   * Why the item is unavailable: announced with the item (`aria-describedby`) and shown as a tooltip. A reason makes
   * the item disabled.
   */
  disabledReason?: string;
  /** Destructive action: danger colour. */
  danger?: boolean;
  /** A separator above this item. */
  separatorBefore?: boolean;
  /** A router link: the item is an `<a>`. */
  link?: string | unknown[];
  /** A shortcut hint in `sf-kbd` syntax (`"Mod+Shift+K"`, `"F2"`, `"g p"`); it does not bind the shortcut. */
  shortcut?: string;
  /** Items of a submenu opened from this item; choosing this item opens it instead. */
  children?: readonly SfMenuItem[];
  /**
   * Consecutive items with the same group are rendered as a labelled `role=group` under a small heading; groups are
   * set apart by separators.
   */
  group?: string;
  /** Run when the item is chosen (after the menu closed), in addition to the menu's `itemSelected` output. */
  action?: () => void;
}

/** Whether the item can't be chosen. */
export function isMenuItemDisabled(item: SfMenuItem): boolean {
  return !!item.disabled || !!item.disabledReason;
}

/** `sf-kbd` key names (lower case) → `aria-keyshortcuts` key values. */
const ARIA_KEYS: Record<string, string> = {
  ctrl: 'Control',
  control: 'Control',
  cmd: 'Meta',
  command: 'Meta',
  meta: 'Meta',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  enter: 'Enter',
  return: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  del: 'Delete',
  delete: 'Delete',
  up: 'ArrowUp',
  arrowup: 'ArrowUp',
  down: 'ArrowDown',
  arrowdown: 'ArrowDown',
  left: 'ArrowLeft',
  arrowleft: 'ArrowLeft',
  right: 'ArrowRight',
  arrowright: 'ArrowRight',
  '+': 'Plus',
};

/**
 * The `aria-keyshortcuts` value of an `sf-kbd` shortcut (`"Mod+Shift+K"` → `"Control+Shift+K"`, `Meta` on a Mac), or
 * null for a key sequence (`"g p"`): the attribute lists alternatives, so it can't express a sequence.
 */
export function toAriaKeyShortcuts(shortcut: string | undefined, isMac: boolean): string | null {
  const steps = (shortcut ?? '').trim().split(/\s+/).filter(Boolean);
  if (steps.length !== 1) {
    return null;
  }
  return steps[0]
    .split(/\+(?!$)/)
    .filter(Boolean)
    .map((key) => {
      const lower = key.toLowerCase();
      if (lower === 'mod') {
        return isMac ? 'Meta' : 'Control';
      }
      return ARIA_KEYS[lower] ?? (key.length === 1 ? key.toUpperCase() : key);
    })
    .join('+');
}
