import { Component, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SfButtonComponent } from './sf-button.component';

describe('SfButtonComponent', () => {
  afterEach(() => vi.useRealTimers());

  it('renders a type=button with its text and variant/size classes', async () => {
    await render(`<sf-button variant="secondary" size="sm">Save</sf-button>`, { imports: [SfButtonComponent] });

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('sf-button--secondary', 'sf-button--sm');
  });

  it('passes type=submit through', async () => {
    await render(`<sf-button type="submit">Go</sf-button>`, { imports: [SfButtonComponent] });

    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'submit');
  });

  it('renders leading and trailing icons as decoration', async () => {
    await render(`<sf-button icon="add" iconTrailing="expand_more">New</sf-button>`, { imports: [SfButtonComponent] });

    const button = screen.getByRole('button', { name: 'New' });
    const icons = button.querySelectorAll('.material-symbols-outlined');
    expect(Array.from(icons).map((icon) => icon.textContent?.trim())).toEqual(['add', 'expand_more']);
    icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'));
  });

  it('names an icon-only button by its label and shows the label as tooltip on keyboard focus', async () => {
    await render(`<sf-button icon="delete" label="Delete page" variant="ghost">ignored</sf-button>`, {
      imports: [SfButtonComponent],
    });

    const button = screen.getByRole('button', { name: 'Delete page' });
    expect(button.textContent).not.toContain('ignored');
    expect(button).not.toHaveAttribute('title');

    vi.spyOn(button, 'matches').mockImplementation((selector: string) => selector === ':focus-visible');
    fireEvent.focusIn(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Delete page');
    // The tooltip repeats the name, so it doesn't describe the button too.
    expect(button).not.toHaveAttribute('aria-describedby');

    fireEvent.focusOut(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('forwards aria attributes to the inner button, not the host', async () => {
    await render(
      `<sf-button aria-label="Open menu" aria-haspopup="menu" [aria-expanded]="true" aria-controls="m1" aria-keyshortcuts="Alt+P">⋮</sf-button>`,
      { imports: [SfButtonComponent] },
    );

    const button = screen.getByRole('button', { name: 'Open menu' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', 'm1');
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Alt+P');
    const host = document.querySelector('sf-button')!;
    expect(host).not.toHaveAttribute('aria-label');
    expect(host).not.toHaveAttribute('aria-expanded');
  });

  it('does not fire (click) while disabled', async () => {
    const clicked = vi.fn();
    await render(`<sf-button [disabled]="true" (click)="clicked()">Save</sf-button>`, {
      imports: [SfButtonComponent],
      componentProperties: { clicked },
    });

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(clicked).not.toHaveBeenCalled();
  });

  it('keeps a disabled button with a reason focusable and explains it in the tooltip', async () => {
    const clicked = vi.fn();
    await render(`<sf-button [disabled]="true" disabledReason="Nothing to save" (click)="clicked()">Save</sf-button>`, {
      imports: [SfButtonComponent],
      componentProperties: { clicked },
    });

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(button);
    expect(clicked).not.toHaveBeenCalled();

    vi.spyOn(button, 'matches').mockReturnValue(true);
    fireEvent.focusIn(button);
    expect(button).toHaveAccessibleDescription('Nothing to save');
  });

  it('is busy while loading and swallows clicks, also of a submit button', async () => {
    @Component({
      standalone: true,
      imports: [SfButtonComponent],
      template: `<form (submit)="submitted($event)"><sf-button type="submit" [loading]="loading()" (click)="clicked()">Save</sf-button></form>`,
    })
    class Host {
      readonly loading = signal(true);
      readonly clicked = vi.fn();
      readonly submitted = vi.fn((event: Event) => event.preventDefault());
    }
    const { fixture } = await render(Host);
    const host = fixture.componentInstance;

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('.sf-button__spinner')).not.toBeNull();
    fireEvent.click(button);
    expect(host.clicked).not.toHaveBeenCalled();
    expect(host.submitted).not.toHaveBeenCalled();

    host.loading.set(false);
    fixture.detectChanges();
    fireEvent.click(button);
    expect(host.clicked).toHaveBeenCalledTimes(1);
    expect(button).not.toHaveAttribute('aria-busy');
  });

  it('renders a router link as <a> with its href', async () => {
    await render(`<sf-button [link]="['/p', 'demo']" variant="secondary">Open</sf-button>`, {
      imports: [SfButtonComponent],
      providers: [provideRouter([])],
    });

    const link = screen.getByRole('link', { name: 'Open' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/p/demo');
  });

  it('renders a disabled link without href, aria-disabled', async () => {
    await render(`<sf-button link="/x" [disabled]="true">Open</sf-button>`, {
      imports: [SfButtonComponent],
      providers: [provideRouter([])],
    });

    const link = screen.getByRole('link', { name: 'Open' });
    expect(link).not.toHaveAttribute('href');
    expect(link).toHaveAttribute('aria-disabled', 'true');
  });

  it('does not navigate while a router link is loading', async () => {
    await render(`<sf-button link="/x" [loading]="true">Open</sf-button>`, {
      imports: [SfButtonComponent],
      providers: [provideRouter([])],
    });

    const link = screen.getByRole('link', { name: 'Open' });
    expect(link).not.toHaveAttribute('href');
    expect(link).toHaveAttribute('aria-busy', 'true');
    expect(link).toHaveAttribute('aria-disabled', 'true');
  });

  it('focus() focuses the inner element', async () => {
    const { fixture } = await render(`<sf-button>Save</sf-button>`, { imports: [SfButtonComponent] });
    const component = fixture.debugElement.children[0].componentInstance as SfButtonComponent;

    component.focus();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));
  });
});
