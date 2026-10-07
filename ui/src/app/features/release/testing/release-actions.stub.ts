import { Component, Type, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReleaseActionsComponent } from '../release-actions.component';
import type { ReleaseMode } from '../release-choice.util';

/**
 * A stand-in for `sf-release-actions` in specs of the editors that host it (M35.23): the component loads its own state
 * and has its own spec, so an editor's spec shouldn't have to answer its requests.
 */
@Component({ selector: 'sf-release-actions', standalone: true, template: '' })
export class ReleaseActionsStubComponent {
  readonly projectKey = input<string>('');
  readonly assetUuid = input<string | null | undefined>(null);
  readonly refreshKey = input<unknown>(null);
  readonly changed = output<ReleaseMode>();
}

/** Swaps the real release actions of `host` for {@link ReleaseActionsStubComponent}; call before rendering. */
export function stubReleaseActions(host: Type<unknown>): void {
  TestBed.overrideComponent(host, {
    remove: { imports: [ReleaseActionsComponent] },
    add: { imports: [ReleaseActionsStubComponent] },
  });
}
