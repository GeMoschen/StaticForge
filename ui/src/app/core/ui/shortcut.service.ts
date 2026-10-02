import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { OverlayStack } from '../../shared/overlay/overlay-stack';

export interface ShortcutOptions {
  mod?: boolean;
  /** `true` requires Shift, `false` forbids it, left out ignores it. */
  shift?: boolean;
  alt?: boolean;
}

const GO_KEYS = ['p', 'm', 't', 'r'] as const;

@Injectable({ providedIn: 'root' })
export class ShortcutService implements OnDestroy {
  readonly commandPaletteOpen = signal(false);
  /** The `?` sheet that lists the shortcuts (M35.10; M35.14 fills it from a registry). */
  readonly shortcutSheetOpen = signal(false);

  private readonly bindings: Array<{
    key: string;
    opts: ShortcutOptions;
    handler: () => void;
  }> = [];

  private pendingPrefix: string | null = null;
  private readonly overlays = inject(OverlayStack);

  private readonly onKeydownRef = (event: KeyboardEvent) =>
    this.onKeydown(event);

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', this.onKeydownRef);
    }
    this.register('k', { mod: true }, () => this.commandPaletteOpen.set(true));
    this.register('?', { shift: true }, () => this.shortcutSheetOpen.set(true));
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.onKeydownRef);
  }

  register(
    key: string,
    opts: ShortcutOptions,
    handler: () => void,
  ): () => void {
    const binding = { key: key.toLowerCase(), opts, handler };
    this.bindings.push(binding);
    return () => {
      const index = this.bindings.indexOf(binding);
      if (index >= 0) {
        this.bindings.splice(index, 1);
      }
    };
  }

  closePalette(): void {
    this.commandPaletteOpen.set(false);
  }

  private onKeydown(event: KeyboardEvent): void {
    // Behind a modal dialog the page is inert; its shortcuts (navigation, the palette) must not fire either.
    if (event.defaultPrevented || this.overlays.hasModal) {
      return;
    }

    const target = event.target as HTMLElement | null;
    const isTyping = !!target && this.isEditable(target);
    const mod = event.metaKey || event.ctrlKey;
    const alt = event.altKey;

    if (!mod && !alt && !isTyping) {
      if (this.pendingPrefix === 'g') {
        const key = event.key.toLowerCase();
        if ((GO_KEYS as readonly string[]).includes(key)) {
          event.preventDefault();
          this.handleGoShortcut(key);
        }
        this.pendingPrefix = null;
        return;
      }
      if (event.key === 'g') {
        this.pendingPrefix = 'g';
        return;
      }
    }

    const matched = this.bindings.find((b) => {
      if ((b.opts.mod ?? false) !== mod) return false;
      if ((b.opts.alt ?? false) !== alt) return false;
      if (b.opts.shift && !event.shiftKey) return false;
      // `shift: false` forbids Shift (Ctrl+S is not Ctrl+Shift+S); left out, Shift is ignored.
      if (b.opts.shift === false && event.shiftKey) return false;
      return (
        b.key === event.key ||
        b.key === event.key.toLowerCase() ||
        b.key === this.keyFor(event)
      );
    });

    if (!matched) {
      return;
    }

    if (isTyping && !mod && matched.key !== 'escape') {
      return;
    }

    event.preventDefault();
    matched.handler();
  }

  private handleGoShortcut(key: string): void {
    // Placeholder for "g p/m/t/r" navigation chords (projects, media,
    // templates, revisions). Wired once the corresponding routes exist.
    void key;
  }

  private keyFor(event: KeyboardEvent): string {
    if (event.key === '?' && event.shiftKey) {
      return '?';
    }
    return event.key.toLowerCase();
  }

  private isEditable(el: HTMLElement): boolean {
    // A key pressed with nothing focused targets `document` (or `window`): not an element, so not an input.
    if (typeof el.tagName !== 'string') {
      return false;
    }
    const tag = el.tagName.toUpperCase();
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      el.isContentEditable
    );
  }
}
