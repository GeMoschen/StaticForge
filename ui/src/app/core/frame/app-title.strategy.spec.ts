import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TitleStrategy, provideRouter, withRouterConfig } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProjectContextStore } from '../project/project-context.store';
import { AppTitleStrategy, DocumentTitleService } from './app-title.strategy';
import { FrameContextStore } from './frame-context.store';
import { routeTitle } from './route-title';

@Component({ standalone: true, template: '' })
class BlankComponent {}

describe('document title', () => {
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TitleStrategy, useExisting: AppTitleStrategy },
        provideRouter(
          [
            { path: 'login', component: BlankComponent, title: routeTitle('frame.title.login') },
            { path: '', pathMatch: 'full', component: BlankComponent, title: routeTitle('frame.section.dashboard') },
            {
              path: 'p/:projectKey',
              component: BlankComponent,
              children: [
                {
                  path: 'pages',
                  title: routeTitle('frame.section.pages'),
                  component: BlankComponent,
                  children: [{ path: ':uuid', component: BlankComponent }],
                },
                {
                  path: 'publishing',
                  title: routeTitle('frame.section.publishing'),
                  component: BlankComponent,
                  children: [{ path: 'runs', title: routeTitle('frame.sub.publishing.runs'), component: BlankComponent }],
                },
              ],
            },
          ],
          withRouterConfig({ paramsInheritanceStrategy: 'always' }),
        ),
      ],
    });
    TestBed.inject(DocumentTitleService);
    harness = await RouterTestingHarness.create();
  });

  const flush = () => {
    TestBed.flushEffects();
    return document.title;
  };

  it('is the route title alone outside a project, and the product name where a route has none', async () => {
    await harness.navigateByUrl('/login');
    expect(flush()).toBe('Sign in — StaticForge');
    await harness.navigateByUrl('/');
    expect(flush()).toBe('Projects — StaticForge');
  });

  it('adds the project name to the area', async () => {
    TestBed.inject(ProjectContextStore).project.set({ key: 'acme', name: 'Acme Website' });
    await harness.navigateByUrl('/p/acme/pages');
    expect(flush()).toBe('Pages · Acme Website — StaticForge');
  });

  it('puts the sub-page before its area, and counts an inherited title once', async () => {
    TestBed.inject(ProjectContextStore).project.set({ key: 'acme', name: 'Acme Website' });
    await harness.navigateByUrl('/p/acme/publishing/runs');
    expect(flush()).toBe('Runs · Publishing · Acme Website — StaticForge');
    await harness.navigateByUrl('/p/acme/pages/p1');
    expect(flush()).toBe('Pages · Acme Website — StaticForge');
  });

  it('puts the open item first, and drops it when the user moves to another area', async () => {
    TestBed.inject(ProjectContextStore).project.set({ key: 'acme', name: 'Acme Website' });
    await harness.navigateByUrl('/p/acme/pages/p1');
    TestBed.inject(FrameContextStore).setItem({ label: 'Our story' });
    expect(flush()).toBe('Our story · Pages · Acme Website — StaticForge');

    await harness.navigateByUrl('/p/acme/publishing/runs');
    expect(flush()).toBe('Runs · Publishing · Acme Website — StaticForge');
  });

  it('falls back to the project key until the project has loaded', async () => {
    await harness.navigateByUrl('/p/acme/pages');
    expect(flush()).toBe('Pages · acme — StaticForge');
  });
});
