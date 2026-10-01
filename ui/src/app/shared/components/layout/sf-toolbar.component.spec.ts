import { Component, signal } from '@angular/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfButtonComponent } from '../sf-button.component';
import { SfToolbarComponent } from './sf-toolbar.component';

const tabStops = () => screen.getByRole('toolbar').querySelectorAll('[tabindex="0"]');

describe('SfToolbarComponent', () => {
  async function renderToolbar(template: string) {
    const result = await render(template, { imports: [SfToolbarComponent, SfButtonComponent] });
    const toolbar = screen.getByRole('toolbar');
    // The items are scanned once rendered (and on every DOM change).
    await waitFor(() => expect(tabStops()).toHaveLength(1));
    return { ...result, toolbar };
  }

  it('is a named toolbar with a single tab stop on the first item', async () => {
    const { toolbar } = await renderToolbar(
      `<sf-toolbar label="Formatting"><sf-button>Bold</sf-button><sf-button>Italic</sf-button><sf-button>Link</sf-button></sf-toolbar>`,
    );

    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBe(toolbar);
    expect(toolbar).toHaveAttribute('aria-orientation', 'horizontal');
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: 'Italic' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('button', { name: 'Link' })).toHaveAttribute('tabindex', '-1');
  });

  it('moves with ←/→ (wrapping) and Home/End, carrying the tab stop along', async () => {
    await renderToolbar(
      `<sf-toolbar label="Formatting"><sf-button>Bold</sf-button><sf-button>Italic</sf-button><sf-button>Link</sf-button></sf-toolbar>`,
    );
    const bold = screen.getByRole('button', { name: 'Bold' });
    const italic = screen.getByRole('button', { name: 'Italic' });
    const link = screen.getByRole('button', { name: 'Link' });
    bold.focus();

    fireEvent.keyDown(bold, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(italic);
    expect(italic).toHaveAttribute('tabindex', '0');
    expect(bold).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(italic, { key: 'End' });
    expect(document.activeElement).toBe(link);
    fireEvent.keyDown(link, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(bold);
    fireEvent.keyDown(bold, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(link);
    fireEvent.keyDown(link, { key: 'Home' });
    expect(document.activeElement).toBe(bold);
    // Up/down do nothing in a horizontal toolbar.
    fireEvent.keyDown(bold, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(bold);
  });

  it('uses ↑/↓ when vertical', async () => {
    const { toolbar } = await renderToolbar(
      `<sf-toolbar label="Tools" orientation="vertical"><sf-button>One</sf-button><sf-button>Two</sf-button></sf-toolbar>`,
    );
    expect(toolbar).toHaveAttribute('aria-orientation', 'vertical');
    const one = screen.getByRole('button', { name: 'One' });
    one.focus();

    fireEvent.keyDown(one, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(one);
    fireEvent.keyDown(one, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Two' }));
  });

  it('skips natively disabled items but keeps aria-disabled ones reachable', async () => {
    await renderToolbar(
      `<sf-toolbar label="Actions">
        <sf-button>Cut</sf-button>
        <sf-button [disabled]="true">Copy</sf-button>
        <sf-button [disabled]="true" disabledReason="Clipboard is empty">Paste</sf-button>
      </sf-toolbar>`,
    );
    const cut = screen.getByRole('button', { name: 'Cut' });
    const paste = screen.getByRole('button', { name: 'Paste' });
    expect(screen.getByRole('button', { name: 'Copy' })).not.toHaveAttribute('tabindex');
    cut.focus();

    fireEvent.keyDown(cut, { key: 'ArrowRight' });

    expect(document.activeElement).toBe(paste);
    expect(paste).toHaveAttribute('aria-disabled', 'true');
  });

  it('leaves the arrow keys of a text input alone', async () => {
    await renderToolbar(
      `<sf-toolbar label="Filter"><input aria-label="Filter text" /><sf-button>Apply</sf-button></sf-toolbar>`,
    );
    const input = screen.getByRole('textbox', { name: 'Filter text' });
    input.focus();

    const notCancelled = fireEvent.keyDown(input, { key: 'ArrowRight' });

    expect(notCancelled).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it('moves the tab stop to an item focused by click, and re-scans when items change', async () => {
    @Component({
      standalone: true,
      imports: [SfToolbarComponent, SfButtonComponent],
      template: `<sf-toolbar label="Edit">
        @if (showFirst()) {
          <sf-button>Undo</sf-button>
        }
        <sf-button>Redo</sf-button>
        <sf-button>Save</sf-button>
      </sf-toolbar>`,
    })
    class Host {
      readonly showFirst = signal(true);
    }
    const { fixture } = await render(Host);
    await waitFor(() => expect(tabStops()).toHaveLength(1));
    const save = screen.getByRole('button', { name: 'Save' });

    fireEvent.focusIn(save);
    expect(save).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('tabindex', '-1');

    fixture.componentInstance.showFirst.set(false);
    fixture.detectChanges();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull());
    expect(tabStops()).toHaveLength(1);
    expect(save).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: 'Redo' })).toHaveAttribute('tabindex', '-1');
  });
});
