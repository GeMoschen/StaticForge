import { describe, expect, it } from 'vitest';
import { anchorPanel, computeAnchorPlacement, pointAnchor } from './anchored-position';

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect;
const viewport = { width: 1000, height: 800 };

describe('computeAnchorPlacement', () => {
  it('places below the anchor, aligned to its start', () => {
    const placement = computeAnchorPlacement(rect(100, 100, 80, 30), { width: 200, height: 150 }, viewport);

    expect(placement).toMatchObject({ top: 134, left: 100, side: 'bottom' });
  });

  it('flips above when there is no room below', () => {
    const placement = computeAnchorPlacement(rect(100, 700, 80, 30), { width: 200, height: 150 }, viewport);

    expect(placement.side).toBe('top');
    expect(placement.top).toBe(700 - 4 - 150);
  });

  it('stays below when neither side fits but below has more room, capping the height', () => {
    const placement = computeAnchorPlacement(rect(100, 300, 80, 30), { width: 200, height: 900 }, viewport);

    expect(placement.side).toBe('bottom');
    expect(placement.maxHeight).toBe(800 - 330 - 4 - 8);
  });

  it('aligns to the end and clamps inside the viewport', () => {
    expect(computeAnchorPlacement(rect(900, 100, 80, 30), { width: 200, height: 50 }, viewport, { align: 'end' }).left).toBe(780);
    expect(computeAnchorPlacement(rect(950, 100, 40, 30), { width: 200, height: 50 }, viewport).left).toBe(792);
    expect(computeAnchorPlacement(rect(0, 100, 20, 30), { width: 200, height: 50 }, viewport, { align: 'center' }).left).toBe(8);
  });

  it('matches the anchor width for lists', () => {
    const placement = computeAnchorPlacement(rect(100, 100, 300, 30), { width: 120, height: 50 }, viewport, {
      matchWidth: true,
    });

    expect(placement.minWidth).toBe(300);
  });

  it('places beside the anchor at its end, top edges aligned (submenus)', () => {
    const placement = computeAnchorPlacement(rect(100, 200, 160, 32), { width: 180, height: 120 }, viewport, {
      side: 'end',
      offset: 0,
    });

    expect(placement).toMatchObject({ top: 200, left: 260, side: 'end', maxHeight: 800 - 16 });
  });

  it('flips to the start side when the end has no room, and clamps vertically', () => {
    const placement = computeAnchorPlacement(rect(700, 750, 200, 32), { width: 180, height: 120 }, viewport, {
      side: 'end',
      offset: 0,
    });

    expect(placement.side).toBe('start');
    expect(placement.left).toBe(700 - 180);
    expect(placement.top).toBe(800 - 8 - 120);
  });

  it('keeps the start side when it fits', () => {
    const placement = computeAnchorPlacement(rect(500, 100, 100, 30), { width: 180, height: 50 }, viewport, {
      side: 'start',
      align: 'end',
      offset: 2,
    });

    expect(placement).toMatchObject({ side: 'start', left: 500 - 2 - 180, top: 130 - 50 });
  });
});

describe('pointAnchor', () => {
  it('is a zero-sized rectangle at the point, placing a panel right below it', () => {
    const anchor = pointAnchor(120, 80);
    const placement = computeAnchorPlacement(anchor.getBoundingClientRect(), { width: 200, height: 100 }, viewport, {
      offset: 0,
    });

    expect(placement).toMatchObject({ top: 80, left: 120, side: 'bottom' });
  });
});

describe('anchorPanel', () => {
  it('moves the panel into <body> and removes it when stopped', () => {
    const dialog = document.createElement('div');
    dialog.style.transform = 'translateY(0)';
    const anchor = document.createElement('button');
    const panel = document.createElement('div');
    dialog.append(anchor, panel);
    document.body.appendChild(dialog);

    const stop = anchorPanel(anchor, panel);
    expect(panel.parentElement).toBe(document.body);
    expect(panel.style.top).not.toBe('');

    stop();
    expect(panel.isConnected).toBe(false);
    dialog.remove();
  });

  it('keeps a scrolling panel below when its CSS max-height fits there', () => {
    const anchor = document.createElement('input');
    const panel = document.createElement('ul');
    panel.style.maxHeight = '200px';
    document.body.append(anchor, panel);
    // jsdom has no layout: the anchor sits at 400px in an 800px window, the list's content is 1,300px tall.
    anchor.getBoundingClientRect = () => ({ top: 400, bottom: 430, left: 10, right: 110, width: 100, height: 30 }) as DOMRect;
    Object.defineProperty(panel, 'scrollHeight', { configurable: true, value: 1300 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });

    const stop = anchorPanel(anchor, panel);
    expect(panel.dataset['side']).toBe('bottom');
    expect(panel.style.maxHeight).toBe('200px');
    stop();
    anchor.remove();
  });
});
