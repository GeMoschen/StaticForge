import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { SfFieldComponent } from '../sf-field.component';
import { SfSearchInputComponent } from './sf-search-input.component';

@Component({
  standalone: true,
  imports: [SfSearchInputComponent, ReactiveFormsModule],
  template: `
    <div (keydown)="outerKeydown($event)">
      <sf-search-input aria-label="Filter pages" [focusShortcut]="shortcut" [formControl]="query" />
    </div>
    <input aria-label="Other" />
    <div contenteditable="true" aria-label="Editor"></div>
    <button type="button">Elsewhere</button>
  `,
})
class Host {
  shortcut = true;
  readonly query = new FormControl<string | null>('');
  readonly outerKeydown = vi.fn();
}

describe('SfSearchInputComponent', () => {
  it('is a searchbox labelled by its field, described by hint and error', async () => {
    await render(`<sf-field label="Search pages" hint="Title or uid" error="Too short"><sf-search-input /></sf-field>`, {
      imports: [SfFieldComponent, SfSearchInputComponent],
    });

    const box = screen.getByRole('searchbox', { name: 'Search pages' });
    expect(box).toHaveAccessibleDescription('Title or uid Too short');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAttribute('placeholder', 'Search…');
    expect(box).not.toHaveAttribute('aria-keyshortcuts');
  });

  it('takes aria-label and a placeholder outside a field', async () => {
    await render(`<sf-search-input aria-label="Filter" placeholder="Filter by name" required />`, {
      imports: [SfSearchInputComponent],
    });

    const box = screen.getByRole('searchbox', { name: 'Filter' });
    expect(box).toHaveAttribute('placeholder', 'Filter by name');
    expect(box).toHaveAttribute('aria-required', 'true');
  });

  it('shows a clear button only while it holds text; clearing empties it and refocuses the input', async () => {
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.query;
    const box = screen.getByRole('searchbox', { name: 'Filter pages' });
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();

    fireEvent.input(box, { target: { value: 'news' } });
    expect(control.value).toBe('news');
    fixture.detectChanges();

    const clear = screen.getByRole('button', { name: 'Clear search' });
    clear.focus();
    fireEvent.click(clear);
    expect(control.value).toBe('');
    expect(box).toHaveValue('');
    expect(document.activeElement).toBe(box);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });

  it('clears on Escape when it holds text, and lets Escape through when empty', async () => {
    const { fixture } = await render(Host);
    const host = fixture.componentInstance;
    host.query.setValue('news');
    fixture.detectChanges();
    const box = screen.getByRole('searchbox', { name: 'Filter pages' });

    expect(fireEvent.keyDown(box, { key: 'Escape' })).toBe(false);
    expect(host.query.value).toBe('');
    expect(host.outerKeydown).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(box, { key: 'Escape' })).toBe(true);
    expect(host.outerKeydown).toHaveBeenCalledTimes(1);
  });

  it('focuses on "/" from anywhere but an editable target or with a modifier', async () => {
    await render(Host);
    const box = screen.getByRole('searchbox', { name: 'Filter pages' });
    expect(box).toHaveAttribute('aria-keyshortcuts', '/');
    expect(document.querySelector('.sf-search-input__hint')).toHaveAttribute('aria-hidden', 'true');

    const other = screen.getByRole('textbox', { name: 'Other' });
    other.focus();
    expect(fireEvent.keyDown(other, { key: '/' })).toBe(true);
    expect(document.activeElement).toBe(other);

    fireEvent.keyDown(screen.getByLabelText('Editor'), { key: '/' });
    expect(document.activeElement).toBe(other);

    const button = screen.getByRole('button', { name: 'Elsewhere' });
    button.focus();
    fireEvent.keyDown(button, { key: '/', ctrlKey: true });
    expect(document.activeElement).toBe(button);

    expect(fireEvent.keyDown(button, { key: '/' })).toBe(false);
    expect(document.activeElement).toBe(box);
  });

  it('ignores "/" without focusShortcut', async () => {
    const { fixture } = await render(Host, { componentProperties: { shortcut: false } });
    fixture.detectChanges();
    const button = screen.getByRole('button', { name: 'Elsewhere' });
    button.focus();

    expect(fireEvent.keyDown(button, { key: '/' })).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(document.querySelector('.sf-search-input__hint')).toBeNull();
  });

  it('read-only: no clear button and Escape keeps the text', async () => {
    await render(`<sf-search-input aria-label="Filter" readonly value="news" />`, {
      imports: [SfSearchInputComponent],
    });

    const box = screen.getByRole('searchbox', { name: 'Filter' });
    expect(box).toHaveAttribute('readonly');
    expect(screen.queryByRole('button')).toBeNull();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).toHaveValue('news');
  });

  it('is a ControlValueAccessor: writeValue, touched on blur, disabled with the control', async () => {
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.query;
    const box = screen.getByRole('searchbox', { name: 'Filter pages' });

    control.setValue('blog');
    fixture.detectChanges();
    expect(box).toHaveValue('blog');

    fireEvent.blur(box);
    expect(control.touched).toBe(true);

    control.disable();
    fixture.detectChanges();
    expect(box).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });
});
