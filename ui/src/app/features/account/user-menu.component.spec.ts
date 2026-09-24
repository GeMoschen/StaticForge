import { provideRouter } from '@angular/router';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { SessionService } from '../../core/auth/session.service';
import { UserMenuComponent, initialsOf } from './user-menu.component';

type MeResponse = components['schemas']['MeResponse'];

const editor: MeResponse = {
  id: 7,
  username: 'ada',
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  systemRole: 'USER',
  mustChangePassword: false,
  projectRoles: { acme: 'EDITOR' },
  memberships: [{ projectKey: 'acme', projectName: 'ACME', role: 'EDITOR' }],
};

async function setup(me: MeResponse, compact = false) {
  const session = { signOut: vi.fn() };
  const view = await render(UserMenuComponent, {
    componentInputs: { compact },
    providers: [provideRouter([]), { provide: SessionService, useValue: session }],
    configureTestBed: (tb) => tb.inject(AuthStore).setUser(me),
  });
  return { session, view };
}

describe('initialsOf', () => {
  it('takes the first and last word', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('admin')).toBe('A');
    expect(initialsOf('grace.hopper')).toBe('GH');
    expect(initialsOf('')).toBe('?');
  });
});

describe('UserMenuComponent', () => {
  it('shows who is signed in and My account, without Administration for a regular user', async () => {
    await setup(editor);

    fireEvent.click(screen.getByRole('button', { name: 'Account menu for Ada Lovelace' }));

    expect(screen.getByText('@ada')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /My account/ }).getAttribute('href')).toBe('/account');
    expect(screen.queryByRole('menuitem', { name: /Administration/ })).toBeNull();
  });

  it('offers Administration to an instance admin', async () => {
    await setup({ ...editor, systemRole: 'INSTANCE_ADMIN' });

    fireEvent.click(screen.getByRole('button', { name: /Account menu/ }));

    expect(screen.getByRole('menuitem', { name: /Administration/ }).getAttribute('href')).toBe('/admin');
  });

  it('signs out', async () => {
    const { session } = await setup(editor);

    fireEvent.click(screen.getByRole('button', { name: /Account menu/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Sign out/ }));

    expect(session.signOut).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows only the initials when compact', async () => {
    await setup(editor, true);

    const trigger = screen.getByRole('button', { name: /Account menu/ });
    expect(trigger.textContent?.trim()).toBe('AL');
  });

  it('closes on Escape', async () => {
    await setup(editor);
    fireEvent.click(screen.getByRole('button', { name: /Account menu/ }));
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
  });
});
