import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { DeveloperModeService } from '../../../core/frame/developer-mode.service';
import { ProjectAccessStore } from '../../../core/project/project-access.store';
import { provideProjectPermissions } from '../../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../../core/ui/toast.service';
import { PublishingQualityComponent } from './quality.component';
import { type QualityLastRunView, QualityRulesService } from './quality-rules.service';
import { defaultDraftOf, draftOf, errorsByRule, groupSeverity, minAboveMax, requestOf } from './quality.util';

type QualityRuleItem = components['schemas']['QualityRuleItem'];
type QualityRulesRequest = components['schemas']['QualityRulesRequest'];

const CHANNELS = 'HTML channels only';

// Rules as QualityRulesController#get sends them (captured from GET /quality-rules, descriptions shortened): 0103 is
// capped at WARNING and stored as ERROR through the API, 0201 defaults to ERROR, 0202 has min/max settings and is
// configured as ERROR with a changed maximum, 0211 has a switch.
const RULES: QualityRuleItem[] = [
  {
    code: 'SF-CHK-0101',
    name: 'Link to a missing page or file',
    category: 'LINKS',
    kind: 'SITE',
    description: 'A link points at a path that is not an output of this build.',
    fixHint: 'CONTENT_OR_TEMPLATE',
    defaultSeverity: 'WARNING',
    severity: 'WARNING',
    maxSeverity: 'ERROR',
    params: [],
    channels: CHANNELS,
  },
  {
    code: 'SF-CHK-0103',
    name: 'Link to a page held back in this build',
    category: 'LINKS',
    kind: 'SITE',
    description: 'A link points to a page this build held back. Fix the held-back page.',
    fixHint: 'CONTENT',
    defaultSeverity: 'WARNING',
    severity: 'ERROR',
    maxSeverity: 'WARNING',
    params: [],
    channels: CHANNELS,
  },
  {
    code: 'SF-CHK-0201',
    name: 'Missing or empty title',
    category: 'SEO',
    kind: 'PAGE',
    description: 'The page has no title.',
    fixHint: 'TEMPLATE',
    defaultSeverity: 'ERROR',
    severity: 'ERROR',
    maxSeverity: 'ERROR',
    params: [],
    channels: CHANNELS,
  },
  {
    code: 'SF-CHK-0202',
    name: 'Title length',
    category: 'SEO',
    kind: 'PAGE',
    description: 'The title is shorter or longer than the configured range.',
    fixHint: 'CONTENT_OR_TEMPLATE',
    defaultSeverity: 'WARNING',
    severity: 'ERROR',
    maxSeverity: 'ERROR',
    params: [
      { name: 'min', type: 'INTEGER', value: 10, defaultValue: 10, min: 0, max: 1000, description: 'The fewest characters, inclusive.' },
      { name: 'max', type: 'INTEGER', value: 70, defaultValue: 60, min: 1, max: 1000, description: 'The most characters, inclusive.' },
    ],
    channels: CHANNELS,
  },
  {
    code: 'SF-CHK-0211',
    name: 'Canonical link missing or broken',
    category: 'SEO',
    kind: 'PAGE',
    description: 'Reports a canonical link that points at a missing page.',
    fixHint: 'TEMPLATE',
    defaultSeverity: 'OFF',
    severity: 'OFF',
    maxSeverity: 'ERROR',
    // A boolean setting has no bounds: the API sends explicit nulls.
    params: [
      {
        name: 'required',
        type: 'BOOLEAN',
        value: false,
        defaultValue: false,
        min: null,
        max: null,
        description: 'Report pages without a canonical link.',
      } as unknown as NonNullable<QualityRuleItem['params']>[number],
    ],
    channels: CHANNELS,
  },
  {
    code: 'SF-CHK-0301',
    name: 'Image without alt attribute',
    category: 'ACCESSIBILITY',
    kind: 'PAGE',
    description: 'Screen readers announce the file name instead.',
    fixHint: 'CONTENT_OR_TEMPLATE',
    defaultSeverity: 'WARNING',
    severity: 'WARNING',
    maxSeverity: 'ERROR',
    params: [],
    channels: CHANNELS,
  },
];

const LAST_RUN: QualityLastRunView = {
  run: { id: 42, status: 'PARTIAL', finishedAt: '2026-10-08T10:00:00Z', targetId: 1, findingErrors: 2, findingWarnings: 5, truncated: 0 },
  counts: { 'SF-CHK-0301': 4, 'SF-CHK-0101': 1 },
};

interface Setup {
  role?: string;
  rules?: QualityRuleItem[];
  lastRun?: QualityLastRunView | 'fail';
  readOnlyLabel?: string | null;
  dev?: boolean;
}

async function setup({ role = 'DEVELOPER', rules = RULES, lastRun = LAST_RUN, readOnlyLabel = null, dev = false }: Setup = {}) {
  const api = {
    get: vi.fn().mockReturnValue(of({ rules })),
    lastRun: vi.fn().mockReturnValue(lastRun === 'fail' ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(lastRun)),
    update: vi.fn((_key: string, _body: QualityRulesRequest) => of({ rules })),
  };
  const access = { readOnly: signal(readOnlyLabel !== null), readOnlyLabel: signal(readOnlyLabel) };
  const view = await render(PublishingQualityComponent, {
    componentInputs: { projectKey: 'proj' },
    providers: [
      provideRouter([]),
      { provide: QualityRulesService, useValue: api },
      { provide: ProjectAccessStore, useValue: access },
      { provide: DeveloperModeService, useValue: { enabled: signal(dev) } },
      provideProjectPermissions({ role: () => role }),
    ],
  });
  await screen.findByText('Link to a missing page or file');
  return { ...view, api };
}

const ruleRow = (name: string) => screen.getByText(name).closest('li') as HTMLElement;
const levelGroup = (row: HTMLElement) => within(row).getByRole('radiogroup', { name: /^Level of/ });
const level = (row: HTMLElement, name: string | RegExp) => within(levelGroup(row)).getByRole('radio', { name });
const save = () => screen.getByRole('button', { name: 'Save' });
const summary = (kind: 'on' | 'off' | 'errors') => document.querySelector(`[data-sf-summary="${kind}"]`)!.textContent!.trim();

describe('PublishingQualityComponent', () => {
  it('groups the rules by category with how many are on', async () => {
    await setup();

    expect(screen.getByRole('heading', { level: 2, name: /Links/ }).textContent).toContain('2 of 2 on');
    expect(screen.getByRole('heading', { level: 2, name: /SEO/ }).textContent).toContain('2 of 3 on');
    expect(screen.getByRole('heading', { level: 2, name: /Accessibility/ }).textContent).toContain('1 of 1 on');
    expect(screen.getByText('HTML channels only: other channels (Markdown, …) are not checked.')).toBeInTheDocument();
  });

  it('summarises the rules on, off and holding pages back as the build applies them', async () => {
    await setup();

    // 0103 is stored as Error but capped at Warning, so only 0201 and 0202 hold pages back.
    expect(summary('on')).toBe('5');
    expect(summary('off')).toBe('1');
    expect(summary('errors')).toBe('2');
  });

  it('shows the last run with its totals and a link that opens it, and the findings per rule', async () => {
    await setup();

    expect(screen.getByText('Last run #42')).toBeInTheDocument();
    expect(screen.getByText('2 errors')).toBeInTheDocument();
    expect(screen.getByText('5 warnings')).toBeInTheDocument();
    const open = screen.getByRole('link', { name: 'Open run' });
    expect(open.getAttribute('href')).toBe('/p/proj/publishing/runs?run=42');
    expect(within(ruleRow('Image without alt attribute')).getByText('4 in the last run')).toBeInTheDocument();
    expect(within(ruleRow('Link to a missing page or file')).getByText('1 in the last run')).toBeInTheDocument();
    expect(within(ruleRow('Title length')).queryByText(/in the last run/)).toBeNull();
  });

  it('says "No finished run yet" without an Open run button when there is no finished run', async () => {
    await setup({ lastRun: { run: null, counts: null } });

    expect(screen.getByText('Last run')).toBeInTheDocument();
    expect(screen.getByText('No finished run yet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open run' })).toBeNull();
    expect(screen.queryByText(/in the last run/)).toBeNull();
  });

  it('shows the same neutral tile when the last run could not be read, and still shows the rules', async () => {
    await setup({ lastRun: 'fail' });
    expect(screen.getByText('No finished run yet')).toBeInTheDocument();

    expect(screen.getByText('Image without alt attribute')).toBeInTheDocument();
  });

  it('marks the default level of a rule and what each rule is fixed in', async () => {
    await setup();

    const row = ruleRow('Missing or empty title');
    expect(level(row, 'Error (default)')).toBeChecked();
    expect(within(row).getByText('Fix in the template')).toBeInTheDocument();
    expect(within(ruleRow('Link to a missing page or file')).getByText('Content or template')).toBeInTheDocument();
    expect(within(ruleRow('Link to a page held back in this build')).getByText('Fix in content')).toBeInTheDocument();
  });

  it('hides rule codes outside developer mode', async () => {
    await setup();

    expect(screen.queryByText('SF-CHK-0101')).toBeNull();
  });

  it('shows rule codes in developer mode', async () => {
    await setup({ dev: true });

    expect(screen.getByText('SF-CHK-0101')).toBeInTheDocument();
  });

  it('shows a rule capped at Warning without Error, applied as Warning when stored as Error', async () => {
    await setup();

    const row = ruleRow('Link to a page held back in this build');
    expect(level(row, /^Error/)).toBeDisabled();
    expect(level(row, /^Warning/)).toBeChecked();
    expect(within(row).getByText('At most a warning: its findings never hold a page back.')).toBeInTheDocument();
    expect(within(row).getByText('Configured as Error, applied as Warning')).toBeInTheDocument();
  });

  it('edits a level, saves only what differs from the defaults and then notes the full build', async () => {
    const { api } = await setup();
    expect(save()).toBeDisabled();
    expect(screen.getByText('Saved')).toBeInTheDocument();

    fireEvent.click(level(ruleRow('Image without alt attribute'), /^Off/));
    await waitFor(() => expect(save()).toBeEnabled());
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(summary('off')).toBe('2');

    fireEvent.click(save());

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    // 0103 and 0202 keep their stored (non-default) configuration; 0301 is Off; the others are at their defaults.
    expect(api.update).toHaveBeenCalledWith('proj', {
      rules: {
        'SF-CHK-0103': { severity: 'ERROR' },
        'SF-CHK-0202': { severity: 'ERROR', params: { max: 70 } },
        'SF-CHK-0301': { severity: 'OFF' },
      },
    });
    expect(await screen.findByText('The next incremental build runs as a full build because the rules changed.')).toBeInTheDocument();

    // The next edit takes the note away.
    fireEvent.click(level(ruleRow('Image without alt attribute'), /^Error/));
    await waitFor(() => expect(screen.queryByText(/runs as a full build/)).toBeNull());
  });

  it('Discard puts every edit back', async () => {
    await setup();

    fireEvent.click(level(ruleRow('Image without alt attribute'), /^Off/));
    await waitFor(() => expect(save()).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(save()).toBeDisabled());
    expect(level(ruleRow('Image without alt attribute'), /^Warning/)).toBeChecked();
  });

  it('sets a whole group at once, giving capped rules Warning for Error', async () => {
    const { api } = await setup();
    const links = screen.getByRole('radiogroup', { name: 'Set all Links rules' });
    expect(within(links).getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked && radio.getAttribute('aria-checked') !== 'true')).toBe(true);

    fireEvent.click(within(links).getByRole('radio', { name: 'Error' }));

    await waitFor(() => expect(level(ruleRow('Link to a missing page or file'), /^Error/)).toBeChecked());
    expect(level(ruleRow('Link to a page held back in this build'), /^Warning/)).toBeChecked();
    expect(within(links).getByRole('radio', { name: 'Error' })).toBeChecked();
    fireEvent.click(save());
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(api.update.mock.calls[0][1].rules!['SF-CHK-0101']).toEqual({ severity: 'ERROR' });
  });

  it('folds a group away and back', async () => {
    await setup();
    const toggle = screen.getByRole('button', { name: /Accessibility/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toHaveAttribute('hidden');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('offers Reset to default only for a rule that differs, and resets level and settings', async () => {
    await setup();
    expect(within(ruleRow('Image without alt attribute')).queryByRole('button', { name: /^Reset/ })).toBeNull();

    const row = ruleRow('Title length');
    fireEvent.click(within(row).getByRole('button', { name: 'Reset “Title length” to default' }));

    await waitFor(() => expect(level(row, 'Warning (default)')).toBeChecked());
    expect((within(row).getByLabelText(/^Maximum/) as HTMLInputElement).value).toBe('60');
    expect(within(row).queryByRole('button', { name: /^Reset/ })).toBeNull();
    expect(save()).toBeEnabled();
  });

  it('marks an out-of-range setting and blocks Save until it is fixed', async () => {
    const { api } = await setup();
    const row = ruleRow('Title length');
    const max = within(row).getByLabelText(/^Maximum/) as HTMLInputElement;
    expect(max.value).toBe('70');
    expect(within(row).getByText(/Default 60, allowed 1 to 1000/)).toBeInTheDocument();

    fireEvent.input(max, { target: { value: '5000' } });
    await waitFor(() => expect(screen.getByText('Fix the marked values to save.')).toBeInTheDocument());
    expect(within(row).getByText('Enter a number from 1 to 1000.')).toBeInTheDocument();
    expect(save()).toBeDisabled();

    fireEvent.input(max, { target: { value: '' } });
    await waitFor(() => expect(save()).toBeDisabled());

    fireEvent.input(max, { target: { value: '65' } });
    await waitFor(() => expect(save()).toBeEnabled());
    fireEvent.click(save());
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(api.update.mock.calls[0][1].rules!['SF-CHK-0202']).toEqual({ severity: 'ERROR', params: { max: 65 } });
  });

  it('blocks Save while the minimum is above the maximum', async () => {
    await setup();
    const row = ruleRow('Title length');

    fireEvent.input(within(row).getByLabelText(/^Minimum/), { target: { value: '80' } });

    expect(await within(row).findByText('The minimum must not be greater than the maximum.')).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('edits a switch setting', async () => {
    const { api } = await setup();
    const row = ruleRow('Canonical link missing or broken');
    const required = within(row).getByRole('checkbox', { name: 'Report pages without a canonical link.' });
    expect(required).not.toBeChecked();

    fireEvent.click(required);
    await waitFor(() => expect(save()).toBeEnabled());
    fireEvent.click(save());

    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(api.update.mock.calls[0][1].rules!['SF-CHK-0211']).toEqual({ params: { required: true } });
  });

  it('shows the server rejection on the rule it names, and a message that names none above', async () => {
    const { api } = await setup();
    api.update.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { detail: 'Invalid.', code: 'SF-API-0400', errors: ['SF-CHK-0202: min (11) must not be greater than max (10).', 'Something else.'] },
          }),
      ),
    );

    fireEvent.click(level(ruleRow('Image without alt attribute'), /^Off/));
    fireEvent.click(save());

    expect(await within(ruleRow('Title length')).findByText('min (11) must not be greater than max (10).')).toBeInTheDocument();
    expect(screen.getByText('Something else.')).toBeInTheDocument();
    // The edit stays, to be fixed and saved again.
    expect(level(ruleRow('Image without alt attribute'), /^Off/)).toBeChecked();
  });

  it('toasts a successful save', async () => {
    await setup();
    const show = vi.spyOn(TestBed.inject(ToastService), 'show');

    fireEvent.click(level(ruleRow('Image without alt attribute'), /^Error/));
    fireEvent.click(save());

    await waitFor(() => expect(show).toHaveBeenCalledWith('Quality rules saved.', 'success'));
  });

  it('is read-only below developer: no save bar, group controls or resets, controls disabled, and says why', async () => {
    await setup({ role: 'EDITOR' });

    expect(screen.getByText('Only developers can change the quality rules.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: /^Set all/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Reset/ })).toBeNull();
    expect(level(ruleRow('Image without alt attribute'), /^Off/)).toBeDisabled();
    expect(within(ruleRow('Title length')).getByLabelText(/^Maximum/)).toBeDisabled();
  });

  it('names the read-only state of the project', async () => {
    await setup({ readOnlyLabel: 'This project is archived.', role: 'DEVELOPER' });

    expect(screen.getByText('This project is archived.')).toBeInTheDocument();
  });
});

describe('quality.util', () => {
  it('requestOf leaves out what is at its default, so a reset removes the configuration', () => {
    const draft = { 'SF-CHK-0202': defaultDraftOf(RULES[3]), 'SF-CHK-0101': draftOf(RULES[0]) };

    expect(requestOf(RULES, draft)).toEqual({ rules: {} });
  });

  it('errorsByRule splits the server messages by the rule they name', () => {
    expect(errorsByRule(['SF-CHK-0202: bad.', 'SF-CHK-9999: x', 'plain'], ['SF-CHK-0202'])).toEqual({
      byCode: { 'SF-CHK-0202': ['bad.'] },
      other: ['SF-CHK-9999: x', 'plain'],
    });
  });

  it('minAboveMax only compares the integer min and max of one rule', () => {
    const base = draftOf(RULES[3]);

    expect(minAboveMax(RULES[3], base)).toBe(false);
    expect(minAboveMax(RULES[3], { ...base, params: { min: 80, max: 70 } })).toBe(true);
    expect(minAboveMax(RULES[0], draftOf(RULES[0]))).toBe(false);
  });

  it('groupSeverity is the level every rule has, or null when they differ', () => {
    const all = (severity: 'OFF' | 'WARNING' | 'ERROR') =>
      Object.fromEntries(RULES.slice(0, 2).map((rule) => [rule.code!, { ...draftOf(rule), severity }]));

    expect(groupSeverity(RULES.slice(0, 2), all('OFF'))).toBe('OFF');
    // 0103 is capped at Warning, so a group at "Error" holds it at Warning.
    expect(groupSeverity(RULES.slice(0, 2), { 'SF-CHK-0101': { ...draftOf(RULES[0]), severity: 'ERROR' }, 'SF-CHK-0103': { ...draftOf(RULES[1]), severity: 'WARNING' } })).toBe('ERROR');
    expect(groupSeverity(RULES.slice(0, 2), { ...all('WARNING'), 'SF-CHK-0101': { ...draftOf(RULES[0]), severity: 'OFF' } })).toBeNull();
  });
});
