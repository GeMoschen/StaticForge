import '@angular/compiler';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import type { MoveTarget } from './content-tree.util';
import { MoveTargetDialogComponent } from './move-target-dialog.component';

const TARGETS: MoveTarget[] = [
  { uuid: null, label: 'All content', depth: 0, current: false },
  { uuid: 'team', label: 'Team', depth: 1, current: true },
  { uuid: 'alumni', label: 'Alumni', depth: 2, current: false },
];

async function setup(targets: MoveTarget[] = TARGETS) {
  const chosen = vi.fn();
  const closed = vi.fn();
  await render(MoveTargetDialogComponent, {
    componentInputs: { open: true, title: 'Move “Leads” to…', targets },
    on: { chosen, closed },
  });
  return { chosen, closed };
}

function moveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Move' }) as HTMLButtonElement;
}

describe('MoveTargetDialogComponent', () => {
  it('preselects nothing: Move stays disabled until a new place is picked', async () => {
    const { chosen } = await setup();

    expect(moveButton().disabled).toBe(true);
    fireEvent.click(moveButton());
    expect(chosen).not.toHaveBeenCalled();
  });

  it("lists the current place but won't choose it", async () => {
    await setup();

    expect((screen.getByRole('radio', { name: /Team/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('(current)')).toBeTruthy();
  });

  it('emits the picked target, null for the store root', async () => {
    const { chosen } = await setup();

    fireEvent.click(screen.getByRole('radio', { name: /Alumni/ }));
    fireEvent.click(moveButton());
    fireEvent.click(screen.getByRole('radio', { name: /All content/ }));
    fireEvent.click(moveButton());

    expect(chosen.mock.calls).toEqual([['alumni'], [null]]);
  });

  it('explains when there is nowhere to go', async () => {
    await setup([]);

    expect(screen.getByText('There is nowhere else to move this to.')).toBeTruthy();
    expect(moveButton().disabled).toBe(true);
  });
});
