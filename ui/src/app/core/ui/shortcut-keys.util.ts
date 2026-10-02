/** One step of a shortcut: a chord of modifiers and a key (`Mod+Shift+K`, `g`, `Alt+ArrowUp`, `?`). */
export interface KeyStep {
  /** The key, lower case; named keys as `KeyboardEvent.key` spells them (`arrowup`, `escape`), the space bar as `space`. */
  readonly key: string;
  /** Ctrl on a PC, Cmd on a Mac — either counts. */
  readonly mod: boolean;
  readonly alt: boolean;
  /** `Shift` is part of the shortcut. A plain letter or named key forbids it; a symbol (`?`, `[`) ignores it. */
  readonly shift: boolean;
}

const SYMBOL = /^[^a-z0-9]$/i;

/**
 * Parses a shortcut in the notation of `sf-kbd`: spaces separate the steps of a sequence (`"g p"`), `+` the keys of a
 * chord (`"Mod+Shift+K"`). `Mod` is Ctrl or Cmd.
 */
export function parseKeys(keys: string): KeyStep[] {
  return keys
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((step) => {
      const parts = step.split(/\+(?!$)/).filter(Boolean);
      const key = (parts.pop() ?? '').toLowerCase();
      const modifiers = new Set(parts.map((part) => part.toLowerCase()));
      return {
        key: key === 'esc' ? 'escape' : key,
        mod: modifiers.has('mod') || modifiers.has('ctrl') || modifiers.has('cmd'),
        alt: modifiers.has('alt'),
        shift: modifiers.has('shift'),
      };
    });
}

/** The key of an event as shortcuts spell it. With Alt held, a Mac types another character, so the physical key counts. */
export function eventKey(event: KeyboardEvent): string {
  if (event.altKey && typeof event.code === 'string') {
    const letter = /^Key([A-Z])$/.exec(event.code);
    if (letter) {
      return letter[1].toLowerCase();
    }
    const digit = /^Digit([0-9])$/.exec(event.code);
    if (digit) {
      return digit[1];
    }
  }
  return event.key === ' ' ? 'space' : event.key.toLowerCase();
}

/** Whether the event is exactly this step: the modifiers match, and so does the key. */
export function matchesStep(step: KeyStep, event: KeyboardEvent): boolean {
  if (step.mod !== (event.ctrlKey || event.metaKey) || step.alt !== event.altKey) {
    return false;
  }
  if (eventKey(event) !== step.key) {
    return false;
  }
  return step.shift ? event.shiftKey : SYMBOL.test(step.key) || !event.shiftKey;
}

/** A shortcut as one comparable string, for conflict checks (`"mod+shift+k"`, `"g p"`). */
export function normalizeKeys(keys: string): string {
  return parseKeys(keys)
    .map((step) => [step.mod ? 'mod' : '', step.alt ? 'alt' : '', step.shift ? 'shift' : '', step.key].filter(Boolean).join('+'))
    .join(' ');
}

/** Whether the event only presses a modifier (nothing to match yet). */
export function isModifierKey(event: KeyboardEvent): boolean {
  return ['control', 'shift', 'alt', 'meta', 'altgraph'].includes(event.key.toLowerCase());
}
