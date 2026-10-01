import { ChangeDetectionStrategy, Component, InjectionToken, computed, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** Whether shortcuts are shown the Mac way (`Mod` = ⌘, `Alt` = ⌥). Override it in specs. */
export const SF_IS_MAC = new InjectionToken<boolean>('SF_IS_MAC', {
  providedIn: 'root',
  factory: () =>
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || ''),
});

/** One key as rendered: a translated (`textKey`) or literal (`text`) cap, plus a spoken name when the cap is a symbol. */
export interface SfKbdKey {
  readonly textKey: string | null;
  readonly text: string;
  readonly nameKey: string | null;
}

/** Key names (lower case) → `shared.kbd.*` caps; `name` adds the spoken word for a symbol cap. */
const NAMED_KEYS: Record<string, { key: string; name?: string }> = {
  ctrl: { key: 'ctrl' },
  control: { key: 'ctrl' },
  cmd: { key: 'cmd', name: 'cmdName' },
  command: { key: 'cmd', name: 'cmdName' },
  meta: { key: 'cmd', name: 'cmdName' },
  shift: { key: 'shift' },
  enter: { key: 'enter' },
  return: { key: 'enter' },
  esc: { key: 'escape' },
  escape: { key: 'escape' },
  space: { key: 'space' },
  tab: { key: 'tab' },
  backspace: { key: 'backspace' },
  del: { key: 'delete' },
  delete: { key: 'delete' },
  up: { key: 'up', name: 'upName' },
  arrowup: { key: 'up', name: 'upName' },
  down: { key: 'down', name: 'downName' },
  arrowdown: { key: 'down', name: 'downName' },
  left: { key: 'left', name: 'leftName' },
  arrowleft: { key: 'left', name: 'leftName' },
  right: { key: 'right', name: 'rightName' },
  arrowright: { key: 'right', name: 'rightName' },
};

/**
 * Parses a shortcut into steps of keys: spaces separate the steps of a sequence (`"g p"`), `+` the keys of a chord
 * (`"Mod+Shift+K"`; a trailing `+` is the plus key itself, `"Mod++"`). `Mod` is ⌘ on a Mac and Ctrl elsewhere.
 */
export function parseShortcut(shortcut: string, isMac: boolean): SfKbdKey[][] {
  return shortcut
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((step) => step.split(/\+(?!$)/).filter(Boolean).map((key) => toKey(key, isMac)));
}

function toKey(raw: string, isMac: boolean): SfKbdKey {
  let lower = raw.toLowerCase();
  if (lower === 'mod') {
    lower = isMac ? 'cmd' : 'ctrl';
  } else if (lower === 'alt' || lower === 'option') {
    return isMac
      ? { textKey: 'shared.kbd.option', text: '', nameKey: 'shared.kbd.optionName' }
      : { textKey: 'shared.kbd.alt', text: '', nameKey: null };
  }
  const named = NAMED_KEYS[lower];
  if (named) {
    return { textKey: `shared.kbd.${named.key}`, text: '', nameKey: named.name ? `shared.kbd.${named.name}` : null };
  }
  return { textKey: null, text: raw.length === 1 ? raw.toUpperCase() : raw, nameKey: null };
}

/**
 * A keyboard shortcut as key caps (M35.6): `<sf-kbd keys="Mod+Shift+K" />`, `<sf-kbd keys="g p" />`.
 *
 * - A chord renders as nested `<kbd>` caps; a space-separated sequence renders its steps one after the other, with a
 *   spoken "then" between them.
 * - `Mod` is ⌘ on a Mac (`SF_IS_MAC`) and Ctrl elsewhere; `Alt` is ⌥ on a Mac. Key names come from `shared.kbd.*`.
 * - Symbol caps (⌘, ⌥, arrows) are hidden from screen readers and a spoken name is read instead, so assistive tech gets
 *   "Command", not a symbol it may skip.
 */
@Component({
  selector: 'sf-kbd',
  standalone: true,
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- The interpolated spaces keep the spoken words apart (not "CtrlShiftK"); the flex layout hides them. -->
    @for (step of steps(); track $index; let last = $last) {
      <kbd class="sf-kbd__chord">
        @for (key of step; track $index; let lastKey = $last) {
          @if (key.nameKey) {
            <kbd class="sf-kbd__key" aria-hidden="true">{{ key.textKey ? (key.textKey | transloco) : key.text }}</kbd>
            <span class="sf-sr-only">{{ key.nameKey | transloco }}</span>
          } @else {
            <kbd class="sf-kbd__key">{{ key.textKey ? (key.textKey | transloco) : key.text }}</kbd>
          }
          @if (!lastKey) {
            {{ ' ' }}
          }
        }
      </kbd>
      @if (!last) {
        {{ ' ' }}<span class="sf-sr-only">{{ 'shared.kbd.then' | transloco }}</span>{{ ' ' }}
      }
    }
  `,
  styleUrl: './sf-kbd.component.scss',
  host: {
    class: 'sf-kbd',
  },
})
export class SfKbdComponent {
  /** The shortcut, e.g. `"Mod+K"`, `"Shift+Enter"` or the sequence `"g p"`. */
  readonly keys = input.required<string>();

  private readonly isMac = inject(SF_IS_MAC);

  protected readonly steps = computed(() => parseShortcut(this.keys(), this.isMac));
}
