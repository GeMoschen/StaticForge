import { DestroyRef, Injectable, OnDestroy, computed, inject, isDevMode, signal } from '@angular/core';
import { OverlayStack } from '../../shared/overlay/overlay-stack';
import { KeyStep, isModifierKey, matchesStep, normalizeKeys, parseKeys } from './shortcut-keys.util';

/** How far a shortcut reaches: everywhere, while a screen is open, or while one component is alive. */
export type ShortcutScope = 'global' | 'screen' | 'component';

/** The sheet's groups (`frame.shortcuts.groups.<group>`). */
export type ShortcutGroup =
  | 'screen'
  | 'general'
  | 'goTo'
  | 'publishing'
  | 'editing'
  | 'lists'
  | 'tree'
  | 'mediaGrid'
  | 'mediaDrawer'
  | 'mediaFocal';

/** How a command shows in the palette's *Actions* group. */
export interface ShortcutPalette {
  readonly icon: string;
  /** A Transloco key for the palette row, when it differs from the description (or depends on state). */
  readonly label?: string | (() => string);
  /** Muted text after the name — what the action applies to (the open page's name). */
  readonly context?: () => string | null;
}

/**
 * A command (M35.14): a keyboard shortcut, a palette action, or both. Everything the app answers to is declared as one
 * of these, so the `?` sheet and the palette are generated and never drift from what works.
 */
export interface ShortcutDef {
  /** Unique (`go.pages`, `editor.save`); an id registered twice must be documentation only. */
  readonly id: string;
  /** In `sf-kbd` notation (`Mod+K`, `g p`, `Alt+Shift+R`); none for an action reached only through the palette. */
  readonly keys?: string;
  readonly scope: ShortcutScope;
  readonly group: ShortcutGroup;
  /** The Transloco key of what it does (`frame.shortcuts.items.<id>`). */
  readonly description: string;
  /**
   * What it does. Return `false` when it does not apply right now, so the next registered shortcut with the same keys
   * is tried and the key keeps its normal meaning. Left out, the shortcut is documentation only: a component handles
   * the key itself (an `sf-tree`'s arrows) and registers the entry so the sheet lists it.
   */
  readonly handler?: () => boolean | void;
  /** Whether it applies right now (permissions, developer mode, what is open). Evaluated on every key and every list. */
  readonly enabled?: () => boolean;
  /** Fires while the focus is in a text field. Only for keys that do not type: `Mod+S`, `Mod+K`, `Escape`. */
  readonly allowInInput?: boolean;
  /** Offered in the palette's *Actions*. */
  readonly palette?: ShortcutPalette;
}

interface Registered {
  readonly def: ShortcutDef;
  readonly steps: readonly KeyStep[];
  readonly serial: number;
}

const SCOPE_RANK: Record<ShortcutScope, number> = { global: 0, screen: 1, component: 2 };

/** How long a sequence (`g` … `p`) waits for its next key. */
export const CHORD_TIMEOUT_MS = 1500;

/**
 * The shortcut registry (M35.14): the one keydown listener of the app. Screens and components register what they
 * answer to — an id, the keys, a scope, a description and a handler — and take it back when they go away
 * ({@link use} does that with the injection context), so a route change switches the screen's set off.
 *
 * - **Resolution:** the most specific scope wins (component, then screen, then global); later registrations win within
 *   a scope; a handler that returns `false` passes the key on.
 * - **Typing:** keys typed into an input, textarea, select or editable element are ignored unless the shortcut says
 *   `allowInInput`. A sequence (`g p`) never starts while typing and gives up after {@link CHORD_TIMEOUT_MS}.
 * - **Modal overlays:** while a dialog is open, the page behind it takes no shortcuts.
 * - **Conflicts:** in development, two shortcuts with the same keys in the same scope are logged as an error.
 */
@Injectable({ providedIn: 'root' })
export class ShortcutService implements OnDestroy {
  readonly commandPaletteOpen = signal(false);
  /** What the palette starts with each time it is asked to open (a mode prefix, say `@`); a new object per request. */
  readonly paletteRequest = signal<{ readonly seed: string } | null>(null);
  /** The `?` sheet. */
  readonly shortcutSheetOpen = signal(false);

  private readonly overlays = inject(OverlayStack);
  private readonly registered = signal<readonly Registered[]>([]);
  private serial = 0;

  /** The keys pressed so far of a sequence. */
  private pending: KeyboardEvent[] = [];
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  /** Every command that applies right now, one per id (the sheet's source). */
  readonly commands = computed<readonly ShortcutDef[]>(() => {
    const seen = new Set<string>();
    const out: ShortcutDef[] = [];
    for (const { def } of this.registered()) {
      if (!seen.has(def.id) && this.isEnabled(def)) {
        seen.add(def.id);
        out.push(def);
      }
    }
    return out;
  });

  /** The commands the palette offers as actions: those of what is open first (a screen's *New*), then the global ones. */
  readonly actions = computed(() =>
    this.commands()
      .filter((def) => def.palette && def.handler)
      .sort((a, b) => SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope]),
  );

  private readonly onKeydownRef = (event: KeyboardEvent) => this.onKeydown(event);

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', this.onKeydownRef);
    }
  }

  ngOnDestroy(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', this.onKeydownRef);
    }
    this.clearPending();
  }

  /** Registers a command; returns what takes it back. */
  register(def: ShortcutDef): () => void {
    return this.registerAll([def]);
  }

  registerAll(defs: readonly ShortcutDef[]): () => void {
    const added: Registered[] = defs.map((def) => ({ def, steps: def.keys ? parseKeys(def.keys) : [], serial: this.serial++ }));
    if (isDevMode()) {
      this.reportConflicts(added);
    }
    this.registered.update((all) => [...all, ...added]);
    return () => this.registered.update((all) => all.filter((entry) => !added.includes(entry)));
  }

  /** Registers for as long as the calling injection context lives (a component, a service, a route's environment). */
  use(defs: readonly ShortcutDef[]): void {
    inject(DestroyRef).onDestroy(this.registerAll(defs));
  }

  /**
   * Escape for the calling component, for as long as it lives (a dialog or popover that closes itself). The most recent
   * registration answers first; return `false` when there is nothing to close, so the key passes on. Dialogs on the
   * overlay stack need none of this — the stack closes them.
   */
  useEscape(handler: () => boolean | void): void {
    this.use([
      {
        id: 'close',
        keys: 'Escape',
        scope: 'component',
        group: 'general',
        description: 'frame.shortcuts.items.close',
        allowInInput: true,
        handler,
      },
    ]);
  }

  /** The keys of a registered command, for hints (`go.pages` → `g p`). */
  keysOf(id: string): string | null {
    return this.registered().find((entry) => entry.def.id === id && entry.def.keys)?.def.keys ?? null;
  }

  /** Opens the palette, or — when it is open — restarts it with `seed` (`@` lists the projects). */
  openPalette(seed = ''): void {
    this.paletteRequest.set({ seed });
    this.commandPaletteOpen.set(true);
  }

  closePalette(): void {
    this.commandPaletteOpen.set(false);
  }

  private isEnabled(def: ShortcutDef): boolean {
    return def.enabled ? def.enabled() : true;
  }

  private reportConflicts(added: readonly Registered[]): void {
    for (const entry of added) {
      if (!entry.def.keys) {
        continue;
      }
      const normalized = normalizeKeys(entry.def.keys);
      const clash = this.registered().find(
        (other) =>
          other.def.id !== entry.def.id &&
          other.def.scope === entry.def.scope &&
          !!other.def.handler &&
          !!entry.def.handler &&
          other.def.keys !== undefined &&
          normalizeKeys(other.def.keys) === normalized,
      );
      if (clash) {
        console.error(
          `Shortcut conflict: "${entry.def.id}" and "${clash.def.id}" both use ${entry.def.keys} in the ${entry.def.scope} scope.`,
        );
      }
    }
  }

  private onKeydown(event: KeyboardEvent): void {
    // Autofill and password managers dispatch keydown events without a `key`: not a key press.
    if (typeof event.key !== 'string' || event.defaultPrevented || event.repeat || event.isComposing || isModifierKey(event) || this.overlays.hasModal) {
      return;
    }
    const typing = this.isEditable(event.target);
    const bare = !(event.ctrlKey || event.metaKey || event.altKey);

    if (this.pending.length > 0) {
      this.continueSequence(event);
      return;
    }

    const candidates = this.byPriority().filter((entry) => entry.def.handler && entry.steps.length > 0 && this.isEnabled(entry.def));

    // A sequence starts with a bare key, never while typing.
    if (bare && !typing) {
      const starts = candidates.filter((entry) => entry.steps.length > 1 && matchesStep(entry.steps[0], event));
      if (starts.length > 0) {
        event.preventDefault();
        this.pending = [event];
        this.restartTimer();
        return;
      }
    }

    for (const entry of candidates) {
      if (entry.steps.length !== 1 || !matchesStep(entry.steps[0], event)) {
        continue;
      }
      if (typing && !entry.def.allowInInput) {
        continue;
      }
      if (entry.def.handler!() === false) {
        continue;
      }
      event.preventDefault();
      return;
    }
  }

  private continueSequence(event: KeyboardEvent): void {
    const depth = this.pending.length;
    const typing = this.isEditable(event.target);
    const candidates = this.byPriority().filter(
      (entry) =>
        entry.def.handler &&
        entry.steps.length > depth &&
        this.isEnabled(entry.def) &&
        this.pending.every((pressed, index) => matchesStep(entry.steps[index], pressed)) &&
        matchesStep(entry.steps[depth], event),
    );
    if (typing || candidates.length === 0) {
      this.clearPending();
      return;
    }
    event.preventDefault();
    const complete = candidates.filter((entry) => entry.steps.length === depth + 1);
    for (const entry of complete) {
      this.clearPending();
      if (entry.def.handler!() !== false) {
        return;
      }
    }
    if (complete.length === 0) {
      this.pending = [...this.pending, event];
      this.restartTimer();
    }
  }

  /** Most specific scope first; within a scope the latest registration first. */
  private byPriority(): Registered[] {
    return [...this.registered()].sort(
      (a, b) => SCOPE_RANK[b.def.scope] - SCOPE_RANK[a.def.scope] || b.serial - a.serial,
    );
  }

  private restartTimer(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
    }
    this.pendingTimer = setTimeout(() => this.clearPending(), CHORD_TIMEOUT_MS);
  }

  private clearPending(): void {
    this.pending = [];
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  private isEditable(target: EventTarget | null): boolean {
    // A key pressed with nothing focused targets `document` (or `window`): not an element, so not an input.
    const el = target as HTMLElement | null;
    if (!el || typeof el.tagName !== 'string') {
      return false;
    }
    const tag = el.tagName.toUpperCase();
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      el.isContentEditable === true ||
      !!el.closest?.('[contenteditable]:not([contenteditable="false"])')
    );
  }
}
