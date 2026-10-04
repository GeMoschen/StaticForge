import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../../core/auth/auth.store';
import { SessionService } from '../../core/auth/session.service';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { parseFrameLocation } from '../../core/frame/frame-location';
import { CodePaletteService } from '../../core/ui/code-palette.service';
import { DensityService } from '../../core/ui/density.service';
import { ThemeService } from '../../core/ui/theme.service';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { AccountDraftStore } from './account-draft.store';
import { AccountPreferencesComponent } from './account-preferences.component';
import { AccountProfileComponent } from './account-profile.component';
import { AccountProjectsComponent } from './account-projects.component';
import { AccountSessionsComponent } from './account-sessions.component';
import { PasswordPolicyStore } from './password-policy.store';

const base = (extra: object[] = []) => [
  provideHttpClient(),
  provideHttpClientTesting(),
  provideRouter([]),
  ...extra,
];

describe('AccountProjectsComponent', () => {
  const memberships = [
    { projectKey: 'acme', projectName: 'Acme Website', role: 'PROJECT_ADMIN' },
    { projectKey: 'lumen', projectName: 'Lumen Coffee', role: 'VIEWER' },
  ];

  async function setup(list: object[], reload = vi.fn().mockReturnValue(of({}))) {
    await render(AccountProjectsComponent, {
      providers: base([
        { provide: AuthStore, useValue: { memberships: signal(list) } },
        { provide: SessionService, useValue: { reloadUser: reload } },
      ]),
    });
    return { reload, navigate: vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) };
  }

  it('shows the human role label, never the enum', async () => {
    await setup(memberships);
    expect(screen.getByText('Acme Website')).toBeTruthy();
    expect(screen.getByText('Project admin')).toBeTruthy();
    expect(screen.getByText('Viewer')).toBeTruthy();
    expect(screen.queryByText('PROJECT_ADMIN')).toBeNull();
  });

  it('opens a project from its Open button', async () => {
    const { navigate } = await setup(memberships);
    await fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]);
    expect(navigate).toHaveBeenCalledWith(['/p', 'acme', 'pages']);
  });

  it('has an empty state for a person in no project', async () => {
    await setup([]);
    expect(await screen.findByText('You are not a member of any project yet')).toBeTruthy();
  });

  it('shows an error with Try again while the profile cannot be read, and reads it again', async () => {
    const failing = vi.fn().mockReturnValue(throwError(() => new Error('offline')));
    const { reload } = await setup([], failing);
    expect(await screen.findByText('Your projects could not be loaded')).toBeTruthy();
    failing.mockReturnValue(of({}));
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText('Your projects could not be loaded')).toBeNull());
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe('AccountSessionsComponent', () => {
  async function setup(confirmed: boolean, revoke = vi.fn().mockReturnValue(of(undefined))) {
    await render(AccountSessionsComponent, {
      providers: base([
        { provide: ConfirmService, useValue: { confirm: vi.fn().mockResolvedValue(confirmed) } },
        { provide: SessionService, useValue: { signOutEverywhere: revoke } },
      ]),
    });
    return { revoke, confirms: TestBed.inject(ConfirmService) as unknown as { confirm: ReturnType<typeof vi.fn> }, toasts: TestBed.inject(ToastService) };
  }

  it('offers only a secondary Sign out of all sessions, behind a confirmation', async () => {
    const { revoke, confirms } = await setup(true);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Sign out of all sessions' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
    expect(confirms.confirm.mock.calls[0][0].title).toBe('Sign out of all sessions?');
  });

  it('does nothing when the confirmation is declined', async () => {
    const { revoke } = await setup(false);
    await fireEvent.click(screen.getByRole('button', { name: 'Sign out of all sessions' }));
    await new Promise((resolve) => setTimeout(resolve));
    expect(revoke).not.toHaveBeenCalled();
  });

  it('says so when signing out everywhere did not work', async () => {
    const { toasts } = await setup(true, vi.fn().mockReturnValue(throwError(() => new Error('x'))));
    await fireEvent.click(screen.getByRole('button', { name: 'Sign out of all sessions' }));
    await waitFor(() => expect(toasts.toasts().at(-1)?.message).toContain('did not work'));
  });
});

describe('AccountPreferencesComponent', () => {
  async function setup(developerAvailable: boolean) {
    const theme = { preference: signal('system'), set: vi.fn() };
    const density = { density: signal('compact'), set: vi.fn() };
    const codePalette = { palette: signal('current'), set: vi.fn() };
    const developer = { available: signal(developerAvailable), enabled: signal(true), set: vi.fn() };
    await render(AccountPreferencesComponent, {
      providers: base([
        { provide: ThemeService, useValue: theme },
        { provide: DensityService, useValue: density },
        { provide: CodePaletteService, useValue: codePalette },
        { provide: DeveloperModeService, useValue: developer },
      ]),
    });
    return { theme, density, codePalette, developer };
  }

  it('applies theme and density the moment they change, with no Save button', async () => {
    const { theme, density } = await setup(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    await fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(theme.set).toHaveBeenCalledWith('dark');
    await fireEvent.click(screen.getByRole('radio', { name: 'Comfortable' }));
    expect(density.set).toHaveBeenCalledWith('comfortable');
  });

  it('offers the code palette next to theme and density: Current is selected, Refined applies at once', async () => {
    const { codePalette } = await setup(true);
    expect(screen.getByRole('radio', { name: 'Current' }).getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(screen.getByRole('radio', { name: 'Refined' }));
    expect(codePalette.set).toHaveBeenCalledWith('refined');
  });

  it('offers developer mode only to people with developer rights, and shows the language read-only', async () => {
    const { developer } = await setup(true);
    await fireEvent.click(screen.getByRole('switch', { name: /Show developer details/ }));
    expect(developer.set).toHaveBeenCalledWith(false);
    expect(screen.getByText('English is the only language for now.')).toBeTruthy();
  });

  it('leaves developer mode out for everyone else', async () => {
    await setup(false);
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

describe('AccountProfileComponent', () => {
  async function setup() {
    const auth = { displayName: signal('Ada'), username: signal('ada'), email: signal('ada@example.com'), setUser: vi.fn() };
    await render(AccountProfileComponent, {
      providers: base([
        AccountDraftStore,
        { provide: AuthStore, useValue: auth },
        { provide: SessionService, useValue: { reloadUser: vi.fn().mockReturnValue(of({})) } },
        { provide: FrameContextStore, useValue: { location: computed(() => parseFrameLocation('/account/profile')) } },
        { provide: PasswordPolicyStore, useValue: { policy: signal(null), load: vi.fn() } },
      ]),
    });
    return { store: TestBed.inject(AccountDraftStore) };
  }

  const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

  it('enables Save only while there are unsaved changes, and offers Discard then', async () => {
    await setup();
    expect(save().getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    await fireEvent.input(screen.getByLabelText(/Display name/), { target: { value: 'Ada L.' } });
    await waitFor(() => expect(save().getAttribute('aria-disabled')).not.toBe('true'));
    await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect((screen.getByLabelText(/Display name/) as HTMLInputElement).value).toBe('Ada'));
  });

  it('reveals the current password only when the username or email changes', async () => {
    await setup();
    expect(screen.queryByLabelText(/Current password/)).toBeNull();
    await fireEvent.input(screen.getByLabelText(/Email/), { target: { value: 'ada@new.example.com' } });
    expect(await screen.findByLabelText(/Current password/)).toBeTruthy();
    expect(screen.getByText('Needed to change your username or email.')).toBeTruthy();
  });

  it('names what is wrong on the field when a save is refused', async () => {
    await setup();
    await fireEvent.input(screen.getByLabelText(/Email/), { target: { value: 'nope' } });
    await fireEvent.click(save());
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(screen.getByText('Enter your current password to change your username or email.')).toBeTruthy();
  });
});
