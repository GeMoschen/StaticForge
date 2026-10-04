import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverlayStack } from '../../shared/overlay/overlay-stack';
import { CHORD_TIMEOUT_MS, ShortcutDef, ShortcutService } from './shortcut.service';

function press(init: KeyboardEventInit & { key: string }, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

const def = (id: string, keys: string | undefined, handler?: () => boolean | void, extra: Partial<ShortcutDef> = {}): ShortcutDef => ({
  id,
  keys,
  scope: 'global',
  group: 'general',
  description: `d.${id}`,
  handler,
  ...extra,
});

describe('ShortcutService', () => {
  let service: ShortcutService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ShortcutService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('chords', () => {
    it('runs a sequence when its second key follows in time', () => {
      const go = vi.fn();
      service.register(def('go.pages', 'g p', go));
      press({ key: 'g' });
      expect(go).not.toHaveBeenCalled();
      vi.advanceTimersByTime(CHORD_TIMEOUT_MS - 100);
      const second = press({ key: 'p' });
      expect(go).toHaveBeenCalledTimes(1);
      expect(second.defaultPrevented).toBe(true);
    });

    it('gives up after the timeout, and on a key that completes nothing', () => {
      const go = vi.fn();
      service.register(def('go.pages', 'g p', go));
      press({ key: 'g' });
      vi.advanceTimersByTime(CHORD_TIMEOUT_MS + 1);
      press({ key: 'p' });
      press({ key: 'g' });
      press({ key: 'x' });
      press({ key: 'p' });
      expect(go).not.toHaveBeenCalled();
    });

    it('takes the comma as a key and several chords that share the first key', () => {
      const settings = vi.fn();
      const home = vi.fn();
      service.registerAll([def('go.settings', 'g ,', settings), def('go.home', 'g h', home)]);
      press({ key: 'g' });
      press({ key: ',' });
      press({ key: 'g' });
      press({ key: 'h' });
      expect(settings).toHaveBeenCalledTimes(1);
      expect(home).toHaveBeenCalledTimes(1);
    });

    it('does not start while typing in a field', () => {
      const go = vi.fn();
      service.register(def('go.pages', 'g p', go));
      const input = document.body.appendChild(document.createElement('input'));
      press({ key: 'g' }, input);
      press({ key: 'p' }, input);
      expect(go).not.toHaveBeenCalled();
      input.remove();
    });
  });

  describe('events without a key', () => {
    it('ignores the keydown events autofill dispatches, which carry no key', () => {
      const go = vi.fn();
      service.register(def('go.pages', 'g', go));

      expect(() => document.body.dispatchEvent(new Event('keydown', { bubbles: true }))).not.toThrow();
      expect(go).not.toHaveBeenCalled();
      press({ key: 'g' });
      expect(go).toHaveBeenCalledTimes(1);
    });
  });

  describe('typing', () => {
    it('ignores a shortcut in a text field unless it says allowInInput', () => {
      const create = vi.fn();
      const save = vi.fn();
      service.registerAll([def('create', 'n', create), def('save', 'Mod+S', save, { allowInInput: true }), def('filter', 'Mod+F', vi.fn())]);
      const textarea = document.body.appendChild(document.createElement('textarea'));
      press({ key: 'n' }, textarea);
      press({ key: 's', ctrlKey: true }, textarea);
      expect(create).not.toHaveBeenCalled();
      expect(save).toHaveBeenCalledTimes(1);
      press({ key: 'n' });
      expect(create).toHaveBeenCalledTimes(1);
      textarea.remove();
    });

    it('keeps Shift out of a letter shortcut', () => {
      const save = vi.fn();
      service.register(def('save', 'Mod+S', save));
      press({ key: 'S', ctrlKey: true, shiftKey: true });
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe('scopes', () => {
    it('lets the most specific scope win, and passes the key on when a handler returns false', () => {
      const global = vi.fn();
      const screen = vi.fn(() => false);
      service.register(def('create.global', 'n', global));
      service.register(def('create.screen', 'n', screen, { scope: 'screen' }));
      press({ key: 'n' });
      expect(screen).toHaveBeenCalledTimes(1);
      expect(global).toHaveBeenCalledTimes(1);
    });

    it('stops answering once a registration is taken back', () => {
      const run = vi.fn();
      const off = service.register(def('x', 'x', run));
      press({ key: 'x' });
      off();
      press({ key: 'x' });
      expect(run).toHaveBeenCalledTimes(1);
      expect(service.commands()).toEqual([]);
    });

    it('switches a screen set off when the screen goes away (a route change destroys it)', () => {
      const run = vi.fn();
      @Component({ standalone: true, template: '' })
      class Screen {
        constructor() {
          inject(ShortcutService).use([def('screen.new', 'n', run, { scope: 'screen' })]);
        }
      }
      const fixture = TestBed.createComponent(Screen);
      press({ key: 'n' });
      expect(run).toHaveBeenCalledTimes(1);
      expect(service.commands().map((c) => c.id)).toEqual(['screen.new']);
      fixture.destroy();
      press({ key: 'n' });
      expect(run).toHaveBeenCalledTimes(1);
      expect(service.commands()).toEqual([]);
    });

    it('does not fire behind a modal overlay', () => {
      const run = vi.fn();
      service.register(def('x', 'x', run));
      const pane = document.body.appendChild(document.createElement('div'));
      const handle = TestBed.inject(OverlayStack).push(pane, { layer: 'modal', modal: true });
      press({ key: 'x' });
      expect(run).not.toHaveBeenCalled();
      handle.remove();
      pane.remove();
      press({ key: 'x' });
      expect(run).toHaveBeenCalledTimes(1);
    });
  });

  describe('the registry as data', () => {
    it('lists each command once and only while it is enabled', () => {
      const dev = signal(false);
      service.registerAll([
        def('go.templates', 'g t', vi.fn(), { enabled: () => dev() }),
        def('tree.rename', 'F2', undefined, { group: 'tree', scope: 'component' }),
        def('tree.rename', 'F2', undefined, { group: 'tree', scope: 'component' }),
      ]);
      expect(service.commands().map((c) => c.id)).toEqual(['tree.rename']);
      dev.set(true);
      expect(service.commands().map((c) => c.id)).toEqual(['go.templates', 'tree.rename']);
    });

    it('offers only commands with a handler and palette metadata as actions', () => {
      service.registerAll([
        def('build', 'Alt+Shift+B', vi.fn(), { palette: { icon: 'build' } }),
        def('theme', undefined, vi.fn(), { palette: { icon: 'dark_mode' } }),
        def('doc', 'F2', undefined, { palette: { icon: 'edit' } }),
        def('plain', 'q', vi.fn()),
      ]);
      expect(service.actions().map((c) => c.id)).toEqual(['build', 'theme']);
    });

    it('answers the keys of a command', () => {
      service.register(def('go.pages', 'g p', vi.fn()));
      expect(service.keysOf('go.pages')).toBe('g p');
      expect(service.keysOf('nope')).toBeNull();
    });

    it('reports two shortcuts with the same keys in one scope as a conflict, but not documentation twins', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      service.register(def('a', 'Mod+J', vi.fn()));
      service.register(def('b', 'ctrl+j', vi.fn()));
      expect(error).toHaveBeenCalledTimes(1);
      service.register(def('c', 'Mod+J', vi.fn(), { scope: 'screen' }));
      service.register(def('doc', 'F2', undefined));
      service.register(def('doc2', 'F2', undefined));
      expect(error).toHaveBeenCalledTimes(1);
    });
  });
});
