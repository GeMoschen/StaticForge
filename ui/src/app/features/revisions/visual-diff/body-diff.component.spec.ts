import { render, screen } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ApiClient } from '../../../core/api/api.client';
import { LocalesStore } from '../../../core/project/locales.store';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { SfBodyDiffComponent } from './body-diff.component';
import { expandL10nChange } from './field-diff.model';
import { resolveEditor } from './resolve-editor';
import { ContentDefinition } from '../../forms/form.model';

type FieldChange = components['schemas']['FieldChange'];

const HERO = 'b1d0c7e2-0000-4000-8000-000000000001';
const TEXT_DEF = {
  editors: [{ name: 'headline', type: 'TEXT', localizable: true }],
} as unknown as ContentDefinition;

function l10n(values: Record<string, string>) {
  return { type: 'L10N', values };
}

async function renderBody(change: FieldChange, api: Record<string, unknown>) {
  const result = await render(SfBodyDiffComponent, {
    componentInputs: { projectKey: 'proj', change },
    providers: [{ provide: ApiClient, useValue: api }],
  });
  TestBed.inject(LocalesStore).set('proj', {
    defaultLocale: 'en',
    locales: [
      { code: 'en', label: 'English' },
      { code: 'de', label: 'Deutsch' },
    ],
  } as never);
  return result;
}

describe('SfBodyDiffComponent', () => {
  const api = () => ({
    sectionTemplateDetail: vi.fn().mockReturnValue(of({ uuid: HERO, uid: 'hero', displayName: 'Hero banner', compiledDefinition: TEXT_DEF })),
  });

  it('labels a section by its template name, not its uuid, and shows an unchanged position once', async () => {
    const change: FieldChange = {
      path: 'bodies.main',
      before: [{ instanceId: 'i1', templateRef: HERO, content: { headline: l10n({ en: 'Old' }) } }] as never,
      after: [{ instanceId: 'i1', templateRef: HERO, content: { headline: l10n({ en: 'New' }) } }] as never,
    };
    await renderBody(change, api());

    const title = await screen.findByText('Hero banner');
    expect(title.textContent).not.toContain(HERO);
    const position = title.parentElement!.querySelector('.sf-bdiff__position')!;
    expect(position.textContent!.replace(/\s+/g, '')).toBe('#1');
    expect(screen.getByText('headline (English)')).toBeTruthy();
  });

  it('shows the language values of an added language-dependent field instead of [object Object]', async () => {
    const change: FieldChange = {
      path: 'bodies.main',
      before: [{ instanceId: 'i1', templateRef: HERO, content: {} }] as never,
      after: [{ instanceId: 'i1', templateRef: HERO, content: { headline: l10n({ en: 'Hello', de: 'Hallo' }) } }] as never,
    };
    const { container } = await renderBody(change, api());

    await screen.findByText('headline (English)');
    expect(screen.getByText('headline (Deutsch)')).toBeTruthy();
    expect(container.textContent).not.toContain('[object Object]');
    const values = Array.from(container.querySelectorAll('input, textarea')).map((el) => (el as HTMLInputElement).value);
    expect(values).toEqual(expect.arrayContaining(['Hello', 'Hallo']));
  });
});

describe('expandL10nChange', () => {
  it('splits a whole language-dependent value into one change per changed language', () => {
    const out = expandL10nChange({
      path: 'content.headline',
      before: l10n({ en: 'Same', de: 'Alt' }) as never,
      after: l10n({ en: 'Same', fr: 'Salut' }) as never,
    } as FieldChange);
    expect(out.map((c) => [c.path, c.before, c.after, c.add, c.remove])).toEqual([
      ['content.headline.values.de', 'Alt', undefined, false, true],
      ['content.headline.values.fr', undefined, 'Salut', true, false],
    ]);
  });

  it('leaves a plain change and a plain-to-language-dependent swap untouched', () => {
    const plain: FieldChange = { path: 'content.title', before: 'a' as never, after: 'b' as never };
    expect(expandL10nChange(plain)).toEqual([plain]);
    const swap: FieldChange = { path: 'content.title', before: 'a' as never, after: l10n({ en: 'a' }) as never };
    expect(expandL10nChange(swap)).toEqual([swap]);
  });
});

describe('resolveEditor', () => {
  it('resolves the editor of a language-dependent sub-path', () => {
    expect(resolveEditor(TEXT_DEF, 'content.headline.values.en')?.name).toBe('headline');
    expect(resolveEditor(TEXT_DEF, 'headline.values')).toBeNull();
  });
});
