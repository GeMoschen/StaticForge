import { signal } from '@angular/core';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { PreferencesService } from '../../../core/preferences/preferences.service';
import { SfSplitterComponent } from './sf-splitter.component';

function preferencesStub(initial: Record<string, number> = {}) {
  const sizes = signal<Record<string, number>>(initial);
  return {
    paneSize: (id: string) => sizes()[id],
    setPaneSize: vi.fn((id: string, size: number) => sizes.update((all) => ({ ...all, [id]: size }))),
  };
}

async function setup(attrs = '', stored: Record<string, number> = {}) {
  const preferences = preferencesStub(stored);
  const result = await render(
    `<sf-splitter paneId="editor.tree" [defaultSize]="300" [min]="200" [max]="600" ${attrs}>
       <nav sfSplitterStart>Tree</nav>
       <main sfSplitterEnd>Editor</main>
     </sf-splitter>`,
    { imports: [SfSplitterComponent], providers: [{ provide: PreferencesService, useValue: preferences }] },
  );
  const separator = screen.getByRole('separator', { name: 'Resize panels' });
  const startPane = () => document.querySelector<HTMLElement>('.sf-splitter__pane--start')!;
  return { ...result, preferences, separator, startPane };
}

describe('SfSplitterComponent', () => {
  it('is a labelled vertical separator between side-by-side panes, controlling the sized pane', async () => {
    const { separator, startPane } = await setup();

    expect(separator).toHaveAttribute('aria-orientation', 'vertical');
    expect(separator).toHaveAttribute('tabindex', '0');
    expect(separator).toHaveAttribute('aria-valuenow', '300');
    expect(separator).toHaveAttribute('aria-valuemin', '200');
    expect(separator).toHaveAttribute('aria-valuemax', '600');
    expect(separator).toHaveAttribute('aria-controls', startPane().id);
    expect(startPane().style.flexBasis).toBe('300px');
  });

  it('resizes with the arrow keys (Shift: large steps), Home and End, within min and max, and persists', async () => {
    const { separator, preferences, fixture } = await setup();
    const key = (key: string, shiftKey = false) => {
      fireEvent.keyDown(separator, { key, shiftKey });
      fixture.detectChanges();
      return separator.getAttribute('aria-valuenow');
    };

    expect(key('ArrowRight')).toBe('316');
    expect(key('ArrowLeft', true)).toBe('252');
    expect(key('Home')).toBe('200');
    expect(key('ArrowLeft')).toBe('200');
    expect(key('End')).toBe('600');
    expect(preferences.setPaneSize).toHaveBeenLastCalledWith('editor.tree', 600);
  });

  it('starts from the stored size', async () => {
    const { separator } = await setup('', { 'editor.tree': 420 });

    expect(separator).toHaveAttribute('aria-valuenow', '420');
  });

  it('resets to the default size on double click', async () => {
    const { separator, fixture } = await setup('', { 'editor.tree': 420 });

    fireEvent.dblClick(separator);
    fixture.detectChanges();
    expect(separator).toHaveAttribute('aria-valuenow', '300');
  });

  it('collapses with Enter, offers a restore button, and persists the state', async () => {
    const { separator, fixture, startPane, preferences } = await setup('collapsible');

    fireEvent.keyDown(separator, { key: 'Enter' });
    fixture.detectChanges();
    expect(startPane()).toHaveAttribute('hidden');
    expect(preferences.setPaneSize).toHaveBeenLastCalledWith('editor.tree.collapsed', 1);

    fireEvent.click(screen.getByRole('button', { name: 'Restore panel' }));
    fixture.detectChanges();
    expect(startPane()).not.toHaveAttribute('hidden');
    expect(screen.queryByRole('button', { name: 'Restore panel' })).toBeNull();
    expect(preferences.setPaneSize).toHaveBeenLastCalledWith('editor.tree.collapsed', 0);
  });

  it('does not collapse unless collapsible', async () => {
    const { separator, fixture, startPane } = await setup();

    fireEvent.keyDown(separator, { key: 'Enter' });
    fixture.detectChanges();
    expect(startPane()).not.toHaveAttribute('hidden');
  });

  it('stacks panes with a horizontal separator moved by the up/down keys', async () => {
    const { separator, fixture } = await setup('orientation="vertical"');

    expect(separator).toHaveAttribute('aria-orientation', 'horizontal');
    fireEvent.keyDown(separator, { key: 'ArrowDown' });
    fixture.detectChanges();
    expect(separator).toHaveAttribute('aria-valuenow', '316');
  });

  it('grows an end-sized pane towards the start', async () => {
    const { separator, fixture } = await setup('sized="end"');

    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    fixture.detectChanges();
    expect(separator).toHaveAttribute('aria-valuenow', '316');
  });

  it('resizes by pointer drag', async () => {
    const { separator, fixture } = await setup();

    // jsdom has no PointerEvent: mouse events with pointer type names carry button and coordinates.
    const pointer = (type: string, clientX: number) =>
      fireEvent(separator, new MouseEvent(type, { bubbles: true, button: 0, clientX }));
    pointer('pointerdown', 300);
    pointer('pointermove', 350);
    pointer('pointerup', 350);
    fixture.detectChanges();
    expect(separator).toHaveAttribute('aria-valuenow', '350');
  });
});
