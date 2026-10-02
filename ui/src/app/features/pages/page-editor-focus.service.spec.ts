import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageEditorFocusService } from './page-editor-focus.service';
import { PageEditorSectionsService } from './page-editor-sections.service';
import { PageEditorStore } from './page-editor.store';

const SECTIONS: Record<string, { instanceId: string; templateRef: string }[]> = {
  main: [
    { instanceId: 's1', templateRef: 'hero' },
    { instanceId: 's2', templateRef: 'text' },
  ],
};

describe('PageEditorFocusService', () => {
  let service: PageEditorFocusService;
  let store: { selected: ReturnType<typeof signal<string>> };

  beforeEach(() => {
    store = { selected: signal('fields') };
    Object.assign(store, {
      contentDefinition: signal({ editors: [{ name: 'title', label: 'Title' }], bodies: [] }),
      bodies: () => [{ name: 'main' }],
      sectionsFor: (body: string) => SECTIONS[body] ?? [],
    });
    TestBed.configureTestingModule({
      providers: [
        PageEditorFocusService,
        { provide: PageEditorStore, useValue: store },
        {
          provide: PageEditorSectionsService,
          useValue: {
            title: (ref: string) => ({ hero: 'Hero', text: 'Text' })[ref] ?? ref,
            defFor: () => ({ editors: [{ name: 'image', label: 'Image' }], bodies: [] }),
          },
        },
      ],
    });
    service = TestBed.inject(PageEditorFocusService);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  describe('describe', () => {
    it('names a page field, a section and a field of a section', () => {
      expect(service.describe({ editorPath: 'content.title', sectionInstanceId: null, selector: null })).toBe('Page fields › Title');
      expect(service.describe({ editorPath: 'bodies.main[0].content.image', sectionInstanceId: null, selector: null })).toBe('Hero › Image');
      expect(service.describe({ editorPath: null, sectionInstanceId: 's2', selector: null })).toBe('Text');
    });

    it('names nothing for a finding about the whole page', () => {
      expect(service.describe({ editorPath: null, sectionInstanceId: null, selector: 'body > h1' })).toBeNull();
    });
  });

  describe('goTo', () => {
    function form(): void {
      document.body.innerHTML =
        '<div data-sf-page-fields><div class="sf-content-form"><div data-sf-editor="title"><input id="title"></div></div></div>' +
        '<div class="section-card" data-sf-section="s2"><header class="section-card__header" tabindex="0"></header></div>';
      document.body.querySelectorAll('div').forEach((element) => {
        element.scrollIntoView = vi.fn();
      });
    }

    it('selects the page fields, scrolls to the field and focuses it', () => {
      form();

      const preview = service.goTo({ editorPath: 'content.title', sectionInstanceId: null, selector: null });

      expect(store.selected()).toBe('fields');
      expect(document.activeElement?.id).toBe('title');
      expect(document.querySelector('[data-sf-editor="title"]')?.classList.contains('sf-issue-target')).toBe(true);
      expect(preview).toBeNull();
    });

    it('selects a section and focuses its card, and says what the preview should outline', () => {
      form();

      const preview = service.goTo({ editorPath: null, sectionInstanceId: 's2', selector: 'body > main > p' });

      expect(store.selected()).toBe('s2');
      expect(document.activeElement?.classList.contains('section-card__header')).toBe(true);
      expect(preview).toEqual({ instanceId: 's2', selector: 'body > main > p' });
    });

    it('waits for the form to render the card', () => {
      vi.useFakeTimers();

      service.goTo({ editorPath: null, sectionInstanceId: 's2', selector: null });
      form();
      vi.advanceTimersByTime(60);

      expect(document.activeElement?.classList.contains('section-card__header')).toBe(true);
    });

    it('takes the outline nowhere for a finding about the whole page', () => {
      form();

      service.goTo({ editorPath: null, sectionInstanceId: null, selector: null });

      expect(store.selected()).toBe('fields');
    });
  });
});
