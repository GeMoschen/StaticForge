import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { computed } from '@angular/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../core/ui/toast.service';
import { ProjectSettingsQualityComponent } from './project-settings-quality.component';
import { QualityRulesService } from './quality-rules.service';
import { errorsByRule, requestOf, draftOf, ruleErrors } from './quality-rules.util';

type QualityRulesView = components['schemas']['QualityRulesView'];
type QualityRuleItem = components['schemas']['QualityRuleItem'];
type QualityRulesRequest = components['schemas']['QualityRulesRequest'];

const CHANNELS = 'HTML channels only';
/** A boolean parameter's bounds as the API sends them: explicit `null`s (the generated type says `number`). */
const NO_BOUNDS = { min: null, max: null } as unknown as { min?: number; max?: number };

// Rules as QualityRulesController#get sends them (captured from GET /quality-rules, descriptions shortened): the
// checker's own code and 0103 capped at WARNING, 0202 configured as ERROR with a changed max, 0103 stored as ERROR
// through the API.
const RULES: QualityRuleItem[] = [
  {
    code: 'SF-CHK-0001',
    name: 'Output could not be checked',
    category: 'LINKS',
    kind: 'PAGE',
    description: 'The output could not be parsed, or a check failed on it.',
    fixHint: 'TEMPLATE',
    defaultSeverity: 'WARNING',
    severity: 'WARNING',
    maxSeverity: 'WARNING',
    params: [],
    channels: CHANNELS,
  },
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
    code: 'SF-CHK-0202',
    name: 'Title length',
    category: 'SEO',
    kind: 'PAGE',
    description: 'The <title> is shorter or longer than the configured range.',
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
    code: 'SF-CHK-0210',
    name: 'Language alternates incomplete or broken',
    category: 'SEO',
    kind: 'SITE',
    description: 'hreflang alternates incomplete, not reciprocal or pointing nowhere.',
    fixHint: 'TEMPLATE',
    defaultSeverity: 'WARNING',
    severity: 'WARNING',
    maxSeverity: 'WARNING',
    params: [],
    channels: CHANNELS,
  },
  {
    code: 'SF-CHK-0211',
    name: 'Canonical link missing or broken',
    category: 'SEO',
    kind: 'SITE',
    description: 'The page’s canonical link points at no page of this build.',
    fixHint: 'TEMPLATE',
    defaultSeverity: 'WARNING',
    severity: 'WARNING',
    maxSeverity: 'ERROR',
    params: [{ name: 'required', type: 'BOOLEAN', value: false, defaultValue: false, ...NO_BOUNDS, description: 'Report pages without a canonical link.' }],
    channels: CHANNELS,
  },
  {
    code: 'SF-CHK-0301',
    name: 'Image without alt attribute',
    category: 'ACCESSIBILITY',
    kind: 'PAGE',
    description: 'An image has no alt attribute, so screen readers announce its file name.',
    fixHint: 'CONTENT_OR_TEMPLATE',
    defaultSeverity: 'WARNING',
    severity: 'OFF',
    maxSeverity: 'ERROR',
    params: [],
    channels: CHANNELS,
  },
];

interface Setup {
  role?: string;
  readOnly?: boolean;
  rules?: QualityRuleItem[];
  update?: (body: QualityRulesRequest) => ReturnType<QualityRulesService['update']>;
}

async function setup({ role = 'DEVELOPER', readOnly = false, rules = RULES, update }: Setup = {}) {
  const api = {
    get: vi.fn().mockReturnValue(of<QualityRulesView>({ rules })),
    update: vi.fn((_key: string, body: QualityRulesRequest) =>
      update ? update(body) : of<QualityRulesView>({ rules }),
    ),
  };
  const toasts = { show: vi.fn() };
  await render(ProjectSettingsQualityComponent, {
    componentInputs: { projectKey: 'proj' },
    providers: [
      { provide: QualityRulesService, useValue: api },
      { provide: ToastService, useValue: toasts },
      {
        provide: ProjectAccessStore,
        useValue: {
          readOnly: computed(() => readOnly),
          readOnlyLabel: computed(() => (readOnly ? 'Viewing a past revision — read-only' : '')),
        },
      },
      provideProjectPermissions({ role: () => role, readOnly: () => readOnly }),
    ],
  });
  await screen.findByRole('heading', { name: 'Image without alt attribute' });
  return { api, toasts };
}

function rule(code: string): HTMLElement {
  const item = document.querySelector(`[data-code="${code}"]`);
  if (!(item instanceof HTMLElement)) {
    throw new Error(`No rule ${code}`);
  }
  return item;
}

function radio(code: string, label: 'Off' | 'Warning' | 'Error'): HTMLInputElement {
  return within(rule(code)).getByRole('radio', { name: new RegExp(`^${label}`) }) as HTMLInputElement;
}

function number(code: string, label: string): HTMLInputElement {
  return within(rule(code)).getByRole('spinbutton', { name: new RegExp(`^${label}`) }) as HTMLInputElement;
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
}

describe('quality-rules.util', () => {
  it('sends only what differs from a rule’s defaults, integers as numbers', () => {
    const draft = Object.fromEntries(RULES.map((item) => [item.code ?? '', draftOf(item)]));
    draft['SF-CHK-0202'] = { severity: 'ERROR', params: { min: '010', max: '80' } };

    expect(requestOf(RULES, draft)).toEqual({
      rules: {
        'SF-CHK-0103': { severity: 'ERROR' },
        'SF-CHK-0202': { severity: 'ERROR', params: { max: 80 } },
        'SF-CHK-0301': { severity: 'OFF' },
      },
    });
  });

  it('checks bounds and whole numbers per parameter, then min ≤ max across them', () => {
    const titleLength = RULES[3];
    expect(ruleErrors(titleLength, { severity: 'WARNING', params: { min: '-1', max: '1001' } })).toEqual([
      'Minimum: Enter a whole number from 0 to 1000.',
      'Maximum: Enter a whole number from 1 to 1000.',
    ]);
    expect(ruleErrors(titleLength, { severity: 'WARNING', params: { min: '1.5', max: '' } })).toHaveLength(2);
    expect(ruleErrors(titleLength, { severity: 'WARNING', params: { min: '70', max: '60' } })).toEqual([
      'The minimum (70) must not be greater than the maximum (60).',
    ]);
    expect(ruleErrors(titleLength, { severity: 'WARNING', params: { min: '60', max: '60' } })).toEqual([]);
  });

  it('maps the server’s messages to the rules they name', () => {
    expect(
      errorsByRule(
        ['SF-CHK-0202: min (70) must not be greater than max (60).', 'SF-CHK-0999: unknown rule.', 'Broken.'],
        ['SF-CHK-0202'],
      ),
    ).toEqual({
      byCode: { 'SF-CHK-0202': ['min (70) must not be greater than max (60).'] },
      other: ['SF-CHK-0999: unknown rule.', 'Broken.'],
    });
  });
});

describe('ProjectSettingsQualityComponent', () => {
  it('groups the rules into Links, SEO and Accessibility with their code, fix hint and the channels note', async () => {
    await setup();

    const groups = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent?.trim());
    expect(groups).toEqual(['Links', 'SEO', 'Accessibility']);
    const links = screen.getByRole('region', { name: 'Links' });
    expect(within(links).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Output could not be checked',
      'Link to a missing page or file',
      'Link to a page held back in this build',
    ]);
    expect(within(rule('SF-CHK-0103')).getByText('SF-CHK-0103')).toBeTruthy();
    expect(within(rule('SF-CHK-0103')).getByText('Fix in content')).toBeTruthy();
    expect(within(rule('SF-CHK-0001')).getByText('Fix in the template')).toBeTruthy();
    expect(within(rule('SF-CHK-0301')).getByText('Content or template')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('HTML channels only');
  });

  it('marks the server’s severity and the default option; parameters show their values and bounds', async () => {
    await setup();

    expect(radio('SF-CHK-0202', 'Error').checked).toBe(true);
    expect(radio('SF-CHK-0202', 'Warning').checked).toBe(false);
    expect(radio('SF-CHK-0301', 'Off').checked).toBe(true);
    expect(within(rule('SF-CHK-0301')).getByRole('radio', { name: /Warning \(default\)/ })).toBeTruthy();
    expect(number('SF-CHK-0202', 'Minimum').value).toBe('10');
    expect(number('SF-CHK-0202', 'Maximum').value).toBe('70');
    expect(number('SF-CHK-0202', 'Maximum').getAttribute('max')).toBe('1000');
    expect(within(rule('SF-CHK-0202')).getByText(/1–1000, default 60/)).toBeTruthy();
  });

  it('rules capped at Warning have Error disabled with the reason; a stored Error shows as the Warning it is', async () => {
    await setup();

    for (const code of ['SF-CHK-0001', 'SF-CHK-0103', 'SF-CHK-0210']) {
      expect(radio(code, 'Error').disabled).toBe(true);
      expect(radio(code, 'Warning').disabled).toBe(false);
    }
    expect(radio('SF-CHK-0101', 'Error').disabled).toBe(false);
    expect(within(rule('SF-CHK-0001')).getByText(/Error is not available: this rule never holds a page back/)).toBeTruthy();
    // 0103 is stored as ERROR (set through the API) and applied as WARNING (epic decision 6).
    expect(radio('SF-CHK-0103', 'Warning').checked).toBe(true);
    expect(radio('SF-CHK-0103', 'Error').checked).toBe(false);
    expect(within(rule('SF-CHK-0103')).getByText(/Configured as Error, applied as Warning/)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it('Save is enabled only when something changed and everything is valid', async () => {
    await setup();
    expect(saveButton().disabled).toBe(true);

    fireEvent.click(radio('SF-CHK-0101', 'Error'));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(radio('SF-CHK-0101', 'Warning'));
    await waitFor(() => expect(saveButton().disabled).toBe(true));

    // Out of bounds: dirty but invalid.
    fireEvent.input(number('SF-CHK-0202', 'Maximum'), { target: { value: '1001' } });
    await waitFor(() => expect(within(rule('SF-CHK-0202')).getByRole('alert').textContent).toContain('from 1 to 1000'));
    expect(number('SF-CHK-0202', 'Maximum').getAttribute('aria-invalid')).toBe('true');
    expect(saveButton().disabled).toBe(true);

    // In bounds but below the minimum: the server's min ≤ max check, made before sending.
    fireEvent.input(number('SF-CHK-0202', 'Minimum'), { target: { value: '80' } });
    fireEvent.input(number('SF-CHK-0202', 'Maximum'), { target: { value: '75' } });
    await waitFor(() =>
      expect(within(rule('SF-CHK-0202')).getByRole('alert').textContent).toContain(
        'The minimum (80) must not be greater than the maximum (75).',
      ),
    );
    expect(saveButton().disabled).toBe(true);

    fireEvent.input(number('SF-CHK-0202', 'Maximum'), { target: { value: '90' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(within(rule('SF-CHK-0202')).queryByRole('alert')).toBeNull();

    // Back to the stored values ("070" is 70): nothing to save.
    fireEvent.input(number('SF-CHK-0202', 'Minimum'), { target: { value: '10' } });
    fireEvent.input(number('SF-CHK-0202', 'Maximum'), { target: { value: '070' } });
    await waitFor(() => expect(saveButton().disabled).toBe(true));
  });

  it('saves the changed configuration and says that the next incremental build is a full build', async () => {
    const saved = RULES.map((item) => (item.code === 'SF-CHK-0211' ? { ...item, params: [{ ...item.params![0], value: true }] } : item));
    const { api, toasts } = await setup({ update: () => of<QualityRulesView>({ rules: saved }) });

    fireEvent.click(within(rule('SF-CHK-0211')).getByRole('checkbox', { name: /Required/ }));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());

    expect(api.update).toHaveBeenCalledWith('proj', {
      rules: {
        'SF-CHK-0103': { severity: 'ERROR' },
        'SF-CHK-0202': { severity: 'ERROR', params: { max: 70 } },
        'SF-CHK-0211': { params: { required: true } },
        'SF-CHK-0301': { severity: 'OFF' },
      },
    });
    await waitFor(() =>
      expect(screen.getByText('The next incremental build runs as a full build because the rules changed.')).toBeTruthy(),
    );
    expect(toasts.show).toHaveBeenCalledWith('Quality rules saved.', 'success');
    expect(saveButton().disabled).toBe(true);
    expect((within(rule('SF-CHK-0211')).getByRole('checkbox', { name: /Required/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('"Reset to default" puts a rule back to its defaults, and saving leaves it out of the configuration', async () => {
    const { api } = await setup();
    expect(within(rule('SF-CHK-0101')).queryByRole('button', { name: 'Reset to default' })).toBeNull();

    fireEvent.click(within(rule('SF-CHK-0202')).getByRole('button', { name: 'Reset to default' }));
    await waitFor(() => expect(radio('SF-CHK-0202', 'Warning').checked).toBe(true));
    expect(number('SF-CHK-0202', 'Maximum').value).toBe('60');
    expect(within(rule('SF-CHK-0202')).queryByRole('button', { name: 'Reset to default' })).toBeNull();

    fireEvent.click(saveButton());
    expect(api.update).toHaveBeenCalledWith('proj', {
      rules: { 'SF-CHK-0103': { severity: 'ERROR' }, 'SF-CHK-0301': { severity: 'OFF' } },
    });
  });

  it('shows the server’s errors on the rules they name; editing a rule clears its error', async () => {
    const rejection = new HttpErrorResponse({
      status: 400,
      error: {
        code: 'SF-API-0400',
        detail: 'The quality rule configuration is invalid.',
        errors: ['SF-CHK-0202: min (50) must not be greater than max (40).', 'SF-CHK-0999: unknown rule.'],
      },
    });
    await setup({ update: () => throwError(() => rejection) });

    fireEvent.click(radio('SF-CHK-0301', 'Error'));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(within(rule('SF-CHK-0202')).getByRole('alert').textContent).toContain(
        'min (50) must not be greater than max (40).',
      ),
    );
    expect(screen.getByText('SF-CHK-0999: unknown rule.')).toBeTruthy();
    expect(within(rule('SF-CHK-0301')).queryByRole('alert')).toBeNull();

    fireEvent.click(radio('SF-CHK-0202', 'Warning'));
    await waitFor(() => expect(within(rule('SF-CHK-0202')).queryByRole('alert')).toBeNull());
  });

  it('is read-only for editors', async () => {
    await setup({ role: 'EDITOR' });

    expect(screen.getByText('Only developers can change the quality rules.')).toBeTruthy();
    expect(radio('SF-CHK-0101', 'Warning').checked).toBe(true);
    expect(radio('SF-CHK-0101', 'Error').disabled).toBe(true);
    expect(radio('SF-CHK-0101', 'Off').disabled).toBe(true);
    expect(number('SF-CHK-0202', 'Maximum').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset to default' })).toBeNull();
  });

  it('is read-only for developers during time travel', async () => {
    const { api } = await setup({ role: 'DEVELOPER', readOnly: true });

    expect(screen.getByText('Viewing a past revision — read-only')).toBeTruthy();
    expect(radio('SF-CHK-0301', 'Warning').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    fireEvent.click(radio('SF-CHK-0301', 'Warning'));
    expect(api.update).not.toHaveBeenCalled();
  });
});
