import { render, screen, fireEvent, waitFor } from '@testing-library/angular';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { TimeTravelStore } from '../../revisions/time-travel.store';
import { GenerationService } from '../generation.service';
import { SfAssetImpactComponent } from './sf-asset-impact.component';

async function setup(inputs: Record<string, unknown> = {}, activeRevision: number | null = null) {
  const assetImpact = vi.fn().mockReturnValue(of({ entries: { items: [], total: 0 }, byFirstEdge: {} }));
  const view = await render(SfAssetImpactComponent, {
    componentInputs: { projectKey: 'proj', assetUuid: 'media-1', ...inputs },
    providers: [
      { provide: GenerationService, useValue: { assetImpact } },
      { provide: TimeTravelStore, useValue: { activeRevision: signal(activeRevision) } },
    ],
  });
  return { ...view, assetImpact };
}

describe('SfAssetImpactComponent', () => {
  it('is collapsed with a translated heading, and asks the server only when opened', async () => {
    const { assetImpact } = await setup();

    const toggle = screen.getByRole('button', { name: /Impact/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('as of now')).toBeInTheDocument();
    expect(assetImpact).not.toHaveBeenCalled();

    fireEvent.click(toggle);

    await waitFor(() => expect(assetImpact).toHaveBeenCalled());
    expect(await screen.findByText('Nothing would rebuild.')).toBeInTheDocument();
  });

  it("takes the host's heading and says which state the numbers reflect in time travel", async () => {
    await setup({ heading: 'Pages affected by this change' }, 12);

    expect(screen.getByRole('button', { name: /Pages affected by this change/ })).toBeInTheDocument();
    expect(screen.getByText('reflects the current state, not revision 12')).toBeInTheDocument();
  });
});
