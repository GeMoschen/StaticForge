import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../../core/api/api.client';
import type { components } from '../../../../core/api/generated/schema.d.ts';
import { FrameContextStore } from '../../../../core/frame/frame-context.store';
import { ProjectContextStore } from '../../../../core/project/project-context.store';
import { provideProjectPermissions } from '../../../../core/project/testing/project-permissions.testing';
import { ChannelsService } from '../../../channels/channels.service';
import { BuildNowService } from '../../../generation/build-now.service';
import { GenerationService } from '../../../generation/generation.service';
import { BuildDialogComponent } from './build-dialog.component';

type GenerationTargetView = components['schemas']['GenerationTargetView'];
type GenerationPlanView = components['schemas']['GenerationPlanView'];

const TARGETS: GenerationTargetView[] = [
  { id: 8, name: 'Staging', type: 'FILESYSTEM', isDefault: false, outputPath: 'proj/staging' },
  { id: 7, name: 'Live', type: 'FILESYSTEM', isDefault: true, outputPath: 'proj/live' },
];

const PLAN: GenerationPlanView = {
  target: { id: 7, name: 'Live' },
  summary: {
    revision: 12,
    entryCount: 5,
    pageCount: 3,
    processedMediaCount: 2,
    byRootKind: { ASSET_CHANGED: 3 },
    via: [{ assetType: 'SECTION_TEMPLATE', uid: 'teaser', count: 2 }],
    redirectsAdded: 1,
  },
  changedAssets: [
    { uuid: 'a1', type: 'PAGE', uid: 'about', revision: 11 },
    { uuid: 'a2', type: 'MEDIA', uid: 'old', deleted: true, revision: 12 },
  ],
  redirectCandidates: [{ channel: 'html', locale: 'en', fromPath: '/old', toPath: '/new' }],
  diagnostics: { errors: [], warnings: [] } as unknown as GenerationPlanView['diagnostics'],
};

const FOLDERS = [
  {
    uuid: 'root',
    path: '/',
    children: [
      { uuid: 'f-news', uid: 'news', displayName: 'News', path: '/news/', children: [] },
      { uuid: 'f-shop', uid: 'shop', displayName: 'Shop', path: '/shop/', children: [] },
    ],
  },
];

interface Setup {
  targets?: GenerationTargetView[];
  permissions?: string[];
  plan?: GenerationPlanView;
}

async function setup({ targets = TARGETS, permissions = ['INCREMENTAL_BUILD', 'FULL_BUILD'], plan = PLAN }: Setup = {}) {
  const api = {
    listTargets: vi.fn().mockReturnValue(of(targets)),
    planGeneration: vi.fn().mockReturnValue(of(plan)),
    start: vi.fn().mockReturnValue(of({ id: 42, status: 'QUEUED' })),
  };
  const channels = {
    list: vi.fn().mockReturnValue(
      of([
        { key: 'html', enabled: true },
        { key: 'rss', enabled: true },
        { key: 'md', enabled: false },
      ]),
    ),
  };
  const pages = { listPages: vi.fn().mockReturnValue(of([{ uuid: 'p1', displayName: 'About us', folderPath: '/about/' }])) };
  const started = { next: vi.fn() };
  const closed = vi.fn();
  const startedOut = vi.fn();
  const view = await render(BuildDialogComponent, {
    on: { closed, started: startedOut },
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: GenerationService, useValue: api },
      { provide: ChannelsService, useValue: channels },
      { provide: ApiClient, useValue: pages },
      { provide: BuildNowService, useValue: { started } },
      { provide: FrameContextStore, useValue: { projectKey: computed(() => 'proj') } },
      { provide: ProjectContextStore, useValue: { pageFolderTree: signal(FOLDERS) } },
      provideProjectPermissions({ role: () => 'EDITOR', permissions: () => permissions, readOnly: () => false }),
    ],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return { ...view, api, closed, startedOut, started, navigate };
}

const startButton = () => screen.getByRole('button', { name: 'Start build' });

async function previewPlan(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Preview plan/ }));
  await screen.findByText(/Computed at revision/);
}

/** Picks an option of the open scope list the way a browser does. */
function pick(name: RegExp): void {
  const option = screen.getByRole('option', { name });
  option.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
  option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  option.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  option.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('BuildDialogComponent', () => {
  it('offers the enabled channels, all on, and keeps the last one on', async () => {
    await setup();
    const html = await screen.findByRole('checkbox', { name: 'html' });
    const rss = screen.getByRole('checkbox', { name: 'rss' });
    expect(screen.queryByRole('checkbox', { name: 'md' })).toBeNull();
    expect(html).toBeChecked();

    fireEvent.click(html);
    await waitFor(() => expect(html).not.toBeChecked());
    expect(rss).toBeChecked();
    expect(rss).toBeDisabled();
  });

  it('preselects the default target and starts a full or incremental build of it', async () => {
    const { api, closed, startedOut, started, navigate } = await setup();
    const target = (await screen.findByLabelText('Target')) as HTMLSelectElement;
    await waitFor(() => expect(target.selectedOptions[0].textContent).toContain('Live (default)'));

    fireEvent.click(screen.getByRole('radio', { name: /Full build/ }));
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());

    await waitFor(() => expect(api.start).toHaveBeenCalled());
    expect(api.start).toHaveBeenCalledWith('proj', { mode: 'FULL', targetId: 7, channels: ['html', 'rss'] }, true);
    expect(started.next).toHaveBeenCalledWith({ id: 42, status: 'QUEUED' });
    expect(startedOut).toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/p', 'proj', 'publishing', 'runs'], { queryParams: { run: 42 } });
  });

  it('sends the comment, one folder and the picked pages', async () => {
    const { api, fixture } = await setup();
    const scope = (await screen.findByLabelText('Pages')) as HTMLInputElement;
    fireEvent.keyDown(scope, { key: 'ArrowDown' });
    pick(/News/);
    fixture.detectChanges();
    pick(/Shop/); // a second folder replaces the first
    fixture.detectChanges();
    pick(/About us/);
    fixture.detectChanges();
    fireEvent.input(screen.getByLabelText(/Comment/), { target: { value: ' Before launch ' } });

    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());

    await waitFor(() => expect(api.start).toHaveBeenCalled());
    expect(api.start.mock.calls[0][1]).toEqual({
      mode: 'INCREMENTAL',
      targetId: 7,
      comment: 'Before launch',
      channels: ['html', 'rss'],
      folderPath: '/shop/',
      assetUuids: ['p1'],
    });
  });

  it('computes the plan only on request and shows counts, kinds, groups and the changes behind it', async () => {
    const { api } = await setup();
    await screen.findByRole('checkbox', { name: 'html' });
    expect(screen.getByText(/The plan is not computed automatically/)).toBeInTheDocument();
    expect(api.planGeneration).not.toHaveBeenCalled();

    await previewPlan();

    expect(api.planGeneration.mock.calls[0][3]).toBe(false);
    expect(screen.getByText('Computed at revision 12')).toBeInTheDocument();
    expect(screen.getByText('Changed')).toBeInTheDocument();
    expect(screen.getByText('section_template:teaser')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Show changed assets \(2\)/ }));
    expect(await screen.findByText('page:about')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Show automatic redirects \(1\)/ }));
    expect(await screen.findByText('/old → /new')).toBeInTheDocument();
    expect(screen.queryByText('Template diagnostics')).toBeNull();
  });

  it('previews with Alt+P and marks the plan stale after a form change', async () => {
    const { api } = await setup();
    await screen.findByRole('checkbox', { name: 'html' });

    screen.getByLabelText(/Comment/).dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', altKey: true, bubbles: true, cancelable: true }));
    await screen.findByText(/Computed at revision/);
    expect(api.planGeneration).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/The form changed since this preview/)).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: 'rss' }));
    expect(await screen.findByText(/The form changed since this preview/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Refresh preview/ }));
    await waitFor(() => expect(screen.queryByText(/The form changed since this preview/)).toBeNull());
  });

  it('warns when an incremental plan falls back to a full build', async () => {
    await setup({ plan: { ...PLAN, summary: { ...PLAN.summary, fallbackCause: 'NO_COMPLETE_BUILD_FOR_TARGET' } } });
    await screen.findByRole('checkbox', { name: 'html' });
    await previewPlan();
    expect(screen.getByText(/this will be a full build/)).toBeInTheDocument();
  });

  it('says there is nothing to rebuild and still lets the run start', async () => {
    await setup({ plan: { ...PLAN, summary: { ...PLAN.summary, entryCount: 0, pageCount: 0 }, changedAssets: [] } });
    await screen.findByRole('checkbox', { name: 'html' });
    await previewPlan();
    expect(screen.getByText('Nothing to rebuild. You can still start the run.')).toBeInTheDocument();
    expect(startButton()).toBeEnabled();
  });

  it('lists the template diagnostics with their codes, or says the templates are clean', async () => {
    const problems = {
      ...PLAN,
      diagnostics: {
        errors: [{ code: 'SF-TPL-0001', count: 1, messages: ['Unknown field title'] }],
        warnings: [],
      } as unknown as GenerationPlanView['diagnostics'],
    };
    const { api } = await setup({ plan: problems });
    await screen.findByRole('checkbox', { name: 'html' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Validate templates' }));
    await previewPlan();
    expect(api.planGeneration.mock.calls[0][3]).toBe(true);
    expect(screen.getByText('SF-TPL-0001')).toBeInTheDocument();
    expect(screen.getByText('Unknown field title')).toBeInTheDocument();
  });

  it('says the templates validate cleanly', async () => {
    await setup();
    await screen.findByRole('checkbox', { name: 'html' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Validate templates' }));
    await previewPlan();
    expect(screen.getByText('Templates validate cleanly.')).toBeInTheDocument();
  });

  it('fixes mode and target for a caller without full builds', async () => {
    const { api } = await setup({ permissions: ['INCREMENTAL_BUILD'] });
    await screen.findByRole('checkbox', { name: 'html' });
    expect(screen.queryByRole('radio', { name: /Full build/ })).toBeNull();
    expect(screen.queryByLabelText('Target')).toBeNull();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText(/You can start incremental builds of the default target/)).toBeInTheDocument();

    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());
    await waitFor(() => expect(api.start).toHaveBeenCalled());
    expect(api.start.mock.calls[0][1]).toMatchObject({ mode: 'INCREMENTAL', targetId: 7 });
  });

  it('disables Start without a target and links to Targets', async () => {
    const { closed } = await setup({ targets: [] });
    expect(await screen.findByText('This project has no target yet.')).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
    const link = screen.getByRole('link', { name: /Create one in Targets/ });
    expect(link).toHaveAttribute('href', '/p/proj/publishing/targets');
    fireEvent.click(link);
    expect(closed).toHaveBeenCalled();
  });

  it('shows a refused start inline: a build is already running', async () => {
    const { api, closed } = await setup();
    api.start.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'SF-GEN-0500', detail: 'Busy.' } })),
    );
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('A build is already running.');
    expect(closed).not.toHaveBeenCalled();
    expect(startButton()).toBeEnabled();
  });

  it('shows any other refusal with the server’s detail', async () => {
    const { api } = await setup();
    api.start.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, error: { detail: 'Not allowed.' } })));
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed.');
  });
});
