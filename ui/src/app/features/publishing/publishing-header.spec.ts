import '@angular/compiler';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { BuildStatusStore } from '../frame/build-status.store';
import { GenerationService } from '../generation/generation.service';
import { BuildDialogService } from './runs/build-dialog/build-dialog.service';
import { PublishingBuildActionComponent } from './publishing-build-action.component';
import { PublishingStatusComponent } from './publishing-status.component';

async function setupAction({ permissions = ['INCREMENTAL_BUILD'], targets = [{ id: 1 }] as unknown[], readOnly = false } = {}) {
  const view = await render(PublishingBuildActionComponent, {
    providers: [
      provideRouter([]),
      { provide: GenerationService, useValue: { listTargets: vi.fn().mockReturnValue(of(targets)) } },
      { provide: FrameContextStore, useValue: { projectKey: computed(() => 'proj') } },
      { provide: ProjectAccessStore, useValue: { readOnly: signal(readOnly) } },
      provideProjectPermissions({ role: () => 'EDITOR', permissions: () => permissions, readOnly: () => readOnly }),
    ],
  });
  return { ...view, dialog: TestBed.inject(BuildDialogService) };
}

describe('PublishingBuildActionComponent', () => {
  it('opens the Build now dialog', async () => {
    const { dialog } = await setupAction();
    const button = screen.getByRole('button', { name: 'Build now' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(dialog.isOpen()).toBe(true);
  });

  it('disables Build now without a target, says why and links to Targets', async () => {
    await setupAction({ targets: [] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build now' })).toHaveAttribute('aria-disabled', 'true'));
    expect(screen.getByRole('link', { name: 'Go to Targets' })).toHaveAttribute('href', '/p/proj/publishing/targets');
  });

  it('hides the button from whoever may not build and says who does', async () => {
    await setupAction({ permissions: ['RELEASE'] });
    expect(screen.queryByRole('button', { name: 'Build now' })).toBeNull();
    expect(screen.getByText('Builds are started by developers in this project.')).toBeInTheDocument();
  });

  it('shows nothing in a read-only project', async () => {
    await setupAction({ permissions: [], readOnly: true });
    expect(screen.queryByRole('button', { name: 'Build now' })).toBeNull();
    expect(screen.queryByText(/Builds are started by developers/)).toBeNull();
  });
});

describe('PublishingStatusComponent', () => {
  async function setupStatus(runs: object[]) {
    return render(PublishingStatusComponent, { providers: [{ provide: BuildStatusStore, useValue: { runs: signal(runs) } }] });
  }

  it('shows the running build and the last finished one', async () => {
    await setupStatus([{ id: 48, status: 'RUNNING' }, { id: 47, status: 'PARTIAL' }, { id: 46, status: 'SUCCESS' }]);
    expect(screen.getByText('Run #48')).toBeInTheDocument();
    expect(screen.getByText(': Running')).toBeInTheDocument();
    expect(screen.getByText('Last build #47')).toBeInTheDocument();
    expect(screen.getByText(': Partial')).toBeInTheDocument();
  });

  it('shows only the last build when none is running', async () => {
    await setupStatus([{ id: 5, status: 'FAILED' }]);
    expect(screen.queryByText(/^Run #/)).toBeNull();
    expect(screen.getByText('Last build #5')).toBeInTheDocument();
  });

  it('shows nothing before the first build', async () => {
    const { container } = await setupStatus([]);
    expect(container.querySelector('sf-status')).toBeNull();
  });
});
