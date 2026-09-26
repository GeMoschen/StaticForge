import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastHostComponent } from './toast-host.component';
import { ToastService } from './toast.service';

describe('ToastHostComponent', () => {
  it('renders news in the polite region and errors in the assertive one', async () => {
    await render(ToastHostComponent);
    const toasts = TestBed.inject(ToastService);
    toasts.show('Saved', 'success');
    toasts.show('Could not save', 'error');

    expect(await screen.findByText('Saved')).toBeTruthy();
    const polite = screen.getByRole('status');
    const assertive = screen.getByRole('alert');
    expect(polite.getAttribute('aria-live')).toBe('polite');
    expect(assertive.getAttribute('aria-live')).toBe('assertive');
    expect(polite.textContent).toContain('Saved');
    expect(polite.textContent).not.toContain('Could not save');
    expect(assertive.textContent).toContain('Could not save');
  });

  it('runs a toast’s action and dismisses it', async () => {
    await render(ToastHostComponent);
    const toasts = TestBed.inject(ToastService);
    const run = vi.fn();
    toasts.show('Released.', 'success', { label: 'Build now', run });

    fireEvent.click(await screen.findByRole('button', { name: 'Build now' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(toasts.toasts()).toEqual([]);
    expect(screen.queryByText('Released.')).toBeNull();
  });

  it('dismisses a toast on request', async () => {
    await render(ToastHostComponent);
    TestBed.inject(ToastService).show('Saved', 'info');
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Saved')).toBeNull();
  });
});

describe('ToastService lifetimes', () => {
  afterEach(() => vi.useRealTimers());

  it('dismisses each toast after its lifetime, longer for warnings, errors and actions', () => {
    vi.useFakeTimers();
    const service = new ToastService();
    service.show('Saved', 'success');
    service.show('Careful', 'warning');
    service.show('Released.', 'success', { label: 'Build now', run: () => undefined });

    vi.advanceTimersByTime(4_999);
    expect(service.toasts().map((t) => t.message)).toEqual(['Saved', 'Careful', 'Released.']);
    vi.advanceTimersByTime(1);
    expect(service.toasts().map((t) => t.message)).toEqual(['Careful', 'Released.']);
    vi.advanceTimersByTime(3_000);
    expect(service.toasts().map((t) => t.message)).toEqual(['Released.']);
    vi.advanceTimersByTime(7_000);
    expect(service.toasts()).toEqual([]);
  });
});
