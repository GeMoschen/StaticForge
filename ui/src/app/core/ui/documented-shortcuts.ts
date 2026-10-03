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

/**
 * The media library's keys (M35.19, decision 100), declared so the `?` sheet lists them. The grid, the drawer's header and the
 * focal point handle their keys themselves; these entries have no handler. The caller says when each applies (`enabled`).
 */
export function mediaShortcuts(when: {
  /** The grid has files and is the view. */
  grid: () => boolean;
  /** Any view has files (rename, menu, delete work in the list too). */
  files: () => boolean;
  /** The person may rename and delete. */
  edit: () => boolean;
}): readonly ShortcutDef[] {
  const entry = (id: string, keys: string, enabled: () => boolean): ShortcutDef => ({
    id: `media.${id}`,
    keys,
    scope: 'screen',
    group: 'mediaGrid',
    description: `frame.shortcuts.items.${id}`,
    enabled,
  });
  return [
    entry('gridMove', 'ArrowRight', when.grid),
    entry('gridFirst', 'Home', when.grid),
    entry('gridLast', 'End', when.grid),
    entry('gridSelect', 'Space', when.grid),
    entry('gridAll', 'Mod+A', when.grid),
    entry('gridOpen', 'Enter', when.grid),
    entry('fileRename', 'F2', () => when.files() && when.edit()),
    entry('fileMenu', 'Shift+F10', when.files),
    entry('fileDelete', 'Delete', () => when.files() && when.edit()),
  ];
}

/** The open file drawer's keys: ←/→ step while the focus is in its header, Esc closes it (the overlay stack does that). */
export function mediaDrawerShortcuts(when: { steps: () => boolean }): readonly ShortcutDef[] {
  const entry = (id: string, keys: string, enabled?: () => boolean): ShortcutDef => ({
    id: `media.${id}`,
    keys,
    scope: 'screen',
    group: 'mediaDrawer',
    description: `frame.shortcuts.items.${id}`,
    enabled,
  });
  return [
    entry('drawerPrevious', 'ArrowLeft', when.steps),
    entry('drawerNext', 'ArrowRight', when.steps),
    entry('drawerClose', 'Escape'),
  ];
}

/** The focal point's keys, while a photo's Details tab with an editable focal point is open. */
export function mediaFocalShortcuts(enabled: () => boolean): readonly ShortcutDef[] {
  const entry = (id: string, keys: string): ShortcutDef => ({
    id: `media.${id}`,
    keys,
    scope: 'screen',
    group: 'mediaFocal',
    description: `frame.shortcuts.items.${id}`,
    enabled,
  });
  return [entry('focalMove', 'ArrowRight'), entry('focalMoveBig', 'Shift+ArrowRight')];
}

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
