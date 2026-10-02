import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SampleState } from '../sample-state';
import { checkPassword, passwordProblems } from './auth-password.util';
import { SampleAuthAreaComponent } from './sample-auth-area.component';

async function setup(area: 'login' | 'setpassword', query: Record<string, string> = {}) {
  const result = await render(SampleAuthAreaComponent, {
    providers: [
      SampleState,
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
    ],
  });
  const state = TestBed.inject(SampleState);
  state.openArea(area);
  result.detectChanges();
  await screen.findByRole('heading', { level: 1 });
  return { ...result, state };
}

const submit = () => screen.getByRole('button', { name: /^(Sign in|Signing in…|Set password)$/ });

describe('checkPassword', () => {
  it('judges nothing while the field is empty', () => {
    const check = checkPassword('', '');
    expect(check.rules.map((r) => r.state)).toEqual(['idle', 'idle', 'idle', 'idle']);
    expect(check.valid).toBe(false);
  });

  it('meets every rule with a long enough mixed password that matches', () => {
    const check = checkPassword('Correct-horse-42', 'Correct-horse-42');
    expect(check.rules.every((r) => r.state === 'met')).toBe(true);
    expect(check.valid).toBe(true);
    expect(passwordProblems(check)).toBe(0);
  });

  it('marks unmet rules only after typing and counts the limit in characters', () => {
    expect(checkPassword('short', 'other').rules.map((r) => [r.id, r.state])).toEqual([
      ['length', 'unmet'],
      ['letter', 'met'],
      ['symbol', 'unmet'],
      ['match', 'unmet'],
    ]);
    const long = 'é1'.repeat(40);
    expect(checkPassword(long, long).overLimit).toBe(80);
    expect(checkPassword(long, long).valid).toBe(false);
    expect(checkPassword('é1'.repeat(36), null).overLimit).toBeNull();
  });
});

describe('SampleAuthAreaComponent', () => {
  afterEach(() => vi.useRealTimers());

  describe('Sign in', () => {
    it('is a card with one h1, a disabled primary button until both fields are filled, and no implementation text', async () => {
      await setup('login');
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sign in');
      expect(submit()).toHaveAttribute('aria-disabled', 'true');
      expect(screen.queryByText(/memory/i)).toBeNull();
      await fireEvent.input(screen.getByLabelText('Username'), { target: { value: 'ada' } });
      expect(submit()).toHaveAttribute('aria-disabled', 'true');
      await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'secret' } });
      expect(submit()).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('shows the error inline for the refused password and clears it on the next edit', async () => {
      vi.useFakeTimers();
      const view = await setup('login');
      await fireEvent.input(screen.getByLabelText('Username'), { target: { value: 'ada' } });
      await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
      await fireEvent.click(submit());
      expect(screen.getByRole('button', { name: 'Signing in…' })).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(1000);
      view.detectChanges();
      expect(screen.getByRole('alert')).toHaveTextContent('The username or password is not right. Try again.');
      await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'wrong2' } });
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('opens Pages for any other password', async () => {
      vi.useFakeTimers();
      const { state } = await setup('login');
      await fireEvent.input(screen.getByLabelText('Username'), { target: { value: 'ada' } });
      await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'right' } });
      await fireEvent.click(submit());
      await vi.advanceTimersByTimeAsync(1000);
      expect(state.area()).toBe('pages');
    });

    it('starts in the state lstate names', async () => {
      await setup('login', { lstate: 'error' });
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('toggles the password between hidden and shown', async () => {
      await setup('login');
      const field = screen.getByLabelText('Password');
      expect(field).toHaveAttribute('type', 'password');
      await fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
      expect(field).toHaveAttribute('type', 'text');
    });
  });

  describe('Set password', () => {
    it('keeps the checklist neutral and the button disabled while empty', async () => {
      await setup('setpassword');
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Choose a new password');
      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(4);
      for (const item of items) {
        expect(item).toHaveTextContent('not checked yet');
        expect(item).toHaveClass('is-idle');
      }
      expect(submit()).toHaveAttribute('aria-disabled', 'true');
    });

    it('turns rules into met or unmet as the person types and enables the button when all are met', async () => {
      await setup('setpassword');
      await fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'short' } });
      expect(screen.getByText('At least 12 characters').closest('li')).toHaveClass('is-unmet');
      expect(screen.getByText('At least one letter').closest('li')).toHaveClass('is-met');
      await fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'Correct-horse-42' } });
      await fireEvent.input(screen.getByLabelText('Repeat the new password'), { target: { value: 'Correct-horse-42' } });
      expect(submit()).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('explains the limit in characters only once it is exceeded', async () => {
      await setup('setpassword');
      expect(screen.queryByText(/the limit is/)).toBeNull();
      await fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'ab1'.repeat(30) } });
      expect(screen.getByText('That is 90 characters; the limit is 72.')).toBeInTheDocument();
      expect(screen.queryByText(/byte/i)).toBeNull();
    });
  });
});
