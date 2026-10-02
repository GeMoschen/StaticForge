import '@angular/compiler';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Route, Router, provideRouter, withComponentInputBinding, withRouterConfig } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from './app.routes';
import { DeveloperModeService } from './core/frame/developer-mode.service';

@Component({ standalone: true, template: '' })
class BlankComponent {}

/**
 * The real route table with its screens swapped for blank ones and its login, role and resolver gates dropped (they
 * need a session and the API); the paths, redirects and the developer-mode guard stay as they are.
 */
function withoutScreens(table: readonly Route[]): Route[] {
  return table.map(({ component, resolve, canMatch, loadChildren, children, ...route }) => {
    void component;
    void resolve;
    void canMatch;
    void loadChildren;
    return {
      ...route,
      ...(route.redirectTo === undefined ? { component: BlankComponent } : {}),
      ...(children ? { children: withoutScreens(children) } : {}),
    };
  });
}

describe('project routes (M35.11)', () => {
  let harness: RouterTestingHarness;
  let developerMode: boolean;
  let asked: (string | null)[];

  beforeEach(async () => {
    developerMode = true;
    asked = [];
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          withoutScreens(routes.filter((route) => route.path !== 'styleguide')),
          withComponentInputBinding(),
          withRouterConfig({ paramsInheritanceStrategy: 'always' }),
        ),
        { provide: DeveloperModeService, useValue: {
            enabledIn: (key: string | null) => {
              asked.push(key);
              return developerMode;
            },
          },
        },
      ],
    });
    harness = await RouterTestingHarness.create();
  });

  const urlAfter = async (url: string) => {
    await harness.navigateByUrl(url);
    return TestBed.inject(Router).url;
  };

  describe('old Settings URLs', () => {
    it.each([
      ['/p/acme/settings/generation', '/p/acme/publishing/runs'],
      ['/p/acme/settings/targets', '/p/acme/publishing/targets'],
      ['/p/acme/settings/quality', '/p/acme/publishing/quality'],
      ['/p/acme/settings/redirects', '/p/acme/publishing/redirects'],
      ['/p/acme/settings/url-registry', '/p/acme/publishing/urls'],
      ['/p/acme/settings/revisions', '/p/acme/history'],
      ['/p/acme/settings/revisions/42', '/p/acme/history/42'],
      ['/p/acme/settings/locales', '/p/acme/settings/languages'],
    ])('%s redirects to %s', async (old, current) => {
      expect(await urlAfter(old)).toBe(current);
    });

    it('keeps the query of a run link (a toast after "Build now", the Schedules history)', async () => {
      expect(await urlAfter('/p/acme/settings/generation?run=7&tab=findings')).toBe('/p/acme/publishing/runs?run=7&tab=findings');
    });
  });

  describe('area roots', () => {
    it.each([
      ['/p/acme/publishing', '/p/acme/publishing/runs'],
      ['/p/acme/settings', '/p/acme/settings/general'],
      ['/p/acme', '/p/acme/pages'],
    ])('%s opens %s', async (root, first) => {
      expect(await urlAfter(root)).toBe(first);
    });
  });

  describe('new pages', () => {
    it.each([
      '/p/acme/publishing/runs',
      '/p/acme/publishing/targets',
      '/p/acme/publishing/policy',
      '/p/acme/publishing/quality',
      '/p/acme/publishing/redirects',
      '/p/acme/publishing/urls',
      '/p/acme/history',
      '/p/acme/history/42',
      '/p/acme/settings/general',
      '/p/acme/settings/languages',
      '/p/acme/settings/channels',
      '/p/acme/settings/media',
      '/p/acme/settings/code-highlighting',
      '/p/acme/settings/compaction',
      '/p/acme/settings/import-export',
      '/p/acme/settings/members',
    ])('%s opens as it is', async (url) => {
      expect(await urlAfter(url)).toBe(url);
    });
  });

  describe('developer-mode pages', () => {
    it('opens Channels in developer mode', async () => {
      expect(await urlAfter('/p/acme/settings/channels')).toBe('/p/acme/settings/channels');
    });

    it('sends the editor view from a Channels link to General', async () => {
      developerMode = false;
      expect(await urlAfter('/p/acme/settings/channels')).toBe('/p/acme/settings/general');
    });

    it('asks about the project of the URL', async () => {
      await urlAfter('/p/other/settings/channels');
      expect(asked).toEqual(['other']);
    });
  });
});
