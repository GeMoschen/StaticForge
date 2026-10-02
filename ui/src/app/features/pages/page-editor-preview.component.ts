import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfPreviewFrameComponent } from '../preview';
import { PageEditorFocusService } from './page-editor-focus.service';
import { PageEditorStore } from './page-editor.store';
import { issueTarget, type IssueTarget } from './page-issues.util';

/** A field the preview still needs, and where it is. */
interface MissingField {
  readonly key: string;
  readonly label: string;
  readonly target: IssueTarget;
}

/**
 * The preview beside the form (M35.18): the preview frame — or, while the page lacks what a preview needs (its required
 * fields), an empty state that says so, lists what is missing and takes the editor to the first of them. It fills the
 * end pane of the editor's splitter, which owns the size.
 */
@Component({
  selector: 'sf-page-editor-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfEmptyStateComponent, SfIconComponent, SfPreviewFrameComponent, TranslocoPipe],
  templateUrl: './page-editor-preview.component.html',
  styleUrl: './page-editor-preview.component.scss',
})
export class PageEditorPreviewComponent {
  protected readonly editor = inject(PageEditorStore);
  private readonly focus = inject(PageEditorFocusService);
  private readonly frame = viewChild(SfPreviewFrameComponent);

  /** The required fields that are still empty: what the preview waits for. */
  protected readonly missing = computed<MissingField[]>(() => {
    const seen = new Set<string>();
    const fields: MissingField[] = [];
    for (const issue of this.editor.shownIssues()) {
      if (issue.severity !== 'ERROR' || issue.kind !== 'COMPLETENESS') {
        continue;
      }
      const target = issueTarget(issue);
      const label = this.focus.describe(target) ?? issue.message ?? issue.path ?? '';
      if (label !== '' && !seen.has(label)) {
        seen.add(label);
        fields.push({ key: issue.path ?? label, label, target });
      }
    }
    return fields;
  });

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

  protected jumpToMissing(): void {
    const first = this.missing()[0];
    if (first) {
      this.focus.goTo(first.target);
    }
  }
}
