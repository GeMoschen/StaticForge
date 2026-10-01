import { Component, Injector, inject, signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { ShortcutService } from '../../../core/ui/shortcut.service';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { afterEach, describe, expect, it } from 'vitest';
import { SfButtonComponent } from '../sf-button.component';
import { SfDialogRef, injectDialogData } from './dialog-ref';
import { DialogService } from './dialog.service';
import { SfDialogComponent, SfDialogFooterDirective } from './sf-dialog.component';

@Component({
  standalone: true,
  imports: [SfDialogComponent, SfDialogFooterDirective, SfButtonComponent],
  template: `
    <sf-dialog [title]="data.title" size="sm">
      <label>Name <input /></label>
      <div sfDialogFooter>
        <sf-button variant="secondary" (click)="ref.close()">Cancel</sf-button>
        <sf-button (click)="ref.close('saved')">Save</sf-button>
      </div>
    </sf-dialog>
  `,
})
class NameDialog {
  readonly data = injectDialogData<{ title: string }>();
  readonly ref = inject<SfDialogRef<string>>(SfDialogRef);
}

@Component({
  standalone: true,
  imports: [SfDialogComponent, SfButtonComponent],
  template: `
    <main>
      <button type="button" (click)="open.set(true)">Open inline</button>
      <button type="button" (click)="openService()">Open service</button>
    </main>
    @if (open()) {
      <sf-dialog title="Inline" (closed)="open.set(false)">
        <button type="button" (click)="openService()">Open on top</button>
      </sf-dialog>
    }
  `,
})
class Host {
  readonly open = signal(false);
  readonly dialogs = inject(DialogService);
  result: Promise<string | undefined> | null = null;

  openService(): void {
    this.result = this.dialogs.open<string>(NameDialog, { title: 'Rename page' }).result;
  }
}

describe('sf-dialog and DialogService', () => {
  afterEach(() => document.querySelectorAll('sf-dialog, [inert]').forEach((element) => element.removeAttribute('inert')));

  async function setup() {
    const result = await render(Host);
    return { ...result, host: result.fixture.componentInstance };
  }

  it('opens a component as a labelled modal dialog with focus on its first control', async () => {
    const { host } = await setup();
    host.openService();

    const dialog = await screen.findByRole('dialog', { name: 'Rename page' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Rename page' })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' })));
  });

  it('resolves the typed result and restores focus to the opener', async () => {
    const { host } = await setup();
    const opener = screen.getByRole('button', { name: 'Open service' });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await expect(host.result).resolves.toBe('saved');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on Escape, the backdrop and the × button, resolving undefined', async () => {
    const { host } = await setup();
    for (const close of [
      () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }),
      () => fireEvent.click(document.querySelector('.sf-dialog__backdrop')!),
      () => fireEvent.click(screen.getByRole('button', { name: 'Close' })),
    ]) {
      host.openService();
      await screen.findByRole('dialog');
      close();
      await expect(host.result).resolves.toBeUndefined();
      expect(screen.queryByRole('dialog')).toBeNull();
    }
  });

  it('traps Tab inside the dialog in both directions', async () => {
    const { host } = await setup();
    host.openService();
    await screen.findByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close' });
    const save = screen.getByRole('button', { name: 'Save' });

    save.focus();
    fireEvent.keyDown(save, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  it('makes the page behind inert and scroll-locked, and releases both on close', async () => {
    const { host } = await setup();
    const main = document.querySelector('main')!;
    host.openService();
    const dialog = await screen.findByRole('dialog');

    expect(main.closest('[inert]')).not.toBeNull();
    expect(dialog.closest('[inert]')).toBeNull();
    expect(document.documentElement.style.overflow).toBe('hidden');

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await host.result;
    expect(main.closest('[inert]')).toBeNull();
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('works inline, moves itself to <body>, and stacks a second dialog above it', async () => {
    const { host, fixture } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open inline' }));
    fixture.detectChanges();
    const inline = await screen.findByRole('dialog', { name: 'Inline' });
    expect(inline.closest('sf-dialog')!.parentElement).toBe(document.body);

    const onTop = screen.getByRole('button', { name: 'Open on top' });
    onTop.focus();
    fireEvent.click(onTop);
    const top = await screen.findByRole('dialog', { name: 'Rename page' });
    const zOf = (dialog: HTMLElement) => dialog.closest<HTMLElement>('sf-dialog')!.style.zIndex;
    expect(zOf(inline)).toBe('calc(var(--sf-z-modal) + 0)');
    expect(zOf(top)).toBe('calc(var(--sf-z-modal) + 1)');
    // The lower dialog is inert while the upper one is open.
    expect(inline.closest('[inert]')).not.toBeNull();

    // Escape closes only the top one; focus returns into the lower dialog.
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await host.result;
    expect(screen.getByRole('dialog', { name: 'Inline' })).toBeInTheDocument();
    expect(inline.closest('[inert]')).toBeNull();
    expect(document.activeElement).toBe(onTop);

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    fixture.detectChanges();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(host.open()).toBe(false);
  });

  it('is not dismissed by Escape or the backdrop while not dismissible', async () => {
    @Component({
      standalone: true,
      imports: [SfDialogComponent],
      template: `<sf-dialog title="Saving" [dismissible]="false"><p>Please wait</p></sf-dialog>`,
    })
    class Busy {}
    const ref = TestBed.inject(DialogService).open(Busy);
    const dialog = await screen.findByRole('dialog', { name: 'Saving' });

    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(document.querySelector('.sf-dialog__backdrop')!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    ref.close();
  });
});

describe('DialogService lifetime', () => {
  it('closes a dialog on a route change, resolving undefined', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', children: [] }])] });
    const ref = TestBed.inject(DialogService).open<string>(NameDialog, { title: 'Rename page' });
    await screen.findByRole('dialog');

    await TestBed.inject(Router).navigateByUrl('/elsewhere');
    await expect(ref.result).resolves.toBeUndefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes a dialog when the component that opened it is destroyed', async () => {
    @Component({ standalone: true, template: '' })
    class Opener {
      readonly injector = inject(Injector);
    }
    const fixture = TestBed.createComponent(Opener);
    const ref = TestBed.inject(DialogService).open(NameDialog, { title: 'Rename page' }, { injector: fixture.componentInstance.injector });
    await screen.findByRole('dialog');

    fixture.destroy();
    await expect(ref.result).resolves.toBeUndefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the page shortcuts quiet while a modal is open', async () => {
    const shortcuts = TestBed.inject(ShortcutService);
    const ref = TestBed.inject(DialogService).open(NameDialog, { title: 'Rename page' });
    await screen.findByRole('dialog');

    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(shortcuts.commandPaletteOpen()).toBe(false);
    ref.close();
    await ref.result;
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(shortcuts.commandPaletteOpen()).toBe(true);
  });
});
