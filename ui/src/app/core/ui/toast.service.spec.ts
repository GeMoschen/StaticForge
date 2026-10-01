import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_VISIBLE_TOASTS, ToastService, toastLifetime } from './toast.service';

const messages = (service: ToastService) => service.toasts().map((t) => t.message);
const visible = (service: ToastService) => service.visible().map((t) => t.message);

describe('ToastService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('adds and dismisses toasts', () => {
    const service = new ToastService();

    const id = service.show('Saved', 'success');
    expect(service.toasts()).toEqual([{ id, message: 'Saved', kind: 'success' }]);

    service.show('Failed', 'error');
    expect(service.toasts().length).toBe(2);

    service.dismiss(id);
    expect(service.toasts().length).toBe(1);

    service.clear();
    expect(service.toasts()).toEqual([]);
    expect(service.timers().size).toBe(0);
  });

  describe('lifetime', () => {
    it('scales with the text, clamped, and adds time for an action', () => {
      expect(toastLifetime('Saved', 'success', false)).toBe(5_000);
      expect(toastLifetime('x'.repeat(50), 'info', false)).toBe(7_000);
      expect(toastLifetime('x'.repeat(50), 'error', false)).toBe(9_000);
      expect(toastLifetime('x'.repeat(500), 'error', false)).toBe(12_000);
      expect(toastLifetime('Saved', 'success', true)).toBe(11_000);
      expect(toastLifetime('x'.repeat(500), 'info', true)).toBe(18_000);
    });

    it('dismisses each toast after its lifetime', () => {
      const service = new ToastService();
      service.show('Saved', 'success'); // 5 s
      service.show('x'.repeat(50), 'warning'); // 9 s
      service.show('Released.', 'success', { label: 'Build now', run: () => undefined }); // 11 s

      vi.advanceTimersByTime(4_999);
      expect(service.toasts().length).toBe(3);
      vi.advanceTimersByTime(1);
      expect(messages(service)).toEqual(['x'.repeat(50), 'Released.']);
      vi.advanceTimersByTime(4_000);
      expect(messages(service)).toEqual(['Released.']);
      vi.advanceTimersByTime(2_000);
      expect(service.toasts()).toEqual([]);
    });
  });

  describe('queue', () => {
    it(`shows at most ${MAX_VISIBLE_TOASTS} and promotes the next when one leaves, starting its clock then`, () => {
      const service = new ToastService();
      const first = service.show('One');
      service.show('Two');
      service.show('Three');
      service.show('Four');

      expect(visible(service)).toEqual(['One', 'Two', 'Three']);
      expect(messages(service)).toEqual(['One', 'Two', 'Three', 'Four']);
      expect([...service.timers().keys()]).not.toContain(4);

      vi.advanceTimersByTime(3_000);
      service.dismiss(first);
      expect(visible(service)).toEqual(['Two', 'Three', 'Four']);

      // "Two" and "Three" leave at 5 s; "Four" started 3 s late, so it stays until 8 s.
      vi.advanceTimersByTime(2_000);
      expect(visible(service)).toEqual(['Four']);
      vi.advanceTimersByTime(2_999);
      expect(visible(service)).toEqual(['Four']);
      vi.advanceTimersByTime(1);
      expect(service.toasts()).toEqual([]);
    });

    it('lets an error jump ahead of waiting news, but not ahead of visible toasts or earlier errors', () => {
      const service = new ToastService();
      ['One', 'Two', 'Three', 'Four', 'Five'].forEach((m) => service.show(m));
      service.show('Broken', 'error');
      service.show('Also broken', 'error');

      expect(messages(service)).toEqual(['One', 'Two', 'Three', 'Broken', 'Also broken', 'Four', 'Five']);
      expect(visible(service)).toEqual(['One', 'Two', 'Three']);
    });
  });

  describe('pause and resume', () => {
    it('holds the clock while hovered and resumes with the remaining time', () => {
      const service = new ToastService();
      const id = service.show('Saved', 'success'); // 5 s

      vi.advanceTimersByTime(2_000);
      service.pause(id, 'hover');
      expect(service.timers().get(id)).toEqual({ lifetime: 5_000, remaining: 3_000, runningSince: null });
      vi.advanceTimersByTime(60_000);
      expect(service.toasts().length).toBe(1);

      service.resume(id, 'hover');
      vi.advanceTimersByTime(2_999);
      expect(service.toasts().length).toBe(1);
      vi.advanceTimersByTime(1);
      expect(service.toasts()).toEqual([]);
    });

    it('stays paused until both hover and focus have ended', () => {
      const service = new ToastService();
      const id = service.show('Saved', 'success');

      vi.advanceTimersByTime(1_000);
      service.pause(id, 'hover');
      service.pause(id, 'focus');
      service.resume(id, 'hover');
      vi.advanceTimersByTime(10_000);
      expect(service.toasts().length).toBe(1);

      service.resume(id, 'focus');
      vi.advanceTimersByTime(4_000);
      expect(service.toasts()).toEqual([]);
    });
  });

  it('undo shows a translated Undo action that runs the callback and dismisses the toast', () => {
    const service = new ToastService();
    const run = vi.fn();
    const id = service.undo('Page deleted.', run);

    const [toast] = service.toasts();
    expect(toast).toMatchObject({ id, message: 'Page deleted.', kind: 'success' });
    expect(toast.action).toMatchObject({ label: 'shared.toast.undo', translate: true });
    expect(service.timers().get(id)?.lifetime).toBe(toastLifetime('Page deleted.', 'success', true));

    service.runAction(id);
    expect(run).toHaveBeenCalledTimes(1);
    expect(service.toasts()).toEqual([]);
    vi.runAllTimers();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
