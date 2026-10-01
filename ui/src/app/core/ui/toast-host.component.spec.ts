import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen } from '@testing-library/angular';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastHostComponent } from './toast-host.component';
import { ToastService } from './toast.service';

async function setup() {
  const view = await render(ToastHostComponent);
  const toasts = TestBed.inject(ToastService);
  /** Changes the service, then renders. */
  const act = (fn: () => void) => {
    fn();
    view.fixture.detectChanges();
  };
  return { view, toasts, act };
}

const toastOf = (text: string) => screen.getByText(text).closest('.toast') as HTMLElement;

describe('ToastHostComponent', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('renders news in the polite region and errors in the assertive one', async () => {
    const { toasts, act, view } = await setup();
    act(() => {
      toasts.show('Saved', 'success');
      toasts.show('Could not save', 'error');
    });

    const polite = screen.getByRole('status');
    const assertive = screen.getByRole('alert');
    expect(polite.getAttribute('aria-live')).toBe('polite');
    expect(assertive.getAttribute('aria-live')).toBe('assertive');
    expect(polite.textContent).toContain('Saved');
    expect(polite.textContent).not.toContain('Could not save');
    expect(assertive.textContent).toContain('Could not save');
    expect(toastOf('Saved').querySelector('sf-icon')).toBeTruthy();
    expect(view.fixture.nativeElement.hasAttribute('data-sf-no-inert')).toBe(true);
  });

  it(`shows at most three toasts and promotes a waiting one when one leaves`, async () => {
    const { toasts, act } = await setup();
    act(() => ['One', 'Two', 'Three', 'Four'].forEach((m) => toasts.show(m)));
    expect(screen.queryByText('Four')).toBeNull();

    act(() => toasts.dismiss(toasts.toasts()[0].id));
    expect(screen.queryByText('One')).toBeNull();
    expect(screen.getByText('Four')).toBeTruthy();
  });

  it('toast undo invokes its callback and dismisses', async () => {
    const { toasts, act } = await setup();
    const run = vi.fn();
    act(() => toasts.undo('Page deleted.', run));

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(toasts.toasts()).toEqual([]);
  });

  it('runs a plain action label as given', async () => {
    const { toasts, act } = await setup();
    const run = vi.fn();
    act(() => toasts.show('Released.', 'success', { label: 'Build now', run }));

    fireEvent.click(screen.getByRole('button', { name: 'Build now' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(toasts.toasts()).toEqual([]);
  });

  it('dismisses a toast on request', async () => {
    const { toasts, act, view } = await setup();
    act(() => toasts.show('Saved', 'info'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    view.fixture.detectChanges();
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('pauses on hover and resumes with the remaining time', async () => {
    const { toasts, act } = await setup();
    act(() => toasts.show('Saved', 'success')); // 5 s

    vi.advanceTimersByTime(2_000);
    fireEvent.mouseEnter(toastOf('Saved'));
    vi.advanceTimersByTime(30_000);
    expect(toasts.toasts().length).toBe(1);

    fireEvent.mouseLeave(toastOf('Saved'));
    vi.advanceTimersByTime(2_999);
    expect(toasts.toasts().length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(toasts.toasts()).toEqual([]);
  });

  it('pauses while focus is inside the toast, also when it moves between its buttons', async () => {
    const { toasts, act } = await setup();
    act(() => toasts.undo('Page deleted.', () => undefined)); // 11 s
    const toast = toastOf('Page deleted.');
    const undo = screen.getByRole('button', { name: 'Undo' });
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });

    vi.advanceTimersByTime(1_000);
    fireEvent.focusIn(undo);
    fireEvent.focusOut(undo, { relatedTarget: dismiss });
    fireEvent.focusIn(dismiss);
    vi.advanceTimersByTime(60_000);
    expect(toasts.toasts().length).toBe(1);

    fireEvent.focusOut(dismiss, { relatedTarget: document.body });
    expect(toast.isConnected).toBe(true);
    vi.advanceTimersByTime(9_999);
    expect(toasts.toasts().length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(toasts.toasts()).toEqual([]);
  });

  it('shows a countdown on an action toast that screen readers do not hear tick', async () => {
    const { toasts, act, view } = await setup();
    act(() => toasts.undo('Page deleted.', () => undefined)); // 11 s
    const toast = toastOf('Page deleted.');
    const countdown = toast.querySelector('.toast__countdown') as HTMLElement;
    const bar = toast.querySelector('.toast__bar') as HTMLElement;

    expect(countdown.textContent?.trim()).toBe('11');
    expect(countdown.getAttribute('aria-hidden')).toBe('true');
    expect(bar.getAttribute('aria-hidden')).toBe('true');

    vi.advanceTimersByTime(3_000);
    view.fixture.detectChanges();
    expect(countdown.textContent?.trim()).toBe('8');

    // The sr text is a hidden description of the Undo button: out of the live region's tree, and it does not tick.
    const undo = screen.getByRole('button', { name: 'Undo' });
    const description = document.getElementById(undo.getAttribute('aria-describedby') ?? '') as HTMLElement;
    expect(description.hidden).toBe(true);
    expect(description.textContent?.trim()).toBe('11 seconds left');

    // Focusing the button pauses the clock; the description then states the exact time left.
    fireEvent.focusIn(undo);
    view.fixture.detectChanges();
    expect(description.textContent?.trim()).toBe('8 seconds left');
  });

  it('keeps keyboard focus when a focused toast closes: next toast, else where it came from', async () => {
    const { toasts, act } = await setup();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    act(() => {
      toasts.undo('Deleted A', () => undefined);
      toasts.show('Saved B', 'success');
    });
    const undo = screen.getByRole('button', { name: /Undo/ });
    outside.focus();
    undo.focus();
    fireEvent.focusIn(undo, { relatedTarget: outside });

    act(() => fireEvent.click(undo));
    expect(document.activeElement?.closest('.toast')).toBe(toastOf('Saved B'));

    act(() => fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })));
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('has no countdown on a toast without an action', async () => {
    const { toasts, act } = await setup();
    act(() => toasts.show('Saved', 'success'));
    expect(toastOf('Saved').querySelector('.toast__countdown, .toast__bar')).toBeNull();
  });
});
