import { Injectable, signal } from '@angular/core';
import { injectSampleDevMode, injectSampleNotice, injectSampleText } from '../changes/sample-area.util';

/** The Publishing area's sections (the side nav; query parameter `psec`). */
export type PublishingSection = 'runs' | 'targets' | 'policy' | 'quality' | 'redirects' | 'urls';
export const PUBLISHING_SECTIONS: readonly PublishingSection[] = ['runs', 'targets', 'policy', 'quality', 'redirects', 'urls'];

/**
 * State of the sample's Publishing area, provided by {@link SamplePublishingAreaComponent} and shared by its sections:
 * the open section, run and dialog (mirrored in the query parameters by the area), developer mode and the texts.
 */
@Injectable()
export class PublishingState {
  readonly section = signal<PublishingSection>('runs');
  /** The open run's id (run detail), or null for the run list. */
  readonly runId = signal<string | null>(null);
  readonly buildOpen = signal(false);

  readonly devMode = injectSampleDevMode();
  /** A `styleguide.sample.publishing.*` text. */
  readonly t = injectSampleText('styleguide.sample.publishing');
  private readonly toast = injectSampleNotice();

  /** Every action that would change something says so instead. */
  notice(key = 'notice', params?: Record<string, unknown>): void {
    this.toast(this.t(key, params));
  }

  openRun(id: string | null): void {
    this.section.set('runs');
    this.runId.set(id);
  }
}
