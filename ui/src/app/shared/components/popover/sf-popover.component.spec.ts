import { Component } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { OverlayStack } from '../../overlay/overlay-stack';
import { describe, expect, it } from 'vitest';
import { SfButtonComponent } from '../sf-button.component';
import { SfPopoverComponent, SfPopoverTriggerDirective } from './sf-popover.component';

@Component({
  standalone: true,
  imports: [SfPopoverComponent, SfPopoverTriggerDirective, SfButtonComponent],
  template: `
    <sf-button variant="secondary" [sfPopoverTrigger]="share">Share</sf-button>
    <sf-popover #share label="Share preview">
      <label>Link <input value="https://example.test" /></label>
      <button type="button">Copy</button>
    </sf-popover>
    <button type="button" [sfPopoverTrigger]="hint" sfPopoverTriggerOn="focus">Help</button>
    <sf-popover #hint label="About drafts"><p>Drafts are not published.</p></sf-popover>
    <p>Outside</p>
  `,
})
class Host {}

async function setup() {
  const result = await render(Host, { providers: [provideRouter([{ path: '**', children: [] }])] });
  const trigger = screen.getByRole('button', { name: 'Share' });
  return { ...result, trigger };
}

describe('SfPopoverComponent', () => {
  it('opens on click as a labelled non-modal dialog, linked to its trigger, with focus inside', async () => {
    const { trigger } = await setup();
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');

    fireEvent.click(trigger);
    const popover = await screen.findByRole('dialog', { name: 'Share preview' });
    expect(popover).not.toHaveAttribute('aria-modal');
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
    expect(trigger).toHaveAttribute('aria-controls', popover.id);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Link' }));
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const { trigger } = await setup();
    fireEvent.click(trigger);
    const popover = await screen.findByRole('dialog');

    fireEvent.keyDown(popover, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a click outside and when the trigger is pressed again', async () => {
    const { trigger } = await setup();
    fireEvent.click(trigger);
    await screen.findByRole('dialog');
    fireEvent.pointerDown(screen.getByText('Outside'));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(trigger);
    await screen.findByRole('dialog');
    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on a route change', async () => {
    const { trigger, fixture } = await setup();
    fireEvent.click(trigger);
    await screen.findByRole('dialog');

    await TestBed.inject(Router).navigateByUrl('/elsewhere');
    fixture.detectChanges();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays open when only the query string changes', async () => {
    const { trigger, fixture } = await setup();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/list');
    fireEvent.click(trigger);
    await screen.findByRole('dialog');

    await router.navigateByUrl('/list?status=draft');
    fixture.detectChanges();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens on focus without taking focus, and closes when focus leaves', async () => {
    await setup();
    const help = screen.getByRole('button', { name: 'Help' });

    help.focus();
    fireEvent.focusIn(help);
    expect(await screen.findByRole('dialog', { name: 'About drafts' })).toBeInTheDocument();
    expect(document.activeElement).toBe(help);

    fireEvent.focusOut(help, { relatedTarget: document.body });
    expect(screen.queryByRole('dialog', { name: 'About drafts' })).toBeNull();
  });

  it('closes a focus-opened popover with Escape on its trigger', async () => {
    await setup();
    const help = screen.getByRole('button', { name: 'Help' });
    help.focus();
    fireEvent.focusIn(help);
    await screen.findByRole('dialog', { name: 'About drafts' });

    const escape = createEvent.keyDown(help, { key: 'Escape' });
    fireEvent(help, escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(screen.queryByRole('dialog', { name: 'About drafts' })).toBeNull();
  });

  it('keeps Tab inside a popover opened from a modal dialog', async () => {
    const { trigger } = await setup();
    const dialogPane = document.createElement('div');
    dialogPane.innerHTML = '<button type="button">In dialog</button>';
    document.body.appendChild(dialogPane);
    const handle = TestBed.inject(OverlayStack).push(dialogPane, { layer: 'modal', modal: true });

    fireEvent.click(trigger);
    const popover = await screen.findByRole('dialog', { name: 'Share preview' });
    const link = screen.getByRole('textbox', { name: 'Link' });
    const tab = createEvent.keyDown(link, { key: 'Tab' });
    fireEvent(link, tab);
    // The dialog's trap leaves it alone: the browser moves on inside the popover.
    expect(tab.defaultPrevented).toBe(false);
    expect(popover.contains(document.activeElement)).toBe(true);
    handle.remove(false);
    dialogPane.remove();
  });
});
