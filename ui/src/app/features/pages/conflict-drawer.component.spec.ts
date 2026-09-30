import '@angular/compiler';
import { ErrorHandler } from '@angular/core';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { ConflictDrawerComponent } from './conflict-drawer.component';
import type { ConflictInfo } from './types';

function conflict(theirsTitle: string): ConflictInfo {
  return {
    expectedRevision: 3,
    currentRevision: 4,
    base: { title: 'Mine' },
    theirs: { title: theirsTitle },
  };
}

describe('ConflictDrawerComponent', () => {
  it('raises no error (NG0600) when it opens, and resets the picks for the next conflict', async () => {
    const handleError = vi.fn();
    const onResolve = vi.fn();
    const { fixture } = await render(ConflictDrawerComponent, {
      componentInputs: { conflict: conflict('Theirs') },
      on: { resolve: onResolve },
      providers: [{ provide: ErrorHandler, useValue: { handleError } }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Take theirs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    expect(onResolve).toHaveBeenLastCalledWith({ fields: { title: 'theirs' } });

    fixture.componentRef.setInput('conflict', conflict('Somebody else'));
    fixture.detectChanges();
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));

    // A new conflict starts on the default again: "Keep mine".
    expect(onResolve).toHaveBeenLastCalledWith({ fields: { title: 'mine' } });
    expect(handleError).not.toHaveBeenCalled();
  });
});
