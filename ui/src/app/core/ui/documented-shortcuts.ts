import type { ShortcutDef } from './shortcut.service';

/**
 * Keys a component answers to by itself, declared so the registry (and with it the `?` sheet) knows them (M35.14).
 * They have no handler: the component listens on its own element.
 */
export const MOVE_SECTION_SHORTCUTS: readonly ShortcutDef[] = [
  {
    id: 'editing.moveSectionUp',
    keys: 'Alt+ArrowUp',
    scope: 'component',
    group: 'editing',
    description: 'frame.shortcuts.items.moveSectionUp',
  },
  {
    id: 'editing.moveSectionDown',
    keys: 'Alt+ArrowDown',
    scope: 'component',
    group: 'editing',
    description: 'frame.shortcuts.items.moveSectionDown',
  },
];

/** `n` creates a new item on the open screen (M35.14); the screen supplies what that means. */
export function createShortcut(options: {
  /** What *New* does; return `false` when it cannot (read-only), so the key passes on. */
  handler: () => boolean | void;
  enabled?: () => boolean;
  /** A `frame.shortcuts.items.*` key; offers the action in the palette too. */
  palette?: { label: string; context?: () => string | null };
}): ShortcutDef {
  return {
    id: 'create',
    keys: 'n',
    scope: 'screen',
    group: 'screen',
    description: 'frame.shortcuts.items.create',
    handler: options.handler,
    enabled: options.enabled,
    palette: options.palette ? { icon: 'add', ...options.palette } : undefined,
  };
}
