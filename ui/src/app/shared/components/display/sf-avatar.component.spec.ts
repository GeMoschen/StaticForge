import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SfAvatarComponent, avatarInitials } from './sf-avatar.component';

describe('SfAvatarComponent', () => {
  it('shows initials as an image named by the person', async () => {
    await render(`<sf-avatar name="Ada King Lovelace" size="lg" />`, { imports: [SfAvatarComponent] });

    const avatar = screen.getByRole('img', { name: 'Ada King Lovelace' });
    expect(avatar).toHaveTextContent('AL');
    expect(avatar).toHaveClass('sf-avatar--lg');
    expect(avatar.className).toMatch(/sf-avatar--tone-\d/);
  });

  it('picks the same colour for the same name', async () => {
    await render(`<sf-avatar name="Grace Hopper" /><sf-avatar name="Grace Hopper" />`, {
      imports: [SfAvatarComponent],
    });

    const [first, second] = screen.getAllByRole('img');
    const tone = (element: HTMLElement) => element.className.match(/sf-avatar--tone-\d/)![0];
    expect(tone(first)).toBe(tone(second));
  });

  it('names an avatar without a name "Unknown user"', async () => {
    await render(`<sf-avatar />`, { imports: [SfAvatarComponent] });

    expect(screen.getByRole('img', { name: 'Unknown user' })).toBeInTheDocument();
  });

  it('shows the image with the name as alt and falls back to initials when it fails', async () => {
    await render(`<sf-avatar name="Alan Turing" src="/missing.png" />`, { imports: [SfAvatarComponent] });

    const image = screen.getByRole('img', { name: 'Alan Turing' });
    expect(image.tagName).toBe('IMG');

    fireEvent.error(image);

    const fallback = await screen.findByRole('img', { name: 'Alan Turing' });
    expect(fallback.tagName).toBe('SF-AVATAR');
    expect(fallback).toHaveTextContent('AT');
  });

  it('is hidden from assistive tech when decorative', async () => {
    await render(`<sf-avatar name="Alan Turing" decorative />`, { imports: [SfAvatarComponent] });

    expect(screen.queryByRole('img')).toBeNull();
    expect(document.querySelector('sf-avatar')).toHaveAttribute('aria-hidden', 'true');
  });

  it('takes at most two initials', () => {
    expect(avatarInitials('ada')).toBe('A');
    expect(avatarInitials('  ')).toBe('');
    expect(avatarInitials('Jean Luc Picard')).toBe('JP');
  });
});
