import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { injectSampleDevMode, injectSampleNotice, injectSampleText } from '../changes/sample-area.util';

/** One registered URL of an item: where a build or the preview writes it (channel, language) and the URL itself. */
export interface SampleAssetUrl {
  /** The area the URL belongs to: the build's output or the preview. */
  readonly area: 'build' | 'preview';
  /** Channel and language, in words ("html · Deutsch"). */
  readonly where: string;
  readonly url: string;
  /** A developer set it by hand. */
  readonly manual?: boolean;
}

/**
 * The URLs of a folder or a media file (M35.18 / M35.19, gate round 12; the app's shared `sf-asset-urls`): the registered
 * URLs per area, channel and language, with *Override* (developers only: a URL decides where a build writes the output) and
 * *Set URL*. When the registry cannot be read the panel says so quietly and offers **Retry** instead of raising an error
 * toast. Nothing is saved.
 */
@Component({
  selector: 'sf-sample-asset-urls',
  standalone: true,
  imports: [SfBadgeComponent, SfButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-asset-urls.component.scss',
  template: `
    <div class="urls">
      <h3 class="urls__title">{{ t('urls.title') }}</h3>
      @if (failed()) {
        <p class="urls__unavailable" role="status">
          {{ t('urls.unavailable') }}
          <sf-button variant="ghost" size="sm" (click)="retry.emit()">{{ t('urls.retry') }}</sf-button>
        </p>
      } @else if (urls().length === 0) {
        <p class="urls__muted">{{ t('urls.none') }}</p>
      } @else {
        <ul class="urls__list">
          @for (entry of urls(); track entry.url + entry.where) {
            <li class="urls__row">
              <span class="urls__where">{{ t('urls.' + entry.area) }} · {{ entry.where }}</span>
              <code class="urls__url">{{ entry.url }}</code>
              @if (entry.manual) {
                <sf-badge tone="neutral" [label]="t('urls.manual')" />
              }
              @if (dev()) {
                <sf-button variant="ghost" size="sm" (click)="notice(t('urls.notice'))">{{ t('urls.override') }}</sf-button>
              }
            </li>
          }
        </ul>
        @if (dev()) {
          <sf-button class="urls__set" variant="ghost" size="sm" (click)="notice(t('urls.notice'))">{{ t('urls.setUrl') }}</sf-button>
        }
      }
    </div>
  `,
})
export class SampleAssetUrlsComponent {
  protected readonly dev = injectSampleDevMode();
  protected readonly notice = injectSampleNotice();
  protected readonly t = injectSampleText('styleguide.sample.pages');

  readonly urls = input<readonly SampleAssetUrl[]>([]);
  /** The registry could not be read. */
  readonly failed = input(false);
  readonly retry = output<void>();
}
