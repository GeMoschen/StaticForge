import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ContentDefinition } from '../forms/form.model';
import { RuleHub } from '../forms/rules/rule-hub';
import { SectionEditorComponent } from './section-editor.component';

const definition = {
  editors: [
    { name: 'headline', type: 'TEXT' },
    { name: 'slug', type: 'TEXT' },
  ],
  bodies: [],
} as unknown as ContentDefinition;

describe('SectionEditorComponent — live rules (M33)', () => {
  let fixture: ComponentFixture<SectionEditorComponent>;
  let hub: RuleHub;
  let filled: Record<string, unknown>[];

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [SectionEditorComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    // The form engine isn't under test: the section's own wiring is.
    TestBed.overrideComponent(SectionEditorComponent, { set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
    fixture = TestBed.createComponent(SectionEditorComponent);
    hub = new RuleHub();
    filled = [];
    fixture.componentRef.setInput('contentDefinition', definition);
    fixture.componentRef.setInput('section', { instanceId: 's1', templateRef: 't1', content: { headline: 'Hello World' } });
    fixture.componentRef.setInput('bodyName', 'main');
    fixture.componentRef.setInput('templateUid', 'teaser');
    fixture.componentRef.setInput('index', 1);
    fixture.componentRef.setInput('count', 2);
    fixture.componentRef.setInput('rules', hub);
    fixture.componentInstance.filled.subscribe((value) => filled.push(value));
    fixture.detectChanges();
  });

  function form(): FormGroup {
    return (fixture.componentInstance as unknown as { fieldForm: () => FormGroup }).fieldForm();
  }

  it('applies the fills and states of its body path and passes the filled value up', () => {
    hub.view.set({
      findings: [],
      fills: [
        { path: 'bodies.main[1].content.slug', value: 'hello-world' as never, mode: 'EMPTY' },
        { path: 'bodies.main[0].content.slug', value: 'not-mine' as never, mode: 'EMPTY' },
      ],
      fieldStates: [{ path: 'bodies.main[1].content.headline', readOnly: true }],
    });
    TestBed.flushEffects();

    expect(form().get('slug')?.value).toBe('hello-world');
    expect(form().get('headline')?.disabled).toBe(true);
    expect(filled).toEqual([{ headline: 'Hello World', slug: 'hello-world' }]);
  });

  it('blanks its last fill in the next request, and a catalog card uses its own prefix', () => {
    hub.view.set({ findings: [], fills: [{ path: 'bodies.main[1].content.slug', value: 'x' as never, mode: 'EMPTY' }], fieldStates: [] });
    TestBed.flushEffects();
    const root = { bodies: { main: [{}, { content: { headline: 'Hello World', slug: 'x' } }] } };
    hub.prepare(root);
    expect((root.bodies.main[1] as { content: { slug: unknown } }).content.slug).toBeNull();

    fixture.componentRef.setInput('rulePrefix', 'content.teasers.cards[0].content');
    fixture.detectChanges();
    hub.view.set({
      findings: [],
      fills: [{ path: 'content.teasers.cards[0].content.slug', value: 'card' as never, mode: 'ALWAYS' }],
      fieldStates: [],
    });
    TestBed.flushEffects();
    expect(form().get('slug')?.value).toBe('card');
  });

  it('applies nothing while read-only', () => {
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();
    hub.view.set({ findings: [], fills: [{ path: 'bodies.main[1].content.slug', value: 'x' as never, mode: 'EMPTY' }], fieldStates: [] });
    TestBed.flushEffects();
    expect(form().get('slug')?.value).toBe('');
    expect(filled).toEqual([]);
  });
});
