import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { fireEvent, screen, waitFor } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { AuthStore } from '../../core/auth/auth.store';
import { SessionService } from '../../core/auth/session.service';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import { UnsavedChangesService } from '../../shared/components/dialog/unsaved-changes.service';
import { ACCOUNT_ROUTES } from './account.routes';
import { PasswordPolicyStore } from './password-policy.store';

@Component({ standalone: true, template: '<p>elsewhere</p>' })
class Elsewhere {}

async function setup() {
  const unsaved = { confirmLeave: vi.fn().mockResolvedValue(false) };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([...ACCOUNT_ROUTES, { path: 'elsewhere', component: Elsewhere }]),
      { provide: ApiClient, useValue: { updateMe: vi.fn().mockReturnValue(of({})) } },
      { provide: SessionService, useValue: { reloadUser: vi.fn().mockReturnValue(of({})), changeOwnPassword: vi.fn() } },
      { provide: PasswordPolicyStore, useValue: { policy: signal({ minLength: 12, requireMixed: false, maxBytes: 72 }), load: vi.fn() } },
      { provide: UnsavedChangesService, useValue: unsaved },
    ],
  });
  TestBed.inject(AuthStore).setUser({ id: 1, username: 'ada', displayName: 'Ada', email: 'ada@example.com', systemRole: 'USER', projectRoles: {} } as never);
  const harness = await RouterTestingHarness.create();
  return { harness, router: TestBed.inject(Router), unsaved };
}

const url = () => TestBed.inject(Router).url;

describe('My account routes', () => {
  it('opens Profile at /account, and Password for the old #password link', async () => {
    const { harness } = await setup();
    await harness.navigateByUrl('/account');
    expect(url()).toBe('/account/profile');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Profile');

    await harness.navigateByUrl('/account#password');
    expect(url()).toMatch(/^\/account\/password/);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Password');
  });

  it('lists the five sections in the side menu, one h1 per page', async () => {
    const { harness } = await setup();
    await harness.navigateByUrl('/account/preferences');
    const nav = screen.getByRole('navigation', { name: 'Account sections' });
    for (const name of ['Profile', 'Password', 'Preferences', 'My projects', 'Sessions']) {
      expect(nav.textContent).toContain(name);
    }
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('shows an Unsaved badge on a section with unsaved changes', async () => {
    const { harness } = await setup();
    await harness.navigateByUrl('/account/profile');
    expect(screen.getByRole('navigation', { name: 'Account sections' }).textContent).not.toContain('Unsaved');
    await fireEvent.input(screen.getByLabelText(/Display name/), { target: { value: 'Ada L.' } });
    await waitFor(() => {
      harness.detectChanges();
      expect(screen.getByRole('navigation', { name: 'Account sections' }).textContent).toContain('Unsaved');
    });
  });

  it('registers the open section as an editor, so Ctrl+S and the leave guard know it', async () => {
    const { harness } = await setup();
    await harness.navigateByUrl('/account/profile');
    const editors = TestBed.inject(ActiveEditorService);
    expect(editors.active()?.autosave).toBe(false);
    expect(editors.active()?.name()).toBe('My account › Profile');
    expect(editors.hasUnsaved()).toBe(false);
    await fireEvent.input(screen.getByLabelText(/Display name/), { target: { value: 'Ada L.' } });
    await waitFor(() => expect(editors.hasUnsaved()).toBe(true));
  });

  it('asks before an unsaved Profile is left, and stays when the person cancels', async () => {
    const { harness, unsaved } = await setup();
    await harness.navigateByUrl('/account/profile');
    await fireEvent.input(screen.getByLabelText(/Display name/), { target: { value: 'Ada L.' } });
    await waitFor(() => expect(TestBed.inject(ActiveEditorService).hasUnsaved()).toBe(true));

    await harness.navigateByUrl('/account/preferences');
    expect(unsaved.confirmLeave).toHaveBeenCalledTimes(1);
    expect(unsaved.confirmLeave.mock.calls[0][0].name).toBe('My account › Profile');
    expect(url()).toBe('/account/profile');

    unsaved.confirmLeave.mockResolvedValue(true);
    await harness.navigateByUrl('/account/preferences');
    expect(url()).toBe('/account/preferences');
  });

  it('does not ask when leaving a section without changes', async () => {
    const { harness, unsaved } = await setup();
    await harness.navigateByUrl('/account/profile');
    await harness.navigateByUrl('/elsewhere');
    expect(unsaved.confirmLeave).not.toHaveBeenCalled();
    expect(url()).toBe('/elsewhere');
  });
});
