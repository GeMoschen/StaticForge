import { Component, signal } from '@angular/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfDrawerComponent, SfDrawerFooterDirective } from './sf-drawer.component';

@Component({
  standalone: true,
  imports: [SfDrawerComponent, SfDrawerFooterDirective],
  template: `
    <main><button type="button" (click)="open.set(true)">Show details</button><input aria-label="Page field" /></main>
    @if (open()) {
      <sf-drawer title="Media details" [modal]="modal" [(width)]="width" (closed)="open.set(false)">
        <label>Alt text <input /></label>
        <div sfDrawerFooter><button type="button">Save</button></div>
      </sf-drawer>
    }
  `,
})
class Host {
  modal = false;
  readonly open = signal(false);
  width = 480;
}

async function setup(modal = false) {
  const result = await render(Host, { componentProperties: { modal } });
  const opener = screen.getByRole('button', { name: 'Show details' });
  opener.focus();
  fireEvent.click(opener);
  result.fixture.detectChanges();
  const drawer = await screen.findByRole('dialog', { name: 'Media details' });
  return { ...result, opener, drawer, host: result.fixture.componentInstance };
}

describe('SfDrawerComponent', () => {
  it('opens beside the page, non-modal by default, with focus on its first control', async () => {
    const { drawer } = await setup();

    expect(drawer).not.toHaveAttribute('aria-modal');
    expect(drawer.closest('sf-drawer')!.parentElement).toBe(document.body);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Alt text' })));
    // The page stays usable.
    expect(screen.getByRole('textbox', { name: 'Page field' }).closest('[inert]')).toBeNull();
  });

  it('closes on Escape from inside, but not from the page beside it, and restores focus', async () => {
    const { host, fixture, opener } = await setup();

    const pageField = screen.getByRole('textbox', { name: 'Page field' });
    pageField.focus();
    fireEvent.keyDown(pageField, { key: 'Escape' });
    expect(host.open()).toBe(true);

    const altText = screen.getByRole('textbox', { name: 'Alt text' });
    altText.focus();
    fireEvent.keyDown(altText, { key: 'Escape' });
    fixture.detectChanges();
    expect(host.open()).toBe(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('as a modal traps focus, makes the page inert and closes from the backdrop', async () => {
    const { host, fixture, drawer } = await setup(true);

    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('textbox', { name: 'Page field', hidden: true }).closest('[inert]')).not.toBeNull();
    const save = screen.getByRole('button', { name: 'Save' });
    save.focus();
    fireEvent.keyDown(save, { key: 'Tab' });
    expect(drawer.contains(document.activeElement)).toBe(true);

    fireEvent.click(document.querySelector('.sf-drawer__backdrop')!);
    fixture.detectChanges();
    expect(host.open()).toBe(false);
  });

  it('resizes with the keyboard on its separator handle, within its bounds', async () => {
    const { fixture, host } = await setup();
    const handle = screen.getByRole('separator', { name: 'Resize panel' });
    expect(handle).toHaveAttribute('aria-valuenow', '480');

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fixture.detectChanges();
    expect(host.width).toBe(496);
    expect(handle).toHaveAttribute('aria-valuenow', '496');
    fireEvent.keyDown(handle, { key: 'End' });
    fixture.detectChanges();
    expect(host.width).toBe(320);
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fixture.detectChanges();
    expect(host.width).toBe(320);
  });

  it('closes with its × button', async () => {
    const { host, fixture } = await setup();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fixture.detectChanges();
    expect(host.open()).toBe(false);
  });
});
