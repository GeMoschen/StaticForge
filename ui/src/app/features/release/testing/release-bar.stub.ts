import { Component, Type, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReleaseBarComponent } from '../release-bar.component';
import type { ReleaseMode } from '../release-choice.util';

/**
 * A stand-in for `sf-release-bar` in specs of the editors that host it (M27.6.1): the bar loads its own state and
 * has its own spec, so an editor's spec shouldn't have to answer its requests.
 */
@Component({ selector: 'sf-release-bar', standalone: true, template: '' })
export class ReleaseBarStubComponent {
  readonly projectKey = input<string>('');
  readonly assetUuid = input<string | null | undefined>(null);
  readonly refreshKey = input<unknown>(null);
  readonly changed = output<ReleaseMode>();
}

/** Swaps the real release bar of `host` for {@link ReleaseBarStubComponent}; call before rendering. */
export function stubReleaseBar(host: Type<unknown>): void {
  TestBed.overrideComponent(host, {
    remove: { imports: [ReleaseBarComponent] },
    add: { imports: [ReleaseBarStubComponent] },
  });
}
