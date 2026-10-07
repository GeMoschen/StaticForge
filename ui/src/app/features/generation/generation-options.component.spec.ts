import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { GenerationOptionsComponent } from './generation-options.component';

const BASE = '/api/v1/projects/proj';

describe('GenerationOptionsComponent (design-system controls)', () => {
  function open(anyTarget = true) {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(GenerationOptionsComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('anyTarget', anyTarget);
    fixture.detectChanges();
    http.expectOne(`${BASE}/targets`).flush([{ id: 7, name: 'Production' }, { id: 8 }]);
    http
      .expectOne(`${BASE}/channels`)
      .flush([{ key: 'html', enabled: true }, { key: 'rss', enabled: true }, { key: 'off', enabled: false }]);
    fixture.detectChanges();
    return fixture;
  }

  it('shows mode, target and channels as design-system fields', () => {
    const el = open().nativeElement as HTMLElement;
    expect(el.querySelectorAll('sf-field')).toHaveLength(3);
    expect(el.querySelector('sf-segmented')).not.toBeNull();
    expect(el.querySelector('sf-select')).not.toBeNull();
    expect(el.querySelectorAll('sf-checkbox')).toHaveLength(2);
    expect(el.textContent).toContain('Default target');
    expect(el.textContent).toContain('Production');
    expect(el.textContent).toContain('Untitled');
    expect(el.querySelector('input[type=radio]')).toBeNull();
  });

  it('keeps one channel ticked, and "all channels" is an empty list', () => {
    const fixture = open();
    const el = fixture.nativeElement as HTMLElement;
    const boxes = Array.from(el.querySelectorAll('sf-checkbox input')) as HTMLInputElement[];
    boxes[1].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.channels()).toEqual(['html']);
    expect(boxes[0].disabled).toBe(true);
    boxes[1].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.channels()).toEqual([]);
  });

  it('shows the default target as a note when only the default may be used', () => {
    const el = open(false).nativeElement as HTMLElement;
    expect(el.querySelector('sf-select')).toBeNull();
    expect(el.textContent).toContain('The build goes to the default target.');
  });
});
