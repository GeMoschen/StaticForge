import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoPipe } from '@jsverse/transloco';
import { fireEvent, render, screen } from '@testing-library/angular';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfMenuComponent } from '../../shared/components/menu/sf-menu.component';
import type { ContentDefinition } from '../forms/form.model';
import { SectionEditorComponent } from './section-editor.component';

const definition = { editors: [{ name: 'headline', type: 'TEXT' }], bodies: [] } as unknown as ContentDefinition;

async function renderCard(options: { index?: number; count?: number; readOnly?: boolean; instanceId?: string } = {}) {
  const outputs = { moveUp: vi.fn(), moveDown: vi.fn(), remove: vi.fn() };
  // The form engine isn't under test: the card's own header is.
  TestBed.overrideComponent(SectionEditorComponent, {
    set: { imports: [SfIconComponent, SfMenuComponent, TranslocoPipe], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
  });
  await render(SectionEditorComponent, {
    componentInputs: {
      contentDefinition: definition,
      section: { instanceId: options.instanceId ?? 's1', templateRef: 't1', content: {} },
      bodyName: 'main',
      templateUid: 'hero',
      title: 'Hero',
      index: options.index ?? 1,
      count: options.count ?? 3,
      readOnly: options.readOnly ?? false,
    },
    on: outputs,
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return outputs;
}

describe('SectionEditorComponent: card header', () => {
  beforeEach(() => localStorage.clear());

  it('has one ⋮ menu named after the section, with Move up, Move down and Remove', async () => {
    await renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Hero' }));

    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => ['Move up', 'Move down', 'Remove'].find((label) => item.textContent?.includes(label)))).toEqual([
      'Move up',
      'Move down',
      'Remove',
    ]);
  });

  it('emits what is chosen, without folding the card', async () => {
    const outputs = await renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Hero' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Move down/ }));
    expect(outputs.moveDown).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Hero' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Remove/ }));
    expect(outputs.remove).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('sf-section-collapsed-s1')).toBeNull();
  });

  it('cannot move the first section up or the last one down', async () => {
    await renderCard({ index: 0, count: 2 });

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Hero' }));

    expect((await screen.findByRole('menuitem', { name: /Move up/ })).getAttribute('aria-disabled')).toBe('true');
    expect((await screen.findByRole('menuitem', { name: /Move down/ })).getAttribute('aria-disabled')).not.toBe('true');
  });

  it('has no menu while read-only', async () => {
    await renderCard({ readOnly: true });

    expect(screen.queryByRole('button', { name: 'Actions for Hero' })).toBeNull();
  });

  it('folds and unfolds with the header, remembered per section instance', async () => {
    await renderCard({ instanceId: 's7' });

    fireEvent.click(screen.getByRole('button', { name: 'Show or hide the section' }));

    expect(localStorage.getItem('sf-section-collapsed-s7')).toBe('1');
  });
});
