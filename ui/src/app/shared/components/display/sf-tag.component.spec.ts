import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { SfTagComponent } from './sf-tag.component';

describe('SfTagComponent', () => {
  it('shows its label and a decorative icon, no remove button by default', async () => {
    await render(SfTagComponent, { inputs: { label: 'Blog', icon: 'label' } });

    expect(screen.getByText('Blog')).toBeInTheDocument();
    expect(document.querySelector('.material-symbols-outlined')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('has an accent tone', async () => {
    await render(SfTagComponent, { inputs: { label: 'New', tone: 'accent' } });

    expect(document.querySelector('.sf-tag')).toHaveClass('sf-tag--accent');
  });

  it('names its remove button after the label and emits removed on click', async () => {
    const removed = vi.fn();
    await render(SfTagComponent, { inputs: { label: 'Blog', removable: true }, on: { removed } });

    const button = screen.getByRole('button', { name: 'Remove Blog' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).not.toHaveAttribute('title');
    fireEvent.click(button);
    expect(removed).toHaveBeenCalledTimes(1);
  });

  it('removes on Backspace and Delete on the focused remove button', async () => {
    const removed = vi.fn();
    await render(SfTagComponent, { inputs: { label: 'Blog', removable: true }, on: { removed } });

    const button = screen.getByRole('button', { name: 'Remove Blog' });
    fireEvent.keyDown(button, { key: 'Backspace' });
    fireEvent.keyDown(button, { key: 'Delete' });
    fireEvent.keyDown(button, { key: 'a' });
    expect(removed).toHaveBeenCalledTimes(2);
  });

  it('disables the remove button', async () => {
    await render(SfTagComponent, { inputs: { label: 'Blog', removable: true, disabled: true } });

    expect(screen.getByRole('button', { name: 'Remove Blog' })).toBeDisabled();
  });

  it('focus() focuses the remove button', async () => {
    const { fixture } = await render(SfTagComponent, { inputs: { label: 'Blog', removable: true } });

    fixture.componentInstance.focus();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Blog' }));
  });
});
