import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EnvironmentInjector, createComponent } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FavoritesService } from '../../core/assets/favorites.service';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { TemplateEditorComponent } from './template-editor.component';
import { TemplatesEditing } from './templates-editing';
import { TemplatesSaveCoordinator } from './templates-save.coordinator';
import { TemplatesComponent } from './templates.component';
import { TemplatesStore } from './templates.store';

/** Controllable `window.matchMedia` for the 1280 px layout switch. */
class FakeMedia {
  private listeners = new Set<(e: MediaQueryListEvent) => void>();
  constructor(public matches: boolean) {}
  addEventListener(_: string, fn: (e: MediaQueryListEvent) => void): void {
    this.listeners.add(fn);
  }
  removeEventListener(_: string, fn: (e: MediaQueryListEvent) => void): void {
    this.listeners.delete(fn);
  }
  addListener(): void {}
  removeListener(): void {}
  change(matches: boolean): void {
    this.matches = matches;
    this.listeners.forEach((fn) => fn({ matches } as MediaQueryListEvent));
  }
}

const ARTICLE = {
  uuid: 't-1',
  uid: 'article',
  assetType: 'PAGE_TEMPLATE',
  displayName: 'Article',
  category: 'Layouts',
  revision: 4,
  abstract: false,
  contentCdl: 'editor text title { label "Title" }',
  bodiesCdl: 'body main { allow ["*"] }',
  rulesCdl: '',
  channelTemplates: { html: { source: '<h1>$CMS_VALUE(title)$</h1>' }, rss: { source: '<item/>' } },
  outputPath: { html: 'index.html', rss: 'feed.xml' },
  paginationPath: {},
  ancestors: [
    { uuid: 'a-2', uid: 'docs_layout' },
    { uuid: 'a-1', uid: 'base' },
  ],
};

function emptyBodyFor(url: string): object {
  return url.endsWith('/channels') ? [{ key: 'html' }, { key: 'rss' }, { key: 'json', name: 'JSON feed' }] : url.endsWith('/datasets') || url.endsWith('/usages') ? [] : { content: [] };
}

describe('Template IDE (M35.21 B)', () => {
  let fixture: ComponentFixture<TemplatesComponent>;
  let store: TemplatesStore;
  let save: TemplatesSaveCoordinator;
  let editing: TemplatesEditing;
  let http: HttpTestingController;
  let media: FakeMedia;
  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends Element = HTMLElement>(selector: string): T | null => root().querySelector<T>(selector);
  const qa = <T extends Element = HTMLElement>(selector: string): T[] => Array.from(root().querySelectorAll<T>(selector));

  function mount(wide = true): void {
    media = new FakeMedia(wide);
    window.matchMedia = (() => media) as unknown as typeof window.matchMedia;
    TestBed.configureTestingModule({
      imports: [TemplatesComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideProjectPermissions({ role: () => 'DEVELOPER', readOnly: () => TestBed.inject(ProjectAccessStore).readOnly() }),
      ],
    });
    fixture = TestBed.createComponent(TemplatesComponent);
    const ref = createComponent(TemplateEditorComponent, {
      environmentInjector: TestBed.inject(EnvironmentInjector),
      elementInjector: fixture.debugElement.injector,
    });
    root().appendChild(ref.location.nativeElement);
    const detect = fixture.detectChanges.bind(fixture);
    fixture.detectChanges = (checkNoChanges?: boolean) => {
      detect(checkNoChanges);
      ref.changeDetectorRef.detectChanges();
    };
    fixture.componentRef.onDestroy(() => ref.destroy());
    const injector = fixture.debugElement.injector;
    store = injector.get(TemplatesStore);
    save = injector.get(TemplatesSaveCoordinator);
    editing = injector.get(TemplatesEditing);
    http = TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('projectKey', 'proj1');
    fixture.detectChanges();
    for (const req of http.match(() => true)) {
      req.flush(emptyBodyFor(req.request.url));
    }
  }

  /** The input of the field with this label. */
  function fieldInput(label: string): HTMLInputElement {
    const field = qa('sf-field').find((f) => f.querySelector('.sf-field__label')?.textContent?.trim() === label)!;
    return field.querySelector<HTMLInputElement>('input')!;
  }

  function open(detail: object = ARTICLE): void {
    store.selectedUuid.set('t-1');
    fixture.detectChanges();
    http.match((r) => r.method === 'GET' && /-templates\/t-1$/.test(r.url)).forEach((r) => r.flush(detail));
    http.match((r) => r.url.endsWith('/usages')).forEach((r) => r.flush([]));
    fixture.detectChanges();
  }

  beforeEach(() => mount());
  afterEach(() => {
    for (const pending of http.match(() => true)) {
      pending.flush(emptyBodyFor(pending.request.url));
    }
    TestBed.inject(TimeTravelStore).exit();
  });

  describe('header', () => {
    it('shows the name, the kind, the inheritance chain and the UID with a copy button', () => {
      open();
      expect(q('.tpl-head h1')?.textContent?.trim()).toBe('Article');
      expect(q('.tpl-head__title-extras')?.textContent).toContain('Page template');
      const chain = q('nav[aria-label="Inheritance chain"]')!;
      expect(Array.from(chain.querySelectorAll('li')).map((li) => li.textContent?.replace('chevron_right', '').trim())).toEqual(['base', 'docs_layout', 'article']);
      expect(chain.querySelector('[aria-current="page"]')?.textContent).toBe('article');
      expect(q('.tpl-head__meta')?.textContent).toContain('article');
      expect(q('.tpl-head__meta sf-copyable button')).not.toBeNull();
    });

    it('gives the favorite star the real template kind (not the literal string "d.type")', () => {
      open();
      const toggle = vi.spyOn(TestBed.inject(FavoritesService), 'toggle').mockReturnValue(true);
      q<HTMLButtonElement>('sf-asset-favorite button')!.click();
      expect(toggle).toHaveBeenCalledWith(expect.objectContaining({ type: 'PAGE_TEMPLATE', uuid: 't-1', displayName: 'Article' }));
    });

    it('enables Save only when something changed, and saves with it', () => {
      open();
      const button = () => q<HTMLButtonElement>('[data-sf-template-save] button')!;
      expect(button().disabled).toBe(true);
      expect(button().getAttribute('aria-keyshortcuts')).toBe('Control+S');
      editing.onSectionInput({ section: 'content', value: 'editor text headline { }' });
      fixture.detectChanges();
      expect(button().disabled).toBe(false);
      button().click();
      http.expectOne((r) => r.method === 'PUT').flush({ ...ARTICLE, contentCdl: 'editor text headline { }', revision: 5 });
    });

    it('offers Duplicate, Rename…, Move to…, Used by and Delete… in the ⋮ menu and asks the area for the first three', () => {
      open();
      q<HTMLButtonElement>('button[aria-label="More actions"]')!.click();
      fixture.detectChanges();
      const items = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      const labels = ['Duplicate', 'Rename…', 'Move to…', 'Used by', 'Delete…'];
      expect(items).toHaveLength(labels.length);
      labels.forEach((label, i) => expect(items[i].textContent).toContain(label));
      const request = vi.spyOn(store.itemRequest, 'set');
      const usedBy = vi.spyOn(store.usedByUuid, 'set');
      items[1].click();
      expect(request).toHaveBeenCalledWith({ action: 'rename', uuid: 't-1' });
      q<HTMLButtonElement>('button[aria-label="More actions"]')!.click();
      fixture.detectChanges();
      Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'))[3].click();
      expect(usedBy).toHaveBeenCalledWith('t-1');
    });

    it('says why a past revision is read-only instead of the save status, and cannot be saved', () => {
      TestBed.inject(TimeTravelStore).enter(88);
      open();
      expect(q('sf-save-status')).toBeNull();
      expect(q('.tpl-head__status')?.textContent).toContain('Revision 88 — read-only');
      expect(q<HTMLButtonElement>('[data-sf-template-save] button')!.disabled).toBe(true);
    });

    it('says an archived project is read-only', () => {
      TestBed.inject(ProjectAccessStore).enterProject('proj1', true);
      open();
      expect(q('.tpl-head__status')?.textContent).toContain('Archived project — read-only');
      expect(q('sf-save-status')).toBeNull();
    });
  });

  describe('settings', () => {
    it('is collapsed with the output paths as a summary, and opens', () => {
      open();
      const toggle = q<HTMLButtonElement>('[data-sf-settings-toggle] button')!;
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(q('[data-sf-settings-summary]')?.textContent).toBe('html: index.html  ·  rss: feed.xml');
      toggle.click();
      fixture.detectChanges();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(q('[data-sf-settings-summary]')).toBeNull();
    });

    it('edits an output path: it is unsaved, and the one Save sends it', () => {
      open();
      const input = fieldInput('Output path — html');
      input.value = 'docs/index.html';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(save.dirty()).toBe(true);
      save.saveTemplate();
      const put = http.expectOne((r) => r.method === 'PUT');
      expect((put.request.body as { outputPath: Record<string, string> }).outputPath).toEqual({ html: 'docs/index.html', rss: 'feed.xml' });
      put.flush({ ...ARTICLE, revision: 5 });
    });

    describe('the {locale} check (decision 163)', () => {
      const SERVER = { severity: 'WARNING', code: 'SF-GEN-0112', field: 'outputPath:html', message: 'The server: index.html has no {locale}.' };
      const languages = (count: number) =>
        TestBed.inject(LocalesStore).config.set({ defaultLocale: 'en', locales: ['en', 'de', 'fr'].slice(0, count).map((code) => ({ code })) } as never);
      const messages = () => qa('sf-field[data-sf-output-path-warning]').map((f) => f.querySelector('sf-finding')?.textContent?.replace(/\s+/g, ' ').trim());

      it('warns while typing in a multi-language project, once per channel next to the server warning', () => {
        languages(2);
        open({ ...ARTICLE, outputPath: { html: 'index.html', rss: '{locale}/feed.xml' }, warnings: [SERVER] });
        // The client check and the server's warning say the same: one message, in the html channel only.
        expect(messages()).toHaveLength(1);
        expect(messages()[0]).toContain('Add {locale} to the path');
        expect(qa('sf-field[data-sf-output-path-warning] sf-finding')).toHaveLength(1);
        expect(q('sf-field[data-sf-output-path-warning]')?.getAttribute('data-sf-output-path-warning')).toBe('html');

        const input = fieldInput('Output path — html');
        input.value = 'index.html ';
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        expect(messages()).toHaveLength(1);
        input.value = '{locale}/index.html';
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        // Typing {locale} clears it, and the server's warning about the saved path is stale by then.
        expect(messages()).toEqual([]);
      });

      it('shows the server warning alone when the project has one language', () => {
        languages(1);
        open({ ...ARTICLE, warnings: [SERVER] });
        expect(messages()).toEqual([expect.stringContaining('The server: index.html has no {locale}.')]);
      });

      it('says nothing for a path with {locale} or a project without a language problem', () => {
        languages(2);
        open({ ...ARTICLE, outputPath: { html: '{locale}/index.html', rss: '{locale}/feed.xml' } });
        expect(messages()).toEqual([]);
      });
    });

    it('removes a channel with ✕, says so, and brings it back with Undo', () => {
      open();
      qa<HTMLButtonElement>('button[data-sf-channel-remove], [data-sf-channel-remove] button')
        .find((b) => b.getAttribute('aria-label') === 'Remove the rss channel')!
        .click();
      fixture.detectChanges();
      expect(store.removedChannels()).toEqual(['rss']);
      expect(save.dirty()).toBe(true);
      const removed = qa('.settings__removed').at(0)!;
      expect(removed.textContent).toContain('Removed when you save:');
      Array.from(removed.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Undo')!.click();
      fixture.detectChanges();
      expect(store.removedChannels()).toEqual([]);
      expect(store.channelKeys()).toEqual(['html', 'rss']);
    });

    it('adds a channel from the menu of the project’s channels the template has no source for', () => {
      open();
      qa('button').find((b) => b.textContent?.includes('Add channel'))!.click();
      fixture.detectChanges();
      const items = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      expect(items).toHaveLength(1);
      expect(items[0].textContent).toContain('JSON feed');
      items[0].click();
      fixture.detectChanges();
      expect(store.channelKeys()).toEqual(['html', 'rss', 'json']);
    });

    it('opens by itself for a pagination path without {pageNumber} and shows the rule under the field', () => {
      open({ ...ARTICLE, contentCdl: 'editor pagination pager { }' });
      store.paginationPaths.set({ html: 'blog-2.html' });
      fixture.detectChanges();
      expect(q('[data-sf-settings-toggle] button')?.getAttribute('aria-expanded')).toBe('true');
      expect(root().textContent).toContain('Must contain {pageNumber}');
      expect(save.dirty()).toBe(true);
    });

    it('shows Deprecated, not Abstract, for a section template', () => {
      (store.templates as { set: (v: unknown) => void }).set([{ uuid: 't-1', assetType: 'SECTION_TEMPLATE' }]);
      open({ ...ARTICLE, assetType: 'SECTION_TEMPLATE', bodiesCdl: '' });
      const switches = qa('button[role="switch"]').map((b) => b.textContent?.trim());
      expect(switches).toEqual(['Deprecated template']);
      expect(root().textContent).not.toContain('Output path —');
    });
  });

  describe('layout', () => {
    it('puts the CDL and the channels side by side in a splitter from 1280 px', () => {
      open();
      expect(q('.ide__split')).not.toBeNull();
      expect(q('.ide__stack-tabs')).toBeNull();
      expect(q('sf-template-cdl-panel')).not.toBeNull();
      expect(q('sf-template-channel-panel')).not.toBeNull();
    });

    it('stacks them as tabs CDL | Channels below 1280 px, and follows the screen width live', () => {
      open();
      media.change(false);
      fixture.detectChanges();
      expect(q('.ide__split')).toBeNull();
      const tabs = qa('.ide__stack-tabs [role="tab"]');
      expect(tabs.map((t) => t.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['CDL', 'Channels']);
      expect(q('sf-template-cdl-panel')).not.toBeNull();
      expect(q('sf-template-channel-panel')).toBeNull();
      tabs[1].click();
      fixture.detectChanges();
      expect(q('sf-template-channel-panel')).not.toBeNull();
      expect(q('sf-template-cdl-panel')).toBeNull();

      media.change(true);
      fixture.detectChanges();
      expect(q('.ide__split')).not.toBeNull();
    });

    it('counts the errors on each tab', () => {
      open();
      media.change(false);
      store.cdlDiagnostics.set([{ severity: 'ERROR', code: 'SF-CDL-0113', message: 'x', line: 1, column: 1, field: 'content' }]);
      store.octlDiagnostics.set({
        html: [{ severity: 'ERROR', code: 'SF-TPL-0103', message: 'y' }, { severity: 'ERROR', code: 'SF-TPL-0104', message: 'z' }],
      });
      fixture.detectChanges();
      const tabs = qa('.ide__stack-tabs [role="tab"]').map((t) => t.textContent?.replace(/\s+/g, ' ').trim());
      expect(tabs[0]).toContain('1');
      expect(tabs[1]).toContain('2');
    });

    it('keeps the inherited groups, the section tabs and the channel tabs', () => {
      open({ ...ARTICLE, inheritedFrom: { editors: { subtitle: 'docs_layout' }, bodies: { aside: 'base' } } });
      expect(qa('[role="tab"]').map((t) => t.textContent?.replace(/\s+/g, ' ').trim().replace(/\s*\d+$/, ''))).toEqual(
        expect.arrayContaining(['Content', 'Bodies', 'Rules', 'html', 'rss']),
      );
      expect(q('.inheritance__inherited')?.textContent).toContain('subtitle');
      expect(qa('sf-code-panel')).toHaveLength(3 + 2);
    });
  });

  describe('banners and states', () => {
    it('says a refused save once, with the number of errors', () => {
      open();
      editing.onSectionInput({ section: 'rules', value: 'rule x' });
      save.saveTemplate();
      http.expectOne((r) => r.method === 'PUT').flush(
        { code: 'SF-API-0422', diagnostics: [{ severity: 'ERROR', code: 'SF-CDL-0113', message: 'name', line: 1, column: 6, field: 'rules' }] },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      fixture.detectChanges();
      const banner = q('[data-sf-save-refused]')!;
      expect(banner.textContent).toContain('Not saved');
      expect(banner.textContent).toContain('1 compile error');
      expect(qa('[data-sf-save-refused]')).toHaveLength(1);
    });

    it('lists the templates a rejected save would break, instead of the generic refusal', () => {
      open();
      store.descendantProblems.set([{ uuid: 'c-1', uid: 'child', channel: 'html', diagnostics: [{ severity: 'ERROR', code: 'SF-TPL-0158', message: 'x' } as never] }]);
      fixture.detectChanges();
      expect(q('[data-sf-descendant-problems]')?.textContent).toContain('child');
      expect(q('[data-sf-descendant-problems]')?.textContent).toContain('SF-TPL-0158');
      expect(q('[data-sf-save-refused]')).toBeNull();
    });

    it('tells when other templates extend this one, with Used by', () => {
      open();
      store.childTemplates.set([{ uuid: 'c-1', uid: 'child' }, { uuid: 'c-2', uid: 'other' }]);
      fixture.detectChanges();
      const info = q('[data-sf-descendants-info]')!;
      expect(info.textContent).toContain('2 templates extend this one. They are checked again when you save.');
      const usedBy = vi.spyOn(store.usedByUuid, 'set');
      Array.from(info.querySelectorAll('button')).find((b) => b.textContent?.includes('Used by'))!.click();
      expect(usedBy).toHaveBeenCalledWith('t-1');
    });

    it('asks before a save that discards translations: Keep stays, Discard sends it again', async () => {
      open();
      editing.onSectionInput({ section: 'content', value: 'editor text title { }' });
      save.saveTemplate();
      http.expectOne((r) => r.method === 'PUT').flush({ detail: 'Drops 12 translations.', discardedLocaleValues: 12 }, { status: 409, statusText: 'Conflict' });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.textContent).toContain('This change discards translations');
      expect(dialog.textContent).toContain('Drops 12 translations.');
      const press = (name: string) => Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.trim() === name)!.click();
      press('Discard and save');
      await fixture.whenStable();
      const again = http.expectOne((r) => r.method === 'PUT');
      expect(again.request.url).toContain('confirmDiscard=true');
      again.flush({ ...ARTICLE, contentCdl: 'editor text title { }', revision: 5 });
    });

    it('keeps the translations when the question is declined', async () => {
      open();
      editing.onSectionInput({ section: 'content', value: 'editor text title { }' });
      save.saveTemplate();
      http.expectOne((r) => r.method === 'PUT').flush({ detail: 'Drops 12 translations.', discardedLocaleValues: 12 }, { status: 409, statusText: 'Conflict' });
      fixture.detectChanges();
      await fixture.whenStable();
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
      Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Keep the translations')!.click();
      await fixture.whenStable();
      expect(save.pendingDiscard()).toBeNull();
      http.expectNone((r) => r.method === 'PUT');
      expect(save.dirty()).toBe(true);
    });

    it('shows a skeleton while the template loads', () => {
      store.selectedUuid.set('t-1');
      fixture.detectChanges();
      expect(q('sf-skeleton')).not.toBeNull();
      http.match((r) => /-templates\/t-1$/.test(r.url)).forEach((r) => r.flush(ARTICLE));
    });

    it('offers Retry when the template could not be loaded', () => {
      store.selectedUuid.set('t-1');
      fixture.detectChanges();
      http.match((r) => /-templates\/t-1$/.test(r.url)).forEach((r) => r.flush('x', { status: 500, statusText: 'Server Error' }));
      fixture.detectChanges();
      expect(root().textContent).toContain('The template could not be loaded');
      qa('button').find((b) => b.textContent?.includes('Retry'))!.click();
      http.match((r) => /-templates\/t-1$/.test(r.url)).forEach((r) => r.flush(ARTICLE));
      http.match((r) => r.url.endsWith('/usages')).forEach((r) => r.flush([]));
      fixture.detectChanges();
      expect(q('.tpl-head h1')?.textContent?.trim()).toBe('Article');
      expect(root().textContent).not.toContain('The template could not be loaded');
    });

    it('says No template selected when nothing is open', () => {
      fixture.detectChanges();
      expect(root().textContent).toContain('No template selected');
    });
  });
});

