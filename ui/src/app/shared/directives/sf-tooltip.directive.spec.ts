import { Component, signal } from '@angular/core';
import { fireEvent, render, screen } from '@testing-library/angular';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SfTooltipDirective } from './sf-tooltip.directive';

@Component({
  standalone: true,
  imports: [SfTooltipDirective],
  template: `<button type="button" [sfTooltip]="text()" aria-describedby="own">Publish</button><p id="own">Own</p>`,
})
class Host {
  readonly text = signal<string | null>('Publishes the site');
}

describe('SfTooltipDirective', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function setup() {
    const result = await render(Host);
    const button = screen.getByRole('button', { name: 'Publish' });
    return { ...result, button };
  }

  it('shows after the hover delay, never as a title attribute', async () => {
    const { button } = await setup();

    fireEvent.mouseEnter(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
    vi.advanceTimersByTime(500);

    expect(screen.getByRole('tooltip')).toHaveTextContent('Publishes the site');
    expect(button).not.toHaveAttribute('title');
  });

  it('describes its element while shown, keeping the element’s own description', async () => {
    const { button } = await setup();

    fireEvent.mouseEnter(button);
    vi.advanceTimersByTime(500);
    expect(button).toHaveAccessibleDescription('Own Publishes the site');

    fireEvent.mouseLeave(button);
    vi.advanceTimersByTime(200);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(button).toHaveAttribute('aria-describedby', 'own');
  });

  it('shows at once on keyboard focus and hides on blur', async () => {
    const { button } = await setup();
    vi.spyOn(button, 'matches').mockReturnValue(true);

    fireEvent.focusIn(button);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.focusOut(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('stays hidden on mouse focus', async () => {
    const { button } = await setup();
    vi.spyOn(button, 'matches').mockReturnValue(false);

    fireEvent.focusIn(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('dismisses on Escape', async () => {
    const { button } = await setup();
    fireEvent.mouseEnter(button);
    vi.advanceTimersByTime(500);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('stays open while the pointer moves onto the tooltip', async () => {
    const { button } = await setup();
    fireEvent.mouseEnter(button);
    vi.advanceTimersByTime(500);
    const tip = screen.getByRole('tooltip');

    fireEvent.mouseLeave(button);
    fireEvent.mouseEnter(tip);
    vi.advanceTimersByTime(500);
    expect(screen.getByRole('tooltip')).toBe(tip);
  });

  it('shows nothing for an empty text and hides when the text empties', async () => {
    const { button, fixture } = await setup();
    fireEvent.mouseEnter(button);
    vi.advanceTimersByTime(500);

    fixture.componentInstance.text.set(null);
    fixture.detectChanges();
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(button);
    vi.advanceTimersByTime(500);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('removes its tooltip when the element is destroyed', async () => {
    const { button, fixture } = await setup();
    fireEvent.mouseEnter(button);
    vi.advanceTimersByTime(500);

    fixture.destroy();
    expect(document.querySelector('.sf-tooltip')).toBeNull();
  });
});
