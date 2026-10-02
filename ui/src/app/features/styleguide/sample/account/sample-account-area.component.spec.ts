import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { ToastService } from '../../../../core/ui/toast.service';
import { SampleState } from '../sample-state';
import { SampleAccountAreaComponent } from './sample-account-area.component';

async function setup(query: Record<string, string> = {}) {
  const result = await render(SampleAccountAreaComponent, {
    providers: [
      SampleState,
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
    ],
  });
  await screen.findByRole('heading', { level: 1 });
  return { ...result, sample: TestBed.inject(SampleState) };
}

const h1 = () => screen.getByRole('heading', { level: 1 });
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const lastToast = () => TestBed.inject(ToastService).toasts().at(-1);

describe('SampleAccountAreaComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens Profile with one h1 and the five sections in the side menu', async () => {
    await setup();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(h1()).toHaveTextContent('Profile');
    const nav = screen.getByRole('navigation', { name: 'Account sections' });
    expect(within(nav).getAllByRole('button').map((b) => b.querySelector('.sf-side-nav__label')?.textContent?.trim())).toEqual([
      'Profile',
      'Password',
      'Preferences',
      'My projects',
      'Sessions',
    ]);
  });

  it('selects the section from acsec and writes it back when switching', async () => {
    await setup({ acsec: 'sessions' });
    const replace = vi.spyOn(TestBed.inject(Location), 'replaceState');
    expect(h1()).toHaveTextContent('Sessions');
    await fireEvent.click(screen.getByRole('button', { name: /Preferences/ }));
    await waitFor(() => expect(h1()).toHaveTextContent('Preferences'));
    await waitFor(() => expect(String(replace.mock.lastCall?.[1])).toContain('acsec=preferences'));
  });

  describe('Profile', () => {
    it('enables Save only while there are changes and asks for the current password when the email changes', async () => {
      await setup();
      expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
      expect(screen.queryByLabelText(/Current password/)).toBeNull();
      await fireEvent.input(screen.getByLabelText(/Email/), { target: { value: 'anna@other.example' } });
      expect(saveButton()).not.toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByLabelText(/Current password/)).toBeInTheDocument();
      expect(screen.getByText('Needed to change your username or email.')).toBeInTheDocument();
    });

    it('refuses a save without the current password, then saves with it', async () => {
      await setup();
      await fireEvent.input(screen.getByLabelText(/Username/), { target: { value: 'anna2' } });
      await fireEvent.click(saveButton());
      expect(screen.getByText('Enter your current password to change your username or email.')).toBeInTheDocument();
      await fireEvent.input(screen.getByLabelText(/Current password/), { target: { value: 'secret' } });
      await fireEvent.click(saveButton());
      await waitFor(() => expect(saveButton()).toHaveAttribute('aria-disabled', 'true'));
      expect(lastToast()?.message).toBe('Profile saved.');
    });
  });

  describe('Password', () => {
    it('keeps the rules neutral while empty, shows the note and disables Save', async () => {
      await setup({ acsec: 'password' });
      expect(screen.getByText('Changing your password signs you out of every other session.')).toBeInTheDocument();
      const rules = screen.getByRole('list', { name: 'Password rules' });
      for (const item of within(rules).getAllByRole('listitem')) {
        expect(item).toHaveClass('is-idle');
      }
      expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    });

    it('says how many things stand in the way when Save is refused', async () => {
      await setup({ acsec: 'password' });
      await fireEvent.input(screen.getByLabelText(/^New password/), { target: { value: 'short' } });
      await fireEvent.click(saveButton());
      expect(await screen.findByText(/Not saved — \d+ errors?/)).toBeInTheDocument();
    });
  });

  describe('Preferences', () => {
    it('applies theme, density and developer mode at once, with no Save button', async () => {
      const { sample } = await setup({ acsec: 'preferences' });
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
      await fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
      expect(sample.theme()).toBe('dark');
      await fireEvent.click(screen.getByRole('radio', { name: 'Comfortable' }));
      expect(sample.density()).toBe('comfortable');
      const before = sample.devMode();
      await fireEvent.click(screen.getByRole('switch', { name: /developer/i }));
      expect(sample.devMode()).toBe(!before);
    });

    it('shows the language as read-only English', async () => {
      await setup({ acsec: 'preferences' });
      expect(screen.getByRole('combobox', { name: 'Language' })).toBeDisabled();
      expect(screen.getByText('English is the only language for now.')).toBeInTheDocument();
    });
  });

  describe('My projects', () => {
    it('shows human role labels, never the enum', async () => {
      await setup({ acsec: 'projects' });
      const table = await screen.findByRole('grid', { name: 'My projects' }).catch(() => screen.findByRole('table', { name: 'My projects' }));
      for (const label of ['Project admin', 'Editor', 'Release manager', 'Developer', 'Viewer']) {
        expect(within(table).getByText(label)).toBeInTheDocument();
      }
      expect(within(table).queryByText(/PROJECT_ADMIN|RELEASE_MANAGER/)).toBeNull();
    });

    it('has an error state with Try again', async () => {
      await setup({ acsec: 'projects', acstate: 'error' });
      expect(screen.getByRole('alert')).toHaveTextContent('Your projects could not be loaded');
      await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('has an empty state for a person in no project', async () => {
      await setup({ acsec: 'projects', acstate: 'empty' });
      expect(screen.getByText('You are not a member of any project yet')).toBeInTheDocument();
    });

    it('has a loading skeleton', async () => {
      await setup({ acsec: 'projects', acstate: 'loading' });
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });
  });

  describe('Sessions', () => {
    it('signs out of all sessions only after the confirmation', async () => {
      await setup({ acsec: 'sessions' });
      const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      await fireEvent.click(screen.getByRole('button', { name: 'Sign out of all sessions' }));
      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      expect(lastToast()?.message).not.toBe('Signed out of all sessions.');
      await fireEvent.click(screen.getByRole('button', { name: 'Sign out of all sessions' }));
      await waitFor(() => expect(lastToast()?.message).toBe('Signed out of all sessions.'));
    });
  });
});
