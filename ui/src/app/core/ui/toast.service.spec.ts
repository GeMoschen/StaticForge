import { describe, expect, it } from 'vitest';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  it('adds and dismisses toasts', () => {
    const service = new ToastService();

    const id = service.show('Saved', 'success');
    expect(service.toasts()).toEqual([
      { id, message: 'Saved', kind: 'success' },
    ]);

    service.show('Failed', 'error');
    expect(service.toasts().length).toBe(2);

    service.dismiss(id);
    expect(service.toasts().length).toBe(1);
  });
});
