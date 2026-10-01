import { render } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SF_IS_MAC, SfKbdComponent, parseShortcut } from './sf-kbd.component';

async function renderKbd(keys: string, isMac: boolean): Promise<HTMLElement> {
  await render(`<sf-kbd [keys]="keys" />`, {
    imports: [SfKbdComponent],
    componentProperties: { keys },
    providers: [{ provide: SF_IS_MAC, useValue: isMac }],
  });
  return document.querySelector<HTMLElement>('sf-kbd')!;
}

/** The visible key caps. */
const caps = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('.sf-kbd__key')).map((key) => key.textContent?.trim());

/** What a screen reader gets: everything that is not aria-hidden. */
function spoken(host: HTMLElement): string {
  const clone = host.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return clone.textContent!.replace(/\s+/g, ' ').trim();
}

describe('SfKbdComponent', () => {
  it('renders Mod as Ctrl off a Mac, with key caps in one chord', async () => {
    const host = await renderKbd('Mod+Shift+k', false);

    expect(caps(host)).toEqual(['Ctrl', 'Shift', 'K']);
    expect(host.querySelectorAll('kbd.sf-kbd__chord')).toHaveLength(1);
    expect(spoken(host)).toBe('Ctrl Shift K');
  });

  it('renders Mod as ⌘ on a Mac and gives screen readers the key name', async () => {
    const host = await renderKbd('Mod+Alt+K', true);

    expect(caps(host)).toEqual(['⌘', '⌥', 'K']);
    expect(spoken(host)).toBe('Command Option K');
  });

  it('renders a sequence as steps with a spoken "then"', async () => {
    const host = await renderKbd('g p', false);

    expect(host.querySelectorAll('kbd.sf-kbd__chord')).toHaveLength(2);
    expect(caps(host)).toEqual(['G', 'P']);
    expect(spoken(host)).toBe('G then P');
  });

  it('names arrow keys and translates named keys', async () => {
    const host = await renderKbd('Shift+ArrowUp Escape', false);

    expect(caps(host)).toEqual(['Shift', '↑', 'Esc']);
    expect(spoken(host)).toBe('Shift Up arrow then Esc');
  });

  it('parses a trailing plus as the plus key and keeps unknown names', () => {
    const steps = parseShortcut('Mod++ F2', false);

    expect(steps).toHaveLength(2);
    expect(steps[0].map((key) => key.textKey ?? key.text)).toEqual(['shared.kbd.ctrl', '+']);
    expect(steps[1][0].text).toBe('F2');
  });
});
