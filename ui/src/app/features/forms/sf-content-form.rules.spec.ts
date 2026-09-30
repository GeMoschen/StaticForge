import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { FormBuilderService } from './form-builder.service';
import type { ContentDefinition } from './form.model';
import { SfContentFormComponent } from './sf-content-form.component';

const definition = {
  editors: [
    { name: 'title', type: 'TEXT' },
    { name: 'slug', type: 'TEXT' },
    { name: 'gallery', type: 'LIST', items: [{ name: 'caption', type: 'TEXT' }] },
  ],
  bodies: [],
} as unknown as ContentDefinition;

describe('SfContentFormComponent — editor rules (M33.8)', () => {
  let fixture: ComponentFixture<SfContentFormComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SfContentFormComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    // The editors themselves aren't under test: the form's own markup around them is.
    TestBed.overrideComponent(SfContentFormComponent, {
      set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
    fixture = TestBed.createComponent(SfContentFormComponent);
    fixture.componentRef.setInput('definition', definition);
    fixture.componentRef.setInput('formGroup', new FormBuilderService().build(definition, { gallery: [{ caption: '' }] }));
  });

  function editor(name: string): HTMLElement {
    return (fixture.nativeElement as HTMLElement).querySelector(`[data-sf-editor="${name}"]`)!;
  }

  it('shows each finding at its field, most severe first, styled by level', () => {
    fixture.componentRef.setInput('issues', [
      { path: 'content.title', message: 'Consider a subtitle.', severity: 'HINT' },
      { path: 'content.title', message: 'Replace the placeholder.', severity: 'ERROR' },
      { path: 'content.title', message: 'Long title.', severity: 'WARNING' },
      { path: 'content.gallery[0].caption', message: 'Image 1 needs a caption.', severity: 'INFO' },
    ]);
    fixture.detectChanges();

    const title = Array.from(editor('title').querySelectorAll<HTMLElement>('.sf-content-form__issue'));
    expect(title.map((p) => p.dataset['level'])).toEqual(['ERROR', 'WARNING', 'HINT']);
    expect(title[0].getAttribute('role')).toBe('alert');
    expect(title[1].getAttribute('role')).toBeNull();
    expect(title[1].classList).toContain('sf-content-form__issue--warning');
    expect(editor('gallery').textContent).toContain('Image 1 needs a caption.');
  });

  it('hides a finding of another language than the one edited', () => {
    fixture.componentRef.setInput('editingLocale', { locale: 'en', chain: ['en', 'de'] });
    fixture.componentRef.setInput('issues', [
      { path: 'content.title', message: 'German title missing.', severity: 'ERROR', locale: 'de' },
      { path: 'content.title', message: 'English title missing.', severity: 'ERROR', locale: 'en' },
    ]);
    fixture.detectChanges();
    expect(editor('title').textContent).toContain('English title missing.');
    expect(editor('title').textContent).not.toContain('German title missing.');
  });

  it('marks fields a rule makes required, read-only or computed', () => {
    fixture.componentRef.setInput('fieldStates', [
      { path: 'content.title', required: true },
      { path: 'content.slug', readOnly: true, computed: true },
    ]);
    fixture.detectChanges();
    expect(editor('title').querySelector('.sf-content-form__state--required')?.textContent).toContain('Required');
    expect(editor('slug').textContent).toContain('Computed');
    expect(editor('slug').textContent).not.toContain('Read-only');
  });
});
