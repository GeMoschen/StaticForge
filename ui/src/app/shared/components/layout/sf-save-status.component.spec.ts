import '@angular/compiler';
import { render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfSaveStatusComponent } from './sf-save-status.component';

async function status(inputs: { state: 'saved' | 'saving' | 'dirty' | 'error'; savedAt?: string | null; errorCount?: number }) {
  return render(SfSaveStatusComponent, { componentInputs: inputs });
}

describe('SfSaveStatusComponent', () => {
  it('says Saved with the time of the last save, or just Saved', async () => {
    const { rerender } = await status({ state: 'saved', savedAt: '12:04' });
    expect(screen.getByRole('status')).toHaveTextContent('Saved 12:04');
    await rerender({ componentInputs: { state: 'saved', savedAt: null } });
    expect(screen.getByRole('status')).toHaveTextContent(/^\s*cloud_done\s*Saved\s*$/);
  });

  it('says Saving…', async () => {
    await status({ state: 'saving' });
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');
  });

  it('says Unsaved changes as a warning pill', async () => {
    await status({ state: 'dirty' });
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
    expect(document.querySelector('sf-status')?.className).toContain('warning');
  });

  it('says Not saved with the number of errors, as a danger pill', async () => {
    const { rerender } = await status({ state: 'error', errorCount: 2 });
    expect(screen.getByRole('status')).toHaveTextContent('Not saved — 2 errors');
    expect(document.querySelector('sf-status')?.className).toContain('danger');
    await rerender({ componentInputs: { state: 'error', errorCount: 1 } });
    expect(screen.getByRole('status')).toHaveTextContent('Not saved — 1 error');
    await rerender({ componentInputs: { state: 'error', errorCount: 0 } });
    expect(screen.getByRole('status')).toHaveTextContent(/Not saved\s*$/);
  });

  it('keeps one polite live region while the state changes, so a change is announced', async () => {
    const { rerender } = await status({ state: 'dirty' });
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    await rerender({ componentInputs: { state: 'saved' } });
    expect(screen.getByRole('status')).toBe(region);
  });
});
