import { ChangeDetectionStrategy, Component, inject, input, viewChild } from '@angular/core';
import { SfPreviewFrameComponent } from '../preview';
import { PageEditorStore } from './page-editor.store';

/** The draggable divider and the preview beside the editor's centre pane. */
@Component({
  selector: 'sf-page-editor-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfPreviewFrameComponent],
  templateUrl: './page-editor-preview.component.html',
  styleUrl: './page-editor-preview.component.scss',
})
export class PageEditorPreviewComponent {
  protected readonly editor = inject(PageEditorStore);
  /** The element the split is measured against (the editor's main row). */
  readonly container = input.required<HTMLElement>();
  private readonly frame = viewChild(SfPreviewFrameComponent);

  /** Outlines a section — or an element of it — in the preview. */
  focusSection(instanceId: string | null, selector: string | null = null): void {
    this.frame()?.focusSection(instanceId, selector);
  }

  /**
   * Handles a section click forwarded from the preview iframe. No-op for now:
   * wiring the matching section editor into focus is a stretch goal.
   */
  protected onSectionClick(instanceId: string): void {
    void instanceId;
  }

  protected onDividerPointerDown(event: PointerEvent): void {
    event.preventDefault();
    const el = this.container();
    const move = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      this.editor.splitRatio.set(Math.min(0.85, Math.max(0.15, ratio)));
    };
    const up = () => {
      this.editor.persistSplitRatio();
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }
}
