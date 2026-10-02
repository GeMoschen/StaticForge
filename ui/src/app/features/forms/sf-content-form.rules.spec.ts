import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { FormBuilderService } from './form-builder.service';
import type { ContentDefinition } from './form.model';
import { SfContentFormComponent } from './sf-content-form.component';

const definition = {
  editors: [
    { name: 'title', type: 'TEXT', label: 'Title', localizable: true },
    { name: 'slug', type: 'TEXT', label: 'Slug' },
    { name: 'subtitle', type: 'TEXT', label: 'Subtitle' },
    { name: 'teaser', type: 'TEXT', label: 'Teaser', width: 'half' },
  ],
  bodies: [],
} as unknown as ContentDefinition;

/**
 * The form hands each editor what belongs inside its field (M35.17): the language chip, the rule and server findings and the
 * *Computed* cue. These specs render the real editors and look at the field they draw.
 */
describe('SfContentFormComponent — what the form shows inside the field', () => {
  let fixture: ComponentFixture<SfContentFormComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SfContentFormComponent],
      providers: [provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(SfContentFormComponent);
    fixture.componentRef.setInput('definition', definition);
    fixture.componentRef.setInput('formGroup', new FormBuilderService().build(definition, {}));
  });

  function editor(name: string): HTMLElement {
    return (fixture.nativeElement as HTMLElement).querySelector(`[data-sf-editor="${name}"]`)!;
  }

  const levels = (name: string) =>
    Array.from(editor(name).querySelectorAll<HTMLElement>('sf-finding')).map((finding) => finding.className.match(/sf-finding--(\w+)/)![1]);

  it('shows each finding under the control inside its field, most severe first, as an alert only for an error', () => {
    fixture.componentRef.setInput('issues', [
      { path: 'content.title', message: 'Consider a subtitle.', severity: 'HINT' },
      { path: 'content.title', message: 'Replace the placeholder.', severity: 'ERROR' },
      { path: 'content.title', message: 'Long title.', severity: 'WARNING' },
      { path: 'content.subtitle', message: 'Subtitles help search.', severity: 'INFO' },
    ]);
    fixture.detectChanges();

    expect(levels('title')).toEqual(['error', 'warning', 'hint']);
    const findings = editor('title').querySelectorAll('sf-finding');
    expect(findings[0].getAttribute('role')).toBe('alert');
    expect(findings[1].getAttribute('role')).toBe('status');
    expect(editor('title').querySelector('.sf-field')).not.toBeNull();
    expect(levels('subtitle')).toEqual(['info']);
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

  it('marks a field a rule makes required and tags a computed one, without a second "required" error', () => {
    fixture.componentRef.setInput('fieldStates', [
      { path: 'content.title', required: true },
      { path: 'content.slug', readOnly: true, computed: true },
    ]);
    fixture.detectChanges();
    expect(editor('title').querySelector('.sf-field__required')).not.toBeNull();
    expect(editor('slug').querySelector('.sf-field__head')?.textContent).toContain('Computed');
    expect(editor('slug').textContent).toContain('Filled in from other fields.');
    expect(editor('slug').textContent).not.toContain('A rule makes this field read-only.');
    // The title is empty and required: the field says so once.
    expect(editor('title').textContent?.match(/This field is required/g)).toHaveLength(1);
  });

  it('puts the language chip on the label line only for a localized form: the editing language, or "All languages"', () => {
    fixture.detectChanges();
    expect(editor('title').querySelector('.sf-field__head')?.textContent).not.toContain('English');

    fixture.componentRef.setInput('editingLocale', { locale: 'en', chain: ['en', 'de'] });
    fixture.componentRef.setInput('localeLabels', { en: 'English', de: 'Deutsch' });
    fixture.detectChanges();
    expect(editor('title').querySelector('.sf-field__head')?.textContent).toContain('English');
    expect(editor('slug').querySelector('.sf-field__head')?.textContent).toContain('All languages');
  });

  it('lets only the fields the template marks `width: half` pair up', () => {
    fixture.detectChanges();
    expect(editor('teaser').classList).toContain('sf-content-form__editor--half');
    expect(editor('title').classList).not.toContain('sf-content-form__editor--half');
  });
});
