import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot, provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import { mediaLeaveGuard } from './media-leave.guard';

function ask(from: string, to: string, canLeave = false) {
  const canLeaveSpy = vi.fn().mockResolvedValue(canLeave);
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: ActiveEditorService, useValue: { canLeave: canLeaveSpy } }],
  });
  const result = TestBed.runInInjectionContext(() =>
    mediaLeaveGuard(null, {} as ActivatedRouteSnapshot, { url: from } as RouterStateSnapshot, { url: to } as RouterStateSnapshot),
  );
  return { result, canLeaveSpy };
}

const LIBRARY = '/p/demo/media';

describe('mediaLeaveGuard (decisions 48 and 97)', () => {
  it('lets a change of search, sort, view or drawer tab through without asking', () => {
    for (const to of [`${LIBRARY}?asset=a&q=x`, `${LIBRARY}?asset=a&sort=size-desc`, `${LIBRARY}?asset=a&mtab=source`, `${LIBRARY}?asset=a&media=list`]) {
      TestBed.resetTestingModule();
      const { result, canLeaveSpy } = ask(`${LIBRARY}?asset=a`, to);
      expect(result).toBe(true);
      expect(canLeaveSpy).not.toHaveBeenCalled();
    }
  });

  it('lets the folder of the open file change while the file stays open (the library shows its folder)', () => {
    const { result, canLeaveSpy } = ask(`${LIBRARY}?asset=a`, `${LIBRARY}?asset=a&folder=f`);
    expect(result).toBe(true);
    expect(canLeaveSpy).not.toHaveBeenCalled();
  });

  it('asks when another file is opened, the drawer is closed or another folder is opened', async () => {
    for (const to of [`${LIBRARY}?asset=b`, LIBRARY, `${LIBRARY}?folder=f`]) {
      TestBed.resetTestingModule();
      const { result, canLeaveSpy } = ask(`${LIBRARY}?asset=a`, to, false);
      expect(await result).toBe(false);
      expect(canLeaveSpy).toHaveBeenCalledTimes(1);
    }
  });

  it('asks when the library is left through the rail', async () => {
    const { result, canLeaveSpy } = ask(`${LIBRARY}?asset=a`, '/p/demo/pages', true);
    expect(await result).toBe(true);
    expect(canLeaveSpy).toHaveBeenCalled();
  });

  it('asks nothing of a library without an open file that only changes its filters', () => {
    const { result, canLeaveSpy } = ask(`${LIBRARY}?q=a`, `${LIBRARY}?q=ab`);
    expect(result).toBe(true);
    expect(canLeaveSpy).not.toHaveBeenCalled();
  });
});
