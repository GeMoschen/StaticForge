import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { OverlayStack } from './overlay-stack';

describe('OverlayStack', () => {
  const created: HTMLElement[] = [];
  const element = (html: string) => {
    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div);
    created.push(div);
    return div;
  };
  afterEach(() => created.splice(0).forEach((el) => el.remove()));

  it('restores focus to the opener when focus was inside the overlay', () => {
    const page = element('<button>Opener</button>');
    const opener = page.querySelector('button')!;
    opener.focus();
    const pane = element('<button>Inside</button>');
    const handle = TestBed.inject(OverlayStack).push(pane, { layer: 'drawer', modal: false });
    pane.querySelector('button')!.focus();

    handle.remove();
    expect(document.activeElement).toBe(opener);
  });

  it('leaves focus where the user moved it in the live page beside a non-modal overlay', () => {
    const page = element('<button>Opener</button><input aria-label="Search" />');
    page.querySelector('button')!.focus();
    const pane = element('<button>Inside</button>');
    const handle = TestBed.inject(OverlayStack).push(pane, { layer: 'drawer', modal: false });
    const search = page.querySelector('input')!;
    search.focus();

    handle.remove();
    expect(document.activeElement).toBe(search);
  });

  it('stacks z-index per layer and reports a modal', () => {
    const stack = TestBed.inject(OverlayStack);
    const first = stack.push(element(''), { layer: 'modal', modal: true });
    const panes = created.slice();
    const second = stack.push(element(''), { layer: 'modal', modal: true });

    expect(panes[0].style.zIndex).toBe('calc(var(--sf-z-modal) + 0)');
    expect(created.at(-1)!.style.zIndex).toBe('calc(var(--sf-z-modal) + 1)');
    expect(stack.hasModal).toBe(true);
    second.remove(false);
    first.remove(false);
    expect(stack.hasModal).toBe(false);
    expect(document.querySelectorAll('[inert]')).toHaveLength(0);
  });
});
