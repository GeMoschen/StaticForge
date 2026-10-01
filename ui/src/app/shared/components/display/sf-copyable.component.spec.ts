import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SfCopyableComponent } from './sf-copyable.component';

const VALUE = '3f2a9c4e-1b7d-4e3a-9f00-aa11bb22cc33';

describe('SfCopyableComponent', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    writeText.mockReset();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => vi.useRealTimers());

  const icon = (button: HTMLElement) => button.querySelector('.material-symbols-outlined')?.textContent?.trim();

  it('shows the value in monospace with a named copy button', async () => {
    await render(`<sf-copyable [value]="value" label="UUID" />`, {
      imports: [SfCopyableComponent],
      componentProperties: { value: VALUE },
    });

    expect(screen.getByText(VALUE).tagName).toBe('CODE');
    const button = screen.getByRole('button', { name: 'Copy UUID' });
    expect(icon(button)).toBe('content_copy');
  });

  it('names the button "Copy" without a label', async () => {
    await render(`<sf-copyable value="/pages_root/home" />`, { imports: [SfCopyableComponent] });

    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('copies on click, shows a check mark, announces it, then resets after 1.5 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    writeText.mockResolvedValue(undefined);
    await render(`<sf-copyable [value]="value" />`, {
      imports: [SfCopyableComponent],
      componentProperties: { value: VALUE },
    });
    const button = screen.getByRole('button', { name: 'Copy' });
    const live = document.querySelector('[aria-live="polite"]')!;
    expect(live).toHaveTextContent('');

    fireEvent.click(button);

    expect(writeText).toHaveBeenCalledWith(VALUE);
    await waitFor(() => expect(live).toHaveTextContent('Copied'));
    expect(icon(button)).toBe('check');

    await vi.advanceTimersByTimeAsync(1500);
    await waitFor(() => expect(icon(button)).toBe('content_copy'));
    expect(live).toHaveTextContent('');
  });

  it('is operable from the keyboard', async () => {
    writeText.mockResolvedValue(undefined);
    await render(`<sf-copyable value="abc" />`, { imports: [SfCopyableComponent] });
    const button = screen.getByRole('button', { name: 'Copy' });

    button.focus();
    expect(document.activeElement).toBe(button);
    // A native button turns Enter/Space into a click.
    fireEvent.click(button);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('abc'));
  });

  it('announces a failure when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    await render(`<sf-copyable value="abc" />`, { imports: [SfCopyableComponent] });

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Copy failed'));
    expect(icon(screen.getByRole('button', { name: 'Copy' }))).toBe('content_copy');
  });
});
