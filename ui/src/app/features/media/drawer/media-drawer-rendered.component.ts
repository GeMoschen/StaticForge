import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { CODE_FORMAT_LABELS } from '../../../shared/code-editor/code-format';
import { SfCodePanelComponent } from '../../../shared/code-editor/sf-code-panel.component';
import { SfBannerComponent } from '../../../shared/components/layout/sf-banner.component';
import { SfSkeletonComponent } from '../../../shared/components/layout/sf-skeleton.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { positionLabel } from '../text-media.util';
import { resolveHighlight } from './media-drawer-highlight';
import { MediaDrawerTextStore } from './media-drawer-text.store';
import { MediaDrawerStore } from './media-drawer.store';

/**
 * The Rendered tab (decision 21): what the site and the preview serve for a processed text file, read-only in the code
 * panel, highlighted like the Source tab (`GET media/{uuid}/binary?rendered=true`).
 */
@Component({
  selector: 'sf-media-drawer-rendered',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfBannerComponent, SfButtonComponent, SfCodePanelComponent, SfSkeletonComponent, TranslocoPipe],
  templateUrl: './media-drawer-rendered.component.html',
  styleUrl: './media-drawer-rendered.component.scss',
})
export class MediaDrawerRenderedComponent {
  protected readonly core = inject(MediaDrawerStore);
  protected readonly text = inject(MediaDrawerTextStore);
  private readonly project = inject(ProjectContextStore);
  protected readonly positionLabel = positionLabel;

  protected readonly highlight = computed(() => resolveHighlight(this.core.media(), this.project.project()?.codeHighlighting));
  /** The code panel's language names (technical names, not translated). */
  protected readonly languageLabel = computed(() => {
    const { format, svg } = this.highlight();
    return svg ? 'SVG · XML' : CODE_FORMAT_LABELS[format];
  });
}
