import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { PageEditorFocusService } from './page-editor-focus.service';
import { PageEditorStore } from './page-editor.store';
import { PageIssuesPanelComponent } from './page-issues-panel.component';
import { type ContentIssue, type DraftCheckView, type IssueTarget } from './page-issues.util';

/**
 * The Issues drawer of the page editor (M30.3.2, M35.18): *Go to it* on an issue scrolls the form to the field or section it
 * is about, selects it in the outline and focuses it, and outlines the section — or element — in the preview while it shows
 * the draft (the checks' view). The drawer stays open. It also feeds the Issues button's count.
 */
@Component({
  selector: 'sf-page-editor-issues',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageIssuesPanelComponent],
  template: `
    <sf-page-issues-panel
      [projectKey]="editor.projectKey()"
      [pageUuid]="editor.uuid()"
      [revision]="editor.timeTravelRevision()"
      [refreshKey]="editor.autosave.revision()"
      [completeness]="editor.shownIssues()"
      [previewView]="editor.previewView()"
      [open]="editor.issuesOpen()"
      [describe]="describe"
      [devMode]="developerMode()"
      (issueSelect)="onIssueSelect($event)"
      (checked)="onChecked($event)"
      (summaryChange)="editor.issueSummary.set($event)"
      (closed)="editor.issuesOpen.set(false)"
    />
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
})
export class PageEditorIssuesComponent {
  protected readonly editor = inject(PageEditorStore);
  private readonly focus = inject(PageEditorFocusService);
  protected readonly developerMode = inject(DeveloperModeService).enabled;

  /** Outline this section — or an element of it — in the preview. */
  readonly previewFocus = output<{ instanceId: string | null; selector: string | null }>();

  protected readonly describe = (target: IssueTarget): string | null => this.focus.describe(target);

  /** A draft check returns the completeness of the version it checked: the freshest there is. */
  protected onChecked(result: DraftCheckView): void {
    this.editor.issues.set((result.completeness ?? []) as ContentIssue[]);
  }

  protected onIssueSelect(target: IssueTarget): void {
    const preview = this.focus.goTo(target);
    // The preview shows the checked view only in Draft: outlining an element of the published page would mislead.
    if (preview && this.editor.previewView() === 'draft') {
      this.previewFocus.emit(preview);
    }
  }
}
