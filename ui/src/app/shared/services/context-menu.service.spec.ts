import { describe, expect, it, vi } from 'vitest';
import { ContextMenuService, isKeyboardContextMenu } from './context-menu.service';

function contextMenuEvent(init: MouseEventInit, pointerType?: string): MouseEvent {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...init });
  if (pointerType !== undefined) {
    Object.defineProperty(event, 'pointerType', { value: pointerType });
  }
  return event;
}

describe('isKeyboardContextMenu', () => {
  it('tells a pointer from the keyboard by pointerType where the event has one', () => {
    expect(isKeyboardContextMenu(contextMenuEvent({ clientX: 300, clientY: 200 }, ''))).toBe(true);
    expect(isKeyboardContextMenu(contextMenuEvent({ clientX: 0, clientY: 0 }, 'mouse'))).toBe(false);
    expect(isKeyboardContextMenu(contextMenuEvent({ clientX: 10, clientY: 10 }, 'touch'))).toBe(false);
  });

  it('falls back to Firefox mozInputSource, then to the viewport origin', () => {
    const firefox = contextMenuEvent({ clientX: 300, clientY: 200 });
    Object.defineProperty(firefox, 'mozInputSource', { value: 6 });
    expect(isKeyboardContextMenu(firefox)).toBe(true);
    expect(isKeyboardContextMenu(contextMenuEvent({}))).toBe(true);
    expect(isKeyboardContextMenu(contextMenuEvent({ clientX: 120, clientY: 80 }))).toBe(false);
  });
});

describe('ContextMenuService', () => {
  it('opens at the pointer for a right click and cancels the native menu', () => {
    const service = new ContextMenuService();
    const button = document.body.appendChild(document.createElement('button'));
    const event = contextMenuEvent({ clientX: 120, clientY: 80 });
    Object.defineProperty(event, 'target', { value: button });

    service.open(event, [{ label: 'Rename' }]);

    expect(event.defaultPrevented).toBe(true);
    expect(service.state()?.anchor).toEqual({ kind: 'point', x: 120, y: 80 });
    button.remove();
  });

  it('anchors to the element for a keyboard contextmenu, a KeyboardEvent or an element, remembering the focus', () => {
    const service = new ContextMenuService();
    const button = document.body.appendChild(document.createElement('button'));
    button.focus();

    const keyboardMenu = contextMenuEvent({});
    Object.defineProperty(keyboardMenu, 'target', { value: button });
    service.open(keyboardMenu, [{ label: 'Rename' }]);
    expect(service.state()?.anchor).toEqual({ kind: 'element', element: button });
    expect(service.state()?.opener).toBe(button);

    const shiftF10 = new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, cancelable: true });
    Object.defineProperty(shiftF10, 'target', { value: button });
    service.open(shiftF10, [{ label: 'Rename' }]);
    expect(shiftF10.defaultPrevented).toBe(true);
    expect(service.state()?.anchor).toEqual({ kind: 'element', element: button });

    service.open(button, [{ label: 'Rename' }]);
    expect(service.state()?.anchor).toEqual({ kind: 'element', element: button });
    button.remove();
  });

  it('maps entries to menu items: separators above the next item, submenus, the new fields', () => {
    const service = new ContextMenuService();
    const action = vi.fn();

    service.open(document.body, [
      { label: 'Rename', shortcut: 'F2', action },
      { separator: true, label: '' },
      { label: 'Delete', danger: true, disabledReason: 'Locked' },
      { label: 'Move to', group: 'Organise', children: [{ label: 'Archive' }] },
    ]);

    const items = service.state()!.items;
    expect(items.map((item) => item.label)).toEqual(['Rename', 'Delete', 'Move to']);
    expect(items[0]).toMatchObject({ shortcut: 'F2', action, separatorBefore: false });
    expect(items[1]).toMatchObject({ danger: true, disabledReason: 'Locked', separatorBefore: true });
    expect(items[2]).toMatchObject({ group: 'Organise', children: [expect.objectContaining({ label: 'Archive' })] });
    expect(new Set(items.map((item) => item.id)).size).toBe(3);
  });

  it('opens nothing without items, and closes', () => {
    const service = new ContextMenuService();
    service.open(document.body, []);
    expect(service.state()).toBeNull();

    service.open(document.body, [{ label: 'Rename' }]);
    service.close();
    expect(service.state()).toBeNull();
  });
});
