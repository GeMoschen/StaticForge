import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfCodeEditorComponent } from '../../../shared/code-editor/code-editor.component';
import { extensionOf, resolveCodeFormat } from '../../../shared/code-editor/code-format';
import { positionLabel } from '../text-media.util';
import { MediaDrawerStore } from './media-drawer.store';
import { MediaDrawerTextStore } from './media-drawer-text.store';

type Diagnostic = components['schemas']['Diagnostic'];

/** The Source tab: the text media file in a code editor with live diagnostics (M18.4.1, M33). */
@Component({
  selector: 'sf-media-drawer-source',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfCodeEditorComponent],
  templateUrl: './media-drawer-source.component.html',
  styleUrl: './media-drawer-source.component.scss',
})
export class MediaDrawerSourceComponent {
  protected readonly core = inject(MediaDrawerStore);
  protected readonly text = inject(MediaDrawerTextStore);
  private readonly projectContext = inject(ProjectContextStore);
  protected readonly positionLabel = positionLabel;

  private readonly sourceEditor = viewChild<SfCodeEditorComponent>('sourceEditor');

  /**
   * How the source is highlighted (M33 follow-up): the project's overrides for the file's extension or MIME type,
   * else detected from them.
   */
  protected readonly sourceFormat = computed(() =>
    resolveCodeFormat({
      extension: extensionOf(this.core.media().fileName),
      mimeType: this.core.media().mimeType,
      overrides: this.projectContext.project()?.codeHighlighting,
    }),
  );

  /** Moves the caret to a diagnostic's position in the editor. */
  protected goToDiagnostic(diagnostic: Diagnostic): void {
    if (diagnostic.line) {
      this.sourceEditor()?.goTo(diagnostic.line, diagnostic.column ?? 1);
    }
  }
}
